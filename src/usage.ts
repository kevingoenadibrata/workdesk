import { invoke } from "@tauri-apps/api/core";
import { el } from "./page";
import { ChevronLeft, ChevronRight, RotateCcw, icon } from "./icons";
import { harnessLogo } from "./harnessLogos";

/** One rolling limit window, e.g. the 5-hour one. */
export interface UsageWindow {
  /** Its length: 300 for the 5-hour window, 10080 for the week. */
  minutes: number;
  usedPercent: number;
  /** Unix seconds. */
  resetsAt: number;
}

export interface Limits {
  windows: UsageWindow[];
  /** When these numbers were read, in ms. */
  updatedAt: number;
}

export interface Usage {
  claude: Limits | null;
  codex: Limits | null;
  /** A Claude Code session is open somewhere, so its status line keeps the numbers fresh. */
  claudeSessionOpen: boolean;
}

/** Where the panel gets its numbers; the design preview swaps in mocks. */
export interface UsageSource {
  status(): Promise<Usage>;
  /** A one-off Haiku request to read Claude's limits. Only allowed with no session open. */
  pingClaude(): Promise<Usage>;
}

export const liveUsage: UsageSource = {
  status: () => invoke("usage_status"),
  pingClaude: () => invoke("usage_ping_claude"),
};

const MIN = 60_000;

