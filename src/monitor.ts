import { Page, el } from "./page";
import { agentStatus, type AgentInfo, type AgentStatus } from "./pty";
import { Radar, icon } from "./icons";
import { kbdFor } from "./kbd";
import { GROUP_COLORS, type Workspace } from "./workspace";
import { botSvg, type BotFace } from "./bot";
import { harnessLogo } from "./harnessLogos";
import { logLines } from "./monitorSettings";
import type { TermSession } from "./terminal";
import { UsagePanel, liveUsage, type UsageSource } from "./usage";

export const HARNESS_NAMES: Record<AgentInfo["harness"], string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "opencode",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting for you",
  idle: "Idle",
  error: "Error",
  unknown: "Running",
};

/** One word each for the badge under the avatar, whose width the longest of these sets. */
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

const needsYou = (a: Agent) => a.status === "waiting" || a.status === "error";
const busy = (a: Agent) => a.status === "thinking" || a.status === "working";

// ---- the page ----

type Section = "needs" | "active" | "idle";

const SECTIONS: { key: Section; title: string }[] = [
  { key: "needs", title: "Needs you" },
  { key: "active", title: "Active" },
  { key: "idle", title: "Idle" },
];

export function sectionOf(a: Agent): Section {
  if (needsYou(a)) return "needs";
  return a.status === "idle" ? "idle" : "active";
}

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

/** Where a blip sits on the scope: the more it needs you, the nearer the centre. */
const BLIP_RADIUS: Record<Section, number> = { needs: 0.24, active: 0.56, idle: 0.86 };

/** Cards for every coding agent running in a pane; clicking one goes to it. */
export class MonitorPage extends Page {
  readonly title = "Agent Monitor";
  private agents: Agent[] = [];
  private list: HTMLElement | null = null;
  private scope: HTMLElement | null = null;
  private cards = new Map<TermSession, HTMLElement>();
  private sections = new Map<Section, HTMLElement>();

  constructor(
    host: HTMLElement,
    private onJump: (session: TermSession) => void,
    private usage: UsageSource = liveUsage,
  ) {
    super(host);
  }

  protected build(body: HTMLElement): HTMLElement | null {
    body.classList.add("monitor-body");
    // The heading shares a row with the scope.
    const title = body.querySelector(".page-title")!;
    const head = el("header", "monitor-head");
    const text = el("div", "monitor-head-text");
    title.replaceWith(head);
    text.append(
      title,
      el("p", "page-intro monitor-intro", "Every coding agent running in your panes, and what each one is doing right now. Click a card to jump to its pane."),
    );
    this.scope = el("div", "monitor-scope");
    this.scope.setAttribute("aria-hidden", "true");
    this.scope.append(el("span", "monitor-sweep"));
    head.append(this.scope, text);

    const usage = new UsagePanel(this.usage);
    this.list = el("div", "agent-list");
    this.cards.clear();
    this.sections.clear();
    // Agents on the left, usage limits in a column on the right.
    const layout = el("div", "monitor-layout");
    layout.append(this.list, usage.root);
    body.append(layout);
    usage.start();
    this.render();
    return null;
  }

  update(agents: Agent[]) {
    this.agents = agents;
    if (this.isOpen) this.render();
  }

  private render() {
    const list = this.list;
    if (!list) return;
    this.renderScope();
    if (this.agents.length === 0) {
      this.cards.clear();
      this.sections.clear();
      const empty = el("div", "agent-empty");
      empty.append(
        el("p", "agent-empty-title", "No agents running"),
        el("p", "agent-empty-text", "Start claude, codex or opencode in any tab and it appears here."),
      );
      list.replaceChildren(empty);
      return;
    }
    const now = Date.now();
    for (const session of this.cards.keys()) if (!this.agents.some((a) => a.session === session)) this.cards.delete(session);
    const blocks = SECTIONS.flatMap(({ key, title }) => {
      const members = this.agents.filter((a) => sectionOf(a) === key);
      if (members.length === 0) {
        this.sections.delete(key);
        return [];
      }
      let block = this.sections.get(key);
      if (!block) {
        block = el("section", `agent-section ${key}`);
        const heading = el("h2", "agent-section-title");
        heading.append(el("span", "", title), el("span", "agent-section-count"));
        block.append(heading, el("div", "agent-section-cards"));
        this.sections.set(key, block);
      }
      setText(block.querySelector(".agent-section-count"), String(members.length));
      const cards = members.map((agent) => {
        let card = this.cards.get(agent.session);
        if (!card) {
          card = this.card(agent.session);
          this.cards.set(agent.session, card);
        }
        fillCard(card, agent, now);
        return card;
      });
      placeChildren(block.querySelector(".agent-section-cards")!, cards);
      return [block];
    });
    placeChildren(list, blocks);
  }

