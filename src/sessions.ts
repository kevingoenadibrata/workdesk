import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Agent } from "./monitor";
import { showToast } from "./toast";
import type { Provider, Ticket } from "./tickets";

/**
 * Sessions: Claude Code at work in its own git worktree, optionally on a
 * ticket, which may lead to a pull request. A session outlives its pane:
 * closing the pane leaves the worktree for Teleport to recall, and ending the
 * session removes it. Workdesk says when one needs you, opens its PR, or gets
 * merged.
 */

/** The worktree `worktree_start` made or found. */
export interface Started {
  path: string;
  repo: string;
  /** The main checkout's folder. */
  root: string;
  base: string | null;
  reused: boolean;
  copied: string[];
  prompt_file: string;
}

/** The newest pull request from a session's branch. */
export interface BranchPull {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  draft: boolean;
}

export const sessionsApi = {
  start: (dir: string, branch: string, prompt: string) => invoke<Started>("worktree_start", { dir, branch, prompt }),
  remove: (path: string, repo: string, branch: string, forceBranch: boolean, promptFile: string | null) =>
    invoke<string>("worktree_remove", { path, repo, branch, forceBranch, promptFile }),
  pull: (dir: string, branch: string) => invoke<BranchPull | null>("tickets_branch_pull", { dir, branch }),
};

export interface SessionTicket {
  provider: Provider;
  id: string;
  title: string;
  url: string;
}

export interface Session {
  /** Claude Code's session id, which also names the session to Workdesk. */
  id: string;
  /** What the session is called when it has no ticket: the name it was started with. */
  name: string;
  ticket: SessionTicket | null;
  /** The worktree's folder, the main checkout's, and the repo's name. */
  path: string;
  root: string;
  repo: string;
  branch: string;
  promptFile: string;
  startedAt: number;
  pull: BranchPull | null;
}

/** What a session is up to, most pressing first. */
export type SessionState = "merged" | "closed" | "waiting" | "working" | "pr" | "idle" | "stopped";

export const SESSION_LABELS: Record<SessionState, string> = {
  merged: "Merged",
  closed: "PR closed",
  waiting: "Needs you",
  working: "Working",
  pr: "PR open",
  idle: "Idle",
  stopped: "Stopped",
};

export const ticketKey = (t: { provider: Provider; id: string }) => `${t.provider}:${t.id}`;

/** What to call a session: its ticket's id, else its name. */
export const sessionLabel = (s: Session) => s.ticket?.id ?? s.name;

/** Single-quoted for the shell. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command that starts Claude for a new session, with `promptFile`'s brief if there is one. */
export function claudeStart(s: Session, withPrompt: boolean): string {
  const prompt = withPrompt ? ` "$(cat ${shellQuote(s.promptFile)})"` : "";
  return `claude --session-id ${s.id} --name ${shellQuote(sessionLabel(s))} --permission-mode auto${prompt}`;
}

/** The command that picks a closed session's Claude back up. */
export const claudeResume = (s: Session) => `claude --resume ${s.id}`;

function closesLine(t: Ticket): string {
  if (t.provider === "workdesk") return `Mention ${t.id} in the pull request's description.`;
  return t.provider === "github"
    ? `Put "Closes ${t.id}" in the pull request's description, so merging it closes the issue.`
    : `Mention ${t.id} in the pull request's title and description, so ${t.provider === "linear" ? "Linear" : "ClickUp"} links them.`;
}

function ticketBlock(t: Ticket): string[] {
  return [`# ${t.id}: ${t.title}`, ...(t.url ? [t.url] : []), ``, t.body?.trim() || "(The ticket has no description.)"];
}

/** The brief Claude starts with: the ticket, and how to finish it. */
export function buildPrompt(t: Ticket, branch: string): string {
  return [
    `Work on this ticket and open a pull request for it.`,
    ``,
    ...ticketBlock(t),
    ``,
    `# How to work`,
    ``,
    `- You're in a git worktree made for this ticket, on the branch \`${branch}\`. Stay on it.`,
    `- It's a fresh checkout: install dependencies first if the project needs them to build or test.`,
    `- Read the code before changing it, keep the change focused on the ticket, and run the project's tests, type checks and linters before you finish.`,
    `- If the ticket is unclear or you need a decision only I can make, ask me before going further.`,
    `- When it's done, commit, push with \`git push -u origin ${branch}\`, and open a pull request with \`gh pr create\`. ${closesLine(t)}`,
    `- Finish by printing the pull request's link.`,
  ].join("\n");
}