export function windowLabel(minutes: number): string {
  if (minutes % 10080 === 0) return `${minutes / 10080}w`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** "3h 12m", "2d 4h", "8m". */
function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

/** "03:30PM" today, else "Sat 03:30PM": always 12-hour, whatever the system's setting. */
function clock(ms: number, now: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours() % 12 || 12)}:${pad(d.getMinutes())}${d.getHours() < 12 ? "AM" : "PM"}`;
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function ago(ms: number, now: number): string {
  const d = now - ms;
  return d < MIN ? "just now" : `${span(d)} ago`;
}

/**
 * The usage limits strip on the Agent Monitor page: a row per harness with a
 * meter per window, how far through the window you are, and when it resets.
 */
export class UsagePanel {
  readonly root = el("section", "usage");
  private usage: Usage | null = null;
  private pinging = false;
  private pingError: string | null = null;
  private fetching = false;
  private lastFetch = 0;
  private timer: number | undefined;
  private shown = "";
  /** With `cycle`, which harness is showing. */
  private index = loadIndex();

  /**
   * `cycle` shows one harness at a time, Claude first, with arrows to step
   * through them (Home's card); otherwise every harness, under a heading.
   */
  constructor(
    private source: UsageSource = liveUsage,
    private cycle = false,
  ) {
    if (cycle) {
      this.root.classList.add("cycle");
      this.root.setAttribute("aria-label", "Usage limits");
    } else {
      const heading = el("h2", "agent-section-title");
      heading.append(el("span", "", "Usage limits"));
      this.root.append(heading);
    }
    this.root.append(el("div", "usage-rows"));
  }

  /** Keeps the numbers fresh and the countdowns ticking until the panel leaves the page. */
  start(fetchEveryMs = 10_000) {
    clearInterval(this.timer);
    const tick = () => {
      if (!this.root.isConnected && this.lastFetch) return clearInterval(this.timer);
      if (Date.now() - this.lastFetch >= fetchEveryMs) void this.fetch();
      else this.render();
    };
    tick();
    this.timer = window.setInterval(tick, 1000);
  }

  private async fetch() {
    if (this.fetching) return;
    this.fetching = true;
    this.lastFetch = Date.now();
    try {
      this.usage = await this.source.status();
    } catch {
      // Keep showing what we had.
    } finally {
      this.fetching = false;
    }
    this.render();
  }

  private async ping() {
    if (this.pinging) return;
    this.pinging = true;
    this.pingError = null;
    this.render();
    try {
      this.usage = await this.source.pingClaude();
    } catch (e) {
      this.pingError = String(e);
    } finally {
      this.pinging = false;
    }
    this.render();
  }

  private render() {
    const rows = this.root.querySelector(".usage-rows")!;
    const u = this.usage;
    if (!u) return;
    const now = Date.now();
    const all = [() => this.claudeRow(u, now), () => this.row("codex", "Codex", u.codex, now)];
    const next = this.cycle ? [this.withArrows(all[this.index % all.length](), all.length)] : all.map((r) => r());
    // This runs every second, but the text only changes by the minute: swap
    // the rows only then, so a click on the button isn't lost mid-press.
    const html = next.map((r) => r.outerHTML).join("");
    if (html !== this.shown) {
      this.shown = html;
      rows.replaceChildren(...next);
    }
  }

  /** Previous and next buttons in `row`'s head, stepping through the harnesses. */
  private withArrows(row: HTMLElement, count: number): HTMLElement {
    const step = (node: Parameters<typeof icon>[0], label: string, by: number) => {
      const b = el("button", "usage-step");
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(node, 14));
      b.addEventListener("click", () => {
        this.index = (this.index + by + count) % count;
        saveIndex(this.index);
        this.render();
      });
      return b;
    };
    const nav = el("span", "usage-nav");
    nav.append(step(ChevronLeft, "Previous", -1), el("span", "usage-page", `${(this.index % count) + 1}/${count}`), step(ChevronRight, "Next", 1));
    row.querySelector(".usage-row-head")!.append(nav);
    return row;
  }

  private claudeRow(u: Usage, now: number): HTMLElement {
    const row = this.row("claude", "Claude Code", u.claude, now);
    const status = row.querySelector<HTMLElement>(".usage-status")!;
    if (u.claudeSessionOpen && u.claude) {
      status.textContent = "Live";
      status.classList.add("live");
      status.title = `From your open Claude Code session, updated ${ago(u.claude.updatedAt, now)}`;
    } else if (u.claudeSessionOpen) {
      status.textContent = "Waiting for a reply";
      status.title = "Shows up after your open session's next reply";
    }
    const button = el("button", "usage-refresh");
    button.type = "button";
    button.append(icon(RotateCcw, 13));
    button.disabled = this.pinging || u.claudeSessionOpen;
    button.classList.toggle("spinning", this.pinging);
    const label = this.pinging
      ? "Checking…"
      : u.claudeSessionOpen
        ? "A Claude Code session is open, so these update on their own"
        : "Check now: sends Haiku a one-word message to read your limits. Uses a tiny bit of quota, and starts a new 5-hour window if none is running.";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => void this.ping());
    row.querySelector(".usage-row-head")!.append(button);
    if (this.pingError) row.append(el("p", "usage-error", this.pingError));
    return row;
  }

  private row(harness: "claude" | "codex", name: string, limits: Limits | null, now: number): HTMLElement {
    const row = el("div", "usage-row");
    row.dataset.harness = harness;
    const head = el("div", "usage-row-head");
    const logo = el("span", "agent-harness");
    logo.innerHTML = harnessLogo(harness);
    const status = el("span", "usage-status");
    if (limits) status.textContent = ago(limits.updatedAt, now);
    else status.textContent = harness === "claude" ? "No numbers yet" : "Shows up after a Codex session";
    head.append(logo, el("span", "usage-name", name), status);
    row.append(head);
    if (!limits) {
      row.classList.add("empty");
      return row;
    }
    const tiles = el("div", "usage-tiles");
    for (const w of limits.windows) tiles.append(tile(w, now));
    row.append(tiles);
    return row;
  }
}

const INDEX_KEY = "workdesk.usageHarness";
/** The harnesses the cycling card steps through, in order. */
const CYCLE = ["claude", "codex"] as const;
const harnessListeners = new Set<() => void>();

/** The harness the cycling usage card is showing. */
export function shownHarness(): (typeof CYCLE)[number] {
  return CYCLE[loadIndex() % CYCLE.length];
}

/** Called when the cycling card steps to another harness. */
export function onShownHarness(fn: () => void) {
  harnessListeners.add(fn);
}

/**
 * A window in brief, for the sidebar: "62%", how it's going (the usage
 * card's levels), and when it resets, as a countdown and a clock time.
 */
export function windowSummary(
  w: UsageWindow,
  now = Date.now(),
): { used: string; percent: number; level: "ok" | "ahead" | "high" | "reset"; resetsIn: string; resetsAt: string } {
  const at = w.resetsAt * 1000;
  const left = at - now;
  if (left <= 0) return { used: "Fresh", percent: 0, level: "reset", resetsIn: "", resetsAt: "" };
  const percent = Math.min(100, Math.max(0, w.usedPercent));
  const elapsed = Math.min(1, Math.max(0, 1 - left / (w.minutes * MIN)));
  const level = percent >= 90 ? "high" : percent > elapsed * 100 + 10 ? "ahead" : "ok";
  return { used: `${Math.round(percent)}%`, percent, level, resetsIn: `in ${span(left)}`, resetsAt: clock(at, now) };
}

function loadIndex(): number {
  try {
    return Number(localStorage.getItem(INDEX_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveIndex(i: number) {
  try {
    localStorage.setItem(INDEX_KEY, String(i));
  } catch {}
  for (const fn of harnessListeners) fn();
}

const WINDOW_NAMES: Record<number, string> = { 300: "5-hour", 10080: "Weekly" };

/** Each meter cell is 5%. */
const CELLS = 20;

/** One window: how much is used, as a big number and a row of cells, and when it resets. */
function tile(w: UsageWindow, now: number): HTMLElement {
  const resetsAt = w.resetsAt * 1000;
  const left = resetsAt - now;
  const reset = left <= 0;
  // How far through the window we are; usage ahead of this burns too fast.
  const elapsed = reset ? 0 : Math.min(1, Math.max(0, 1 - left / (w.minutes * MIN)));
  const used = reset ? 0 : Math.min(100, Math.max(0, w.usedPercent));
  const level = used >= 90 ? "high" : used > elapsed * 100 + 10 ? "ahead" : "ok";

  const t = el("div", "usage-tile");
  t.dataset.level = reset ? "reset" : level;
  t.title = reset
    ? "This window has reset"
    : `${Math.round(used)}% used, ${Math.round(elapsed * 100)}% of the window gone${level === "ahead" ? ", so you're using it faster than it refills" : ""}`;

  const num = el("span", "usage-num");
  if (reset) num.textContent = "Fresh";
  else num.append(String(Math.round(used)), el("small", "", "%"));

  const cells = el("div", "usage-cells");
  const lit = Math.ceil(used / (100 / CELLS));
  for (let i = 0; i < CELLS; i++) {
    const c = el("i", i < lit ? (i === lit - 1 ? "on tip" : "on") : "");
    cells.append(c);
  }

  const when = el("span", "usage-when");
  if (reset) when.append(el("strong", "", "reset"), el("span", "", `at ${clock(resetsAt, now)}`));
  else when.append(el("strong", "", `in ${span(left)}`), el("span", "", clock(resetsAt, now)));

  t.append(el("span", "usage-tile-label", WINDOW_NAMES[w.minutes] ?? windowLabel(w.minutes)), num, cells, when);
  return t;
}
