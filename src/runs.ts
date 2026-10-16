import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { Agent } from "./monitor";
import { showToast } from "./toast";
import type { Provider, Ticket } from "./tickets";

/**
 * Agent runs: a ticket handed to Claude Code in its own git worktree, which
 * opens a pull request when it's done. Workdesk keeps track of each run and
 * says when it needs you, opens its PR, or gets merged.
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

/** The newest pull request from a run's branch. */
export interface BranchPull {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  draft: boolean;
}

export const runsApi = {
  start: (dir: string, branch: string, prompt: string) => invoke<Started>("worktree_start", { dir, branch, prompt }),
  remove: (path: string, repo: string, branch: string, forceBranch: boolean, promptFile: string | null) =>
    invoke<string>("worktree_remove", { path, repo, branch, forceBranch, promptFile }),
  pull: (dir: string, branch: string) => invoke<BranchPull | null>("tickets_branch_pull", { dir, branch }),
};

export interface Run {
  /** `provider:id`, one run per ticket. */
  key: string;
  ticket: { provider: Provider; id: string; title: string; url: string };
  /** The worktree's folder, the main checkout's, and the repo's name. */
  path: string;
  root: string;
  repo: string;
  branch: string;
  promptFile: string;
  /** Claude Code's session id, to resume it in a new tab. */
  sessionId: string;
  startedAt: number;
  pull: BranchPull | null;
}

/** What a run is up to, most pressing first. */
export type RunState = "merged" | "closed" | "waiting" | "working" | "pr" | "idle" | "stopped";

export const RUN_LABELS: Record<RunState, string> = {
  merged: "Merged",
  closed: "PR closed",
  waiting: "Needs you",
  working: "Working",
  pr: "PR open",
  idle: "Idle",
  stopped: "Stopped",
};

export const runKey = (t: { provider: Provider; id: string }) => `${t.provider}:${t.id}`;

/** Single-quoted for the shell. */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The brief Claude starts with: the ticket, and how to finish it. */
export function buildPrompt(t: Ticket, branch: string): string {
  const closes =
    t.provider === "github"
      ? `Put "Closes ${t.id}" in the pull request's description, so merging it closes the issue.`
      : `Mention ${t.id} in the pull request's title and description, so ${t.provider === "linear" ? "Linear" : "ClickUp"} links them.`;
  return [
    `Work on this ticket and open a pull request for it.`,
    ``,
    `# ${t.id}: ${t.title}`,
    `${t.url}`,
    ``,
    t.body?.trim() || "(The ticket has no description.)",
    ``,
    `# How to work`,
    ``,
    `- You're in a git worktree made for this ticket, on the branch \`${branch}\`. Stay on it.`,
    `- It's a fresh checkout: install dependencies first if the project needs them to build or test.`,
    `- Read the code before changing it, keep the change focused on the ticket, and run the project's tests, type checks and linters before you finish.`,
    `- If the ticket is unclear or you need a decision only I can make, ask me before going further.`,
    `- When it's done, commit, push with \`git push -u origin ${branch}\`, and open a pull request with \`gh pr create\`. ${closes}`,
    `- Finish by printing the pull request's link.`,
  ].join("\n");
}

const RUNS_KEY = "workdesk.runs";
const PULL_POLL_MS = 60_000;

function loadRuns(): Run[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((r) => r && typeof r.key === "string" && typeof r.path === "string") : [];
  } catch {
    return [];
  }
}

/** Whether `dir` is `root` or inside it. */
const inside = (dir: string, root: string) => dir === root || dir.startsWith(root.endsWith("/") ? root : root + "/");

/** Every run, its agent (from Agent Monitor) and its pull request, with a heads-up when either changes. */
export class RunStore {
  private runs: Map<string, Run>;
  private agents = new Map<string, Agent>();
  private last = new Map<string, RunState>();
  private listeners = new Set<() => void>();
  private checking = new Set<string>();