/** The brief for a ticket attached to a session already under way. */
export function attachPrompt(t: Ticket, branch: string): string {
  return [
    `This session is now for the ticket below. Work on it here, on the branch \`${branch}\`.`,
    ``,
    ...ticketBlock(t),
    ``,
    `When it's done, commit, push with \`git push -u origin ${branch}\`, and open a pull request with \`gh pr create\`. ${closesLine(t)}`,
  ].join("\n");
}

const SESSIONS_KEY = "workdesk.sessions";
/** Where runs, sessions' predecessor, were kept: read once and carried over. */
const RUNS_KEY = "workdesk.runs";
const PULL_POLL_MS = 60_000;

function valid(s: unknown): s is Session {
  const x = s as Session;
  return !!x && typeof x.id === "string" && typeof x.path === "string" && typeof x.branch === "string";
}

function loadSessions(): Session[] {
  try {
    const saved = localStorage.getItem(SESSIONS_KEY);
    if (saved != null) {
      const list = JSON.parse(saved);
      return Array.isArray(list) ? list.filter(valid) : [];
    }
    // A run was a session with a ticket.
    const runs = JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]");
    if (!Array.isArray(runs)) return [];
    return runs
      .filter((r) => r && typeof r.sessionId === "string" && typeof r.path === "string" && r.ticket)
      .map(
        (r): Session => ({
          id: r.sessionId,
          name: r.ticket.id,
          ticket: r.ticket,
          path: r.path,
          root: r.root,
          repo: r.repo,
          branch: r.branch,
          promptFile: r.promptFile,
          startedAt: r.startedAt,
          pull: r.pull ?? null,
        }),
      );
  } catch {
    return [];
  }
}

/** Whether `dir` is `root` or inside it. */
const inside = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith("/") ? root : root + "/");

/** Every session, its agent (from Agent Monitor) and its pull request, with a heads-up when either changes. */
export class SessionStore {
  private sessions: Map<string, Session>;
  private agents = new Map<string, Agent>();
  private last = new Map<string, SessionState>();
  private listeners = new Set<() => void>();
  private checking = new Set<string>();