  /** One blip per agent, spaced around the scope in sidebar order. */
  private renderScope() {
    const scope = this.scope;
    if (!scope) return;
    const n = this.agents.length;
    // Update the blips in place and never touch the sweep: re-inserting an
    // element restarts its animation, and this runs every poll, so the sweep
    // never got past the first third of its turn.
    const blips = [...scope.querySelectorAll<HTMLElement>(".monitor-blip")];
    while (blips.length > n) blips.pop()!.remove();
    while (blips.length < n) scope.append(blips[blips.push(el("span", "monitor-blip")) - 1]);
    this.agents.forEach((agent, i) => {
      const angle = ((i / Math.max(n, 1)) * 360 - 60) * (Math.PI / 180);
      const r = BLIP_RADIUS[sectionOf(agent)] * 50;
      const blip = blips[i];
      if (blip.dataset.status !== agent.status) blip.dataset.status = agent.status;
      blip.style.left = `${50 + Math.cos(angle) * r}%`;
      blip.style.top = `${50 + Math.sin(angle) * r}%`;
    });
    scope.classList.toggle("busy", this.agents.some(busy));
  }

  private card(session: TermSession): HTMLElement {
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
    card.addEventListener("click", () => this.onJump(session));
    return card;
  }
}

/** Puts `children` in `parent` in order, moving nothing that's already in place (which would drop focus). */
function placeChildren(parent: Element, children: Element[]) {
  const current = [...parent.children];
  if (current.length !== children.length || children.some((c, i) => current[i] !== c)) parent.replaceChildren(...children);
}

function setText(node: Element | null, text: string) {
  if (node && node.textContent !== text) node.textContent = text;
}

function fillCard(card: HTMLElement, agent: Agent, now: number) {
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

// ---- polling, and the sidebar row ----

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

  constructor(
    private ws: Workspace,
    private slot: HTMLElement,
    private page: MonitorPage,
  ) {
    // Renamed or moved tabs show up on the cards right away.
    ws.onChange(() => this.refreshTitles());
    Page.onChange(() => this.renderRow());
    this.renderRow();
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
      this.page.update(agents);
      this.renderRow();
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
    this.page.update(this.agents);
    this.renderRow();
    this.emit();
  }

  /** The Monitor row: shown while agents run, or while the page is open. */
  private renderRow() {
    const open = Page.current === this.page;
    if (this.agents.length === 0 && !open) {
      this.slot.replaceChildren();
      return;
    }
    const attention = this.agents.filter(needsYou);
    const row = el("button", "tab monitor-row");
    row.type = "button";
    if (open) row.classList.add("active");
    if (this.agents.some(busy)) row.classList.add("busy");
    const n = this.agents.length;
    row.dataset.tip = attention.length
      ? `Monitor · ${attention.length} need${attention.length === 1 ? "s" : ""} you`
      : `Monitor · ${n} agent${n === 1 ? "" : "s"}`;
    const glyph = el("span", "monitor-icon");
    glyph.append(icon(Radar, 14));
    const hint = el("span", "tab-hint");
    hint.append(kbdFor("openMonitor"));
    row.append(glyph, el("span", "tab-title", "Agent Monitor"));
    if (attention.length) {
      const badge = el("span", "monitor-badge", String(attention.length));
      if (attention.some((a) => a.status === "error")) badge.classList.add("error");
      row.append(badge);
    } else {
      row.append(el("span", "monitor-count", String(n)));
    }
    row.append(hint);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.page.toggle();
    });
    this.slot.replaceChildren(row);
  }
}