  /** `persist` false keeps runs in memory only (the design preview's). */
  constructor(
    private notify: (title: string, body: string, run: Run) => void = report,
    private persist = true,
  ) {
    this.runs = new Map((persist ? loadRuns() : []).map((r) => [r.key, r]));
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
      localStorage.setItem(RUNS_KEY, JSON.stringify([...this.runs.values()]));
    } catch {}
  }

  get all(): Run[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(key: string): Run | undefined {
    return this.runs.get(key);
  }

  /** The agent working in `run`'s worktree, if one is running. */
  agentFor(run: Run): Agent | undefined {
    return this.agents.get(run.key);
  }

  state(run: Run): RunState {
    const pr = run.pull?.state;
    if (pr === "MERGED") return "merged";
    if (pr === "CLOSED") return "closed";
    const agent = this.agents.get(run.key);
    if (agent?.status === "waiting") return "waiting";
    if (agent && agent.status !== "idle" && agent.status !== "error") return "working";
    if (pr === "OPEN") return "pr";
    return agent ? "idle" : "stopped";
  }

  add(run: Run) {
    this.runs.set(run.key, run);
    this.last.set(run.key, this.state(run));
    this.save();
    this.emit();
  }

  delete(key: string) {
    this.runs.delete(key);
    this.agents.delete(key);
    this.last.delete(key);
    this.save();
    this.emit();
  }

  /** Starts watching: Agent Monitor's polls, and each run's PR every minute. */
  start(onAgents: (fn: (agents: Agent[]) => void) => void) {
    onAgents((agents) => this.setAgents(agents));
    for (const run of this.runs.values()) this.last.set(run.key, this.state(run));
    void this.checkPulls();
    setInterval(() => void this.checkPulls(), PULL_POLL_MS);
  }

  /** Matches Agent Monitor's agents to runs, by the folder they're working in. */
  setAgents(agents: Agent[]) {
    const next = new Map<string, Agent>();
    for (const run of this.runs.values()) {
      const agent = agents.find((a) => a.harness === "claude" && inside(a.session.cwd || a.session.startCwd, run.path));
      if (agent) next.set(run.key, agent);
    }
    const changed = [...this.runs.keys()].some((k) => next.get(k)?.status !== this.agents.get(k)?.status);
    this.agents = next;
    if (!changed) return;
    // A run that just went quiet may have opened its PR.
    for (const run of this.runs.values()) {
      const before = this.last.get(run.key);
      if ((before === "working" || before === "waiting") && this.state(run) === "idle") void this.checkPull(run);
    }
    this.observe();
  }

  /** Re-reads every unfinished run's pull request. */
  async checkPulls() {
    await Promise.all(
      [...this.runs.values()].filter((r) => r.pull?.state !== "MERGED" && r.pull?.state !== "CLOSED").map((r) => this.checkPull(r)),
    );
  }

  private async checkPull(run: Run) {
    if (this.checking.has(run.key)) return;
    this.checking.add(run.key);
    try {
      const pull = await runsApi.pull(run.root, run.branch).catch(() => undefined);
      const current = this.runs.get(run.key);
      if (pull === undefined || !current) return;
      if (JSON.stringify(pull) === JSON.stringify(current.pull)) return;
      current.pull = pull;
      this.save();
      this.observe();
    } finally {
      this.checking.delete(run.key);
    }
  }

  /** Says what changed since last time, then redraws. */
  private observe() {
    for (const run of this.runs.values()) {
      const now = this.state(run);
      const before = this.last.get(run.key);
      this.last.set(run.key, now);
      if (before === undefined || before === now) continue;
      const name = `${run.ticket.id} · ${run.ticket.title}`;
      const pr = run.pull ? `#${run.pull.number}` : "";
      if (now === "waiting") this.notify(`${run.ticket.id} needs you`, `Claude is waiting for an answer.\n${name}`, run);
      else if (now === "merged") this.notify(`${pr} merged`, `${name}\nClean up its worktree from the Tickets page.`, run);
      else if (now === "pr" && before !== "pr") this.notify(`${run.ticket.id}: opened ${pr}`, run.pull!.title, run);
      else if (now === "idle" && before === "working") this.notify(`${run.ticket.id}: Claude stopped`, `No pull request yet.\n${name}`, run);
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

export const runStore = new RunStore();

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