  /** `persist` false keeps sessions in memory only (the design preview's). */
  constructor(
    private notify: (title: string, body: string, session: Session) => void = report,
    private persist = true,
  ) {
    this.sessions = new Map((persist ? loadSessions() : []).map((s) => [s.id, s]));
    if (persist) this.save();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private save() {
    if (!this.persist) return;
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify([...this.sessions.values()]));
    } catch {}
  }

  /** Newest first. */
  get all(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** The session working on `ticket`, if any. */
  forTicket(ticket: { provider: Provider; id: string }): Session | undefined {
    const key = ticketKey(ticket);
    return this.all.find((s) => s.ticket && ticketKey(s.ticket) === key);
  }

  /** The agent working in `session`'s worktree, if one is running. */
  agentFor(session: Session): Agent | undefined {
    return this.agents.get(session.id);
  }

  state(session: Session): SessionState {
    const pr = session.pull?.state;
    if (pr === "MERGED") return "merged";
    if (pr === "CLOSED") return "closed";
    const agent = this.agents.get(session.id);
    if (agent?.status === "waiting") return "waiting";
    if (agent && agent.status !== "idle" && agent.status !== "error") return "working";
    if (pr === "OPEN") return "pr";
    return agent ? "idle" : "stopped";
  }

  add(session: Session) {
    this.sessions.set(session.id, session);
    this.last.set(session.id, this.state(session));
    this.save();
    this.emit();
  }

  /** Changes a session's name or ticket. */
  update(id: string, patch: Partial<Pick<Session, "name" | "ticket">>) {
    const session = this.sessions.get(id);
    if (!session) return;
    Object.assign(session, patch);
    this.save();
    this.emit();
  }

  delete(id: string) {
    this.sessions.delete(id);
    this.agents.delete(id);
    this.last.delete(id);
    this.save();
    this.emit();
  }

  /** Starts watching: Agent Monitor's polls, and each session's PR every minute. */
  start(onAgents: (fn: (agents: Agent[]) => void) => void) {
    onAgents((agents) => this.setAgents(agents));
    for (const s of this.sessions.values()) this.last.set(s.id, this.state(s));
    void this.checkPulls();
    setInterval(() => void this.checkPulls(), PULL_POLL_MS);
  }

  /** Matches Agent Monitor's agents to sessions, by the folder they're working in. */
  setAgents(agents: Agent[]) {
    const next = new Map<string, Agent>();
    for (const s of this.sessions.values()) {
      const agent = agents.find((a) => a.harness === "claude" && inside(a.session.cwd || a.session.startCwd, s.path));
      if (agent) next.set(s.id, agent);
    }
    const changed = [...this.sessions.keys()].some((k) => next.get(k)?.status !== this.agents.get(k)?.status);
    this.agents = next;
    if (!changed) return;
    // A session that just went quiet may have opened its PR.
    for (const s of this.sessions.values()) {
      const before = this.last.get(s.id);
      if ((before === "working" || before === "waiting") && this.state(s) === "idle") void this.checkPull(s);
    }
    this.observe();
  }

  /** Re-reads every unfinished session's pull request. */
  async checkPulls() {
    await Promise.all(
      [...this.sessions.values()].filter((s) => s.pull?.state !== "MERGED" && s.pull?.state !== "CLOSED").map((s) => this.checkPull(s)),
    );
  }

  private async checkPull(session: Session) {
    if (this.checking.has(session.id)) return;
    this.checking.add(session.id);
    try {
      const pull = await sessionsApi.pull(session.root, session.branch).catch(() => undefined);
      const current = this.sessions.get(session.id);
      if (pull === undefined || !current) return;
      if (JSON.stringify(pull) === JSON.stringify(current.pull)) return;
      current.pull = pull;
      this.save();
      this.observe();
    } finally {
      this.checking.delete(session.id);
    }
  }

  /** Says what changed since last time, then redraws. */
  private observe() {
    for (const s of this.sessions.values()) {
      const now = this.state(s);
      const before = this.last.get(s.id);
      this.last.set(s.id, now);
      if (before === undefined || before === now) continue;
      const label = sessionLabel(s);
      const name = s.ticket ? `${s.ticket.id} · ${s.ticket.title}` : `${s.name} · ${s.repo}`;
      const pr = s.pull ? `#${s.pull.number}` : "";
      if (now === "waiting") this.notify(`${label} needs you`, `Claude is waiting for an answer.\n${name}`, s);
      else if (now === "merged") this.notify(`${pr} merged`, `${name}\nEnd the session to remove its worktree.`, s);
      else if (now === "pr" && before !== "pr") this.notify(`${label}: opened ${pr}`, s.pull!.title, s);
      else if (now === "idle" && before === "working") this.notify(`${label}: Claude stopped`, `No pull request yet.\n${name}`, s);
    }
    this.emit();
  }
}

let permission: Promise<boolean> | null = null;

/** A toast, and a macOS notification too while Workdesk isn't in front (asking for permission the first time). */
async function report(title: string, body: string) {
  showToast(title, 5000);
  if (document.hasFocus()) return;
  permission ??= isPermissionGranted().then((ok) => ok || requestPermission().then((p) => p === "granted"));
  if (await permission.catch(() => false)) sendNotification({ title, body });
}

export const sessionStore = new SessionStore();

// ---- which repo a ticket's code lives in ----

const REPOS_KEY = "workdesk.ticketRepos";

/** The folder last picked for tickets in `project` (a GitHub repo, Linear team or ClickUp list). */
export function repoFor(t: { provider: Provider; project: string }): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(REPOS_KEY) ?? "{}")[`${t.provider}:${t.project}`];
  } catch {
    return undefined;
  }
}

export function rememberRepo(t: { provider: Provider; project: string }, dir: string | undefined) {
  try {
    const all = JSON.parse(localStorage.getItem(REPOS_KEY) ?? "{}");
    if (dir) all[`${t.provider}:${t.project}`] = dir;
    else delete all[`${t.provider}:${t.project}`];
    localStorage.setItem(REPOS_KEY, JSON.stringify(all));
  } catch {}
}
