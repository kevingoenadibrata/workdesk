import { el } from "./page";
import { agentStatus, type AgentInfo, type AgentStatus } from "./pty";
import { GROUP_COLORS, type Workspace } from "./workspace";
import { botSvg, type BotFace } from "./bot";
import { harnessLogo } from "./harnessLogos";
import { logLines } from "./monitorSettings";
import type { TermSession } from "./terminal";

export const HARNESS_NAMES: Record<AgentInfo["harness"], string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
};

/** One word each for the badge under the avatar, whose width the longest of these sets. */
/** What each status is called in a card's aria label. */
const STATUS_LABELS: Record<AgentStatus, string> = {
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  error: "Error",
  unknown: "Running",
};


export const BADGE_LABELS: Record<AgentStatus, string> = {
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting",
  idle: "Idle",
  error: "Error",
  unknown: "Running",
};

/** A coding agent in a pane, as shown on its card. */
export interface Agent extends AgentInfo {
  session: TermSession;
  tabTitle: string;
  /** Its tab's color, as CSS. */
  color: string;
  /** The last meaningful lines on the pane's screen, oldest first. */
  lastLog: string[];
  /** When it went into its current status, in ms. */
  since: number;
  /** What it was doing before, so a finished agent can look pleased. */
  from?: AgentStatus;
}

// ---- reading the screen ----

/** Rows that are only box drawing: the frames TUIs draw around their input. */
const BORDER = /^[\s─━═│┃╭╮╰╯┌┐└┘├┤┬┴┼▔▁▏▕_\-–—·•]*$/;
/** The agent's own input row. */
const PROMPT_ROW = /^(❯|>|›)(\s|$)/;
/** Footer hints that sit below the input on every screen. */
const CHROME =
  /\? for shortcuts|shift\+tab|⏵⏵|bypass permissions|accept edits|plan mode on|context left|% context|ctrl\+[a-z] to |tab to |enter to send|esc to (cancel|exit|go back)|press .+ again to exit|⏎ send/i;
/** An approval or question the agent is waiting on. */
const ASKING =
  /do you want to (proceed|make this edit|create|run|allow)|would you like to (run|make|apply|proceed)|allow (once|always|command)|permission required|\(y\/n\)|\[y\/n\]/i;

/** A screen line without the box edges, bullets and block-art logos TUIs draw around it. */
function clean(line: string): string {
  return line
    .replace(/^[│┃▎▏▌]\s*/, "")
    .replace(/\s*[│┃]$/, "")
    .replace(/^[•●⏺◦]\s+/, "")
    .replace(/^[\s▀▄█▌▐▖▗▘▙▚▛▜▝▞▟░▒▓]+(?=\S)/, "")
    .trim();
}

/** Older lines shown above the setting's count, fading out. */
export const FADED_LINES = 2;

/** The last `count` lines on screen that aren't the agent's input box or its footer, oldest first. */
export function lastLog(lines: string[], count: number): string[] {
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
    const line = clean(lines[i]);
    if (!line || BORDER.test(line) || PROMPT_ROW.test(line) || CHROME.test(line)) continue;
    out.unshift(line);
  }
  return out;
}

/**
 * Fills in what the session files can't say. Codex and opencode don't record
 * pending approvals, and Codex doesn't record errors, but both are on screen.
 */
function fromScreen(info: AgentInfo, lines: string[]): Pick<AgentInfo, "status" | "detail"> {
  const { status, detail } = info;
  const trusted = info.harness === "claude" && status !== "unknown";
  if (!trusted && status !== "waiting") {
    const asking = lines.slice(-14).find((l) => ASKING.test(l));
    if (asking) return { status: "waiting", detail: clean(asking) };
  }
  // Without its session files (an old version, or transcripts turned off),
  // Claude Code's spinner still says it's busy.
  if (status === "unknown" && lines.slice(-12).some((l) => /esc to interrupt/i.test(l))) {
    return { status: "thinking", detail };
  }
  if (info.harness === "codex" && status === "idle") {
    const error = lines.slice(-6).find((l) => l.startsWith("■"));
    if (error) return { status: "error", detail: error.slice(1).trim() };
  }
  return { status, detail };
}

/** Waiting on an answer, or stopped by an error. */
export const needsYou = (a: Agent) => a.status === "waiting" || a.status === "error";

/** How long a bot looks pleased after finishing, and how long idle before it dozes off. */
const HAPPY_MS = 6000;
const SLEEP_MS = 10 * 60_000;

export function faceOf(a: Agent, now: number): BotFace {
  switch (a.status) {
    case "thinking":
      return "think";
    case "working":
      return "read";
    case "waiting":
      return "ask";
    case "error":
      return "error";
    case "idle":
      if ((a.from === "thinking" || a.from === "working") && now - a.since < HAPPY_MS) return "happy";
      return now - a.since > SLEEP_MS ? "sleep" : "idle";
    default:
      return "idle";
  }
}

// ---- the agent card ----

/** An agent's card: the bot on the left; its badge, harness and tab, prompt and log on the right. Fill it with `fillAgentCard`. */
export function agentCard(onJump: () => void): HTMLElement {
  const card = el("button", "agent-card");
  card.type = "button";
  const avatar = el("span", "agent-avatar");
  // Each bot blinks on its own beat rather than in unison.
  avatar.style.setProperty("--bot-delay", `${-(Math.random() * 4).toFixed(2)}s`);
  // Every label sits in the badge, stacked, so it's always as wide as the
  // longest one and badges line up from card to card.
  const badge = el("span", "agent-badge");
  for (const [status, text] of Object.entries(BADGE_LABELS)) {
    const word = el("span", "", text);
    word.dataset.status = status;
    badge.append(word);
  }
  const head = el("div", "agent-head");
  head.append(badge, el("span", "agent-harness"), el("span", "agent-tab"));
  // The bot gets the left column; the rest stacks on the right.
  card.append(avatar, head, el("p", "agent-prompt"), el("div", "agent-log"));
  card.addEventListener("click", onJump);
  return card;
}

/** Brings `card` (from `agentCard`) up to date with `agent`, touching only what changed. */
export function fillAgentCard(card: HTMLElement, agent: Agent, now: number) {
  card.dataset.status = agent.status;
  card.style.setProperty("--bot", agent.color);
  const face = faceOf(agent, now);
  if (card.dataset.face !== face) {
    card.dataset.face = face;
    card.querySelector(".agent-avatar")!.innerHTML = botSvg(face);
  }
  const q = (sel: string) => card.querySelector(sel);
  setText(q(".agent-tab"), agent.tabTitle);
  const harness = q(".agent-harness") as HTMLElement;
  if (harness.dataset.harness !== agent.harness) {
    harness.dataset.harness = agent.harness;
    harness.innerHTML = harnessLogo(agent.harness);
    harness.title = HARNESS_NAMES[agent.harness];
  }
  for (const word of q(".agent-badge")!.children) {
    word.classList.toggle("on", (word as HTMLElement).dataset.status === agent.status);
  }
  const prompt = q(".agent-prompt") as HTMLElement;
  setText(prompt, agent.prompt ?? "No prompt yet");
  prompt.classList.toggle("empty", !agent.prompt);
  const shown = agent.lastLog;
  const log = q(".agent-log") as HTMLElement;
  while (log.children.length > shown.length) log.lastElementChild!.remove();
  while (log.children.length < shown.length) log.append(el("span", "agent-log-line"));
  // Lines beyond the setting's count are older context, fading out toward the top.
  const faded = Math.max(0, shown.length - logLines());
  shown.forEach((line, i) => {
    const span = log.children[i] as HTMLElement;
    setText(span, line);
    const fade = i < faded ? String(faded - i) : "";
    if ((span.dataset.fade ?? "") !== fade) {
      if (fade) span.dataset.fade = fade;
      else delete span.dataset.fade;
    }
  });
  log.dataset.faded = String(faded);
  log.style.setProperty("--rows", String(logLines() + FADED_LINES));
  log.hidden = !shown.length;
  card.setAttribute(
    "aria-label",
    `${agent.tabTitle}, ${HARNESS_NAMES[agent.harness]}, ${STATUS_LABELS[agent.status]}. Go to pane.`,
  );
}


function setText(node: Element | null, text: string) {
  if (node && node.textContent !== text) node.textContent = text;
}

// ---- polling ----

/** Every pane in sidebar order, then left to right and top to bottom, with its tab's title and color. */
export function panesInOrder(ws: Workspace): { session: TermSession; tabTitle: string; color: string }[] {
  return ws.orderedTabIds().flatMap((id) => {
    const tab = ws.tabs.get(id)!;
    const tabTitle = ws.title(tab);
    // As the sidebar colors it: its group's, else its own, else the accent.
    const c = ws.groupOf(id)?.color ?? tab.color;
    const color = c ? GROUP_COLORS[c] : "var(--accent)";
    return tab.sessions.map((session) => ({ session, tabTitle, color }));
  });
}

/**
 * Watches every pane for coding agents. While any are running, a Monitor row
 * sits at the top of the sidebar, badged when one needs you.
 */
export class AgentMonitor {
  private agents: Agent[] = [];
  /** Status, since-when and the status before, per pane, so cards can say how long. */
  private seen = new Map<TermSession, { status: AgentStatus; since: number; from?: AgentStatus }>();
  private polling = false;
  private listeners = new Set<(agents: Agent[]) => void>();

  constructor(private ws: Workspace) {
    // Renamed or moved tabs show up on the cards right away.
    ws.onChange(() => this.refreshTitles());
  }

  /** The agents found by the last poll, in sidebar order. */
  get current(): Agent[] {
    return this.agents;
  }

  /** Called with the agents after every poll, and when tab titles change. */
  onChange(fn: (agents: Agent[]) => void) {
    this.listeners.add(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.agents);
  }

  start(intervalMs = 1500) {
    void this.poll();
    setInterval(() => void this.poll(), intervalMs);
  }

  private panes() {
    return panesInOrder(this.ws);
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const panes = this.panes().filter((p) => p.session.ptyId != null);
      const found = panes.length ? await agentStatus(panes.map((p) => p.session.ptyId!)).catch(() => ({})) : {};
      const now = Date.now();
      const agents: Agent[] = [];
      for (const { session, tabTitle, color } of panes) {
        const info = (found as Record<string, AgentInfo>)[session.ptyId!];
        if (!info) continue;
        const lines = session.screenLines(40);
        const { status, detail } = fromScreen(info, lines);
        const prev = this.seen.get(session);
        const same = prev && prev.status === status;
        const since = same ? prev.since : now;
        const from = same ? prev.from : prev?.status;
        this.seen.set(session, { status, since, from });
        agents.push({ ...info, status, detail, session, tabTitle, color, lastLog: lastLog(lines, logLines() + FADED_LINES), since, from });
      }
      for (const session of this.seen.keys()) if (!agents.some((a) => a.session === session)) this.seen.delete(session);
      this.agents = agents;
      this.emit();
    } finally {
      this.polling = false;
    }
  }

  private refreshTitles() {
    if (this.agents.length === 0) return;
    const panes = new Map(this.panes().map((p) => [p.session, p]));
    this.agents = this.agents
      .filter((a) => panes.has(a.session))
      .map((a) => ({ ...a, tabTitle: panes.get(a.session)!.tabTitle, color: panes.get(a.session)!.color }));
    this.emit();
  }
}
