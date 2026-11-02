import "./home.css";
import { Page, el } from "./page";
import { ArrowRight, ArrowUpRight, Bot, EthernetPort, House, ChevronLeft, ChevronRight, GitBranch, RotateCcw, Check, Copy, GitBranchPlus, GitMerge, GitPullRequest, GitPullRequestClosed, Hash, ListFilter, Plus, Search, Settings, Trash2, X, icon } from "./icons";
import { botSvg, type BotFace } from "./bot";
import { providerLogo, type Provider } from "./providerLogos";
import { showToast } from "./toast";
import { BADGE_LABELS, agentCard, faceOf, fillAgentCard, needsYou, type Agent, type AgentMonitor } from "./monitor";
import { logLines } from "./monitorSettings";
import { PROVIDERS, WRITABLE, branchName, providerName, updatedAt, ago, type Draft, type PullRequest, type Target, type Ticket, type TicketStore, type Writable, ticketsApi } from "./tickets";
import { sessionLabel, ticketKey, type Session, type SessionState, type SessionStore } from "./sessions";
import { harnessLogo } from "./harnessLogos";
import { UsagePanel, liveUsage, onShownHarness, shownHarness, windowSummary, type Usage, type UsageSource, type UsageWindow } from "./usage";
import { ServerList, type LocalServers, type Server } from "./servers";
import { kbdFor } from "./kbd";
import { markdown } from "./markdown";
import type { TermSession } from "./terminal";

/**
 * Home: every ticket assigned to you, on one board from backlog, to an
 * agent, to a pull request. Each card is a ticket with a stub on its left
 * that says who holds it: nobody yet (the service's logo), an agent (its
 * bot), or a pull request (its number).
 */

/** Where Home gets its data and how it acts on it; the design preview swaps in mocks. */
export interface HomeSource {
  /** `loading`: nothing read yet; `refreshing`: a read is under way. */
  tickets(): { connected: boolean; loading: boolean; refreshing: boolean; tickets: Ticket[]; errors: { provider: Provider; error: string }[] };
  sessions(): Session[];
  sessionState(session: Session): SessionState;
  agentFor(session: Session): Agent | undefined;
  /** Every agent Agent Monitor sees, ticket or not. */
  agents(): Agent[];
  /** The open GitHub pull request from `branch`, for its review state. */
  pullFor(branch: string): PullRequest | undefined;
  usage: UsageSource;
  /** Local web servers, running and recently stopped. */
  servers(): Server[];
  onChange(fn: () => void): void;
  /** Makes a worktree for the ticket and starts Claude on it; resolves "" if cancelled. */
  handOver(ticket: Ticket, branch: string): Promise<string>;
  /** Checks out the ticket's branch in a repo the user picks (no agent). */
  startBranch(ticket: Ticket, branch: string): Promise<string>;
  /** Goes to the session's pane, or picks it back up in a new one. */
  openSession(session: Session): void;
  /** Closes the session's pane and removes its worktree; resolves "" if the pane was kept. */
  endSession(session: Session): Promise<string>;
  jumpTo(agent: Agent): void;
  openUrl(url: string): void;
  openSettings(): void;
  /** Opens a tab in `dir` (home if undefined), running `command` if given. */
  openTab(dir?: string, command?: string): void;
  /** Shows `path` in Finder. */
  reveal(path: string): void;
  /** Why GitHub's pull requests couldn't be read, unless the tickets' error already says it; else "". */
  pullError(): string;
  openServer(server: Server): void;
  jumpToServer(session: TermSession): void;
  dismissServer(key: string): void;
  /** Re-reads the tickets: only stale services' unless `force`. */
  refresh(force?: boolean): void;
  /** Where a new ticket can be written: Workdesk, and each connected service that takes them. */
  writable(): Writable[];
  /** The repos or lists a new ticket on `provider` can go in. */
  targets(provider: Exclude<Writable, "workdesk">): Promise<Target[]>;
  /** Writes a ticket; it's in the backlog once this resolves. */
  createTicket(draft: Draft): Promise<Ticket>;
  /** Deletes one of Workdesk's own tickets, with Undo. */
  deleteTicket(ticket: Ticket): void;
}

const COMPOSE_KEY = "workdesk.newTicket";

/** What the last new ticket was written to, so the next starts there. */
interface ComposeMemory {
  provider: Writable;
  /** The last repo, list or project picked, per destination. */
  targets: Partial<Record<Writable, Target>>;
}

function loadCompose(): ComposeMemory {
  try {
    const saved = JSON.parse(localStorage.getItem(COMPOSE_KEY) ?? "{}");
    return { provider: WRITABLE.includes(saved.provider) ? saved.provider : "workdesk", targets: saved.targets ?? {} };
  } catch {
    return { provider: "workdesk", targets: {} };
  }
}

type Within = "any" | "1d" | "7d" | "30d";
const WITHIN: [Within, string, number][] = [
  ["any", "Any time", Infinity],
  ["1d", "Last 24 hours", 24 * 3600_000],
  ["7d", "Last 7 days", 7 * 24 * 3600_000],
  ["30d", "Last 30 days", 30 * 24 * 3600_000],
];

/** The backlog's filters, kept between visits. Statuses are compared without case or spaces, so "Todo" and "to do" are one. */
interface Filters {
  sources: Provider[];
  projects: string[];
  statuses: string[];
  within: Within;
}

const FILTERS_KEY = "workdesk.homeFilters";
/** Tickets per backlog page. */
const PAGE_SIZE = 8;
const statusKey = (t: Ticket) => t.status.toLowerCase().replace(/[\s_-]+/g, "");

/** A button offered with an error: what would put it right. */
interface Fix {
  label: string;
  run: () => void;
}

function loadFilters(): Filters {
  const fallback: Filters = { sources: [], projects: [], statuses: [], within: "any" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

/** Which lane a session's card sits in: with its agent while the agent is busy, else with its pull request if it has one. */
function laneOf(state: SessionState, session: Session): "agents" | "pulls" {
  if (state === "waiting" || state === "working") return "agents";
  return session.pull ? "pulls" : "agents";
}

const REVIEW: Record<NonNullable<PullRequest["review"]>, [string, string]> = {
  APPROVED: ["Approved", "var(--pr)"],
  CHANGES_REQUESTED: ["Changes requested", "var(--danger)"],
  REVIEW_REQUIRED: ["Review required", "var(--waiting)"],
};

function pill(text: string, color: string | null): HTMLElement {
  const p = el("span", "home-pill", text);
  if (color) p.style.setProperty("--status", color);
  return p;
}

const logoCache: Record<string, string> = {};
const logo = (p: Provider, size: number) => (logoCache[`${p}${size}`] ??= providerLogo(p, size));

function logoSpan(p: Provider, size: number): HTMLElement {
  const s = el("span", "home-logo");
  s.innerHTML = logo(p, size);
  s.title = providerName(p);
  return s;
}

/** The ISO 8601 week number of `date`. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
}

/** Sets `node`'s text only if it changed: every DOM write counts while WebKit is mid-bounce. */
function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

/** Replaces `parent`'s children only if they differ, so unchanged cards keep hover and focus. */
function sync(parent: HTMLElement, children: HTMLElement[]) {
  const current = [...parent.children];
  if (current.length !== children.length || children.some((c, i) => current[i] !== c)) parent.replaceChildren(...children);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export class HomePage extends Page {
  readonly title = "Home";
  private filters = loadFilters();
  private query = "";
  /** The backlog page showing, from 0. */
  private page = 0;
  private closeMenu: (() => void) | null = null;
  /** Built cards by key, with the signature they were built from. */
  private cards = new Map<string, { sig: string; el: HTMLElement }>();
  private flash: { el: HTMLElement; timer?: number } | null = null;
  /** The page's scroller. */
  private scroller: HTMLElement | null = null;
  /** What the filter button, chips and errors last showed, so they're only redrawn when that changes. */
  private shown = { filter: "", chips: "", errors: "" };
  private els: {
    backlogCount: HTMLElement;
    agentCount: HTMLElement;
    pullCount: HTMLElement;
    tools: HTMLElement;
    filter: HTMLButtonElement;
    reload: HTMLButtonElement;
    chips: HTMLElement;
    errors: HTMLElement;
    backlog: HTMLElement;
    pager: HTMLElement;
    agents: HTMLElement;
    pulls: HTMLElement;
    lanes: HTMLElement;
    empty: HTMLElement;
  } | null = null;

  constructor(
    host: HTMLElement,
    private source: HomeSource,
  ) {
    super(host);
    source.onChange(() => this.isOpen && this.render());
  }

  open() {
    super.open();
    this.source.refresh();
  }

  close() {
    clearTimeout(this.clockTimer);
    this.clock = null;
    this.closeMenu?.();
    this.closeTicket?.(false);
    this.closeDrawer?.(false);
    this.cards.clear();
    this.looseCards.clear();
    this.els = null;
    super.close();
  }

  protected build(body: HTMLElement): HTMLElement | null {
    body.classList.add("home-page");
    const root = el("div", "home");
    body.querySelector(".page-title")!.remove();

    const head = el("header", "home-head");
    // The heading stays for screen readers; the clock is the page's face.
    const text = el("div", "home-clock");
    const date = el("p", "home-date");
    const dateText = el("span", "");
    const week = el("span", "home-week");
    date.append(dateText, week);
    const timeRow = el("p", "home-time");
    const time = el("span", "home-time-hm");
    time.append(el("span", ""), el("span", "home-time-colon", ":"), el("span", ""));
    const period = el("span", "home-time-period");
    timeRow.append(time, period);
    text.append(el("h1", "home-sr", "Home"), date, timeRow);
    this.clock = { time, period, date: dateText, week };
    this.tick();
    // Claude's limits, with arrows to Codex's; it stops ticking once the page closes.
    const usage = new UsagePanel(this.source.usage, true);
    usage.root.classList.add("home-limits");
    const side = el("div", "home-side");
    this.serversTile = el("button", "home-servers");
    this.serversTile.addEventListener("click", () => this.openDrawer());
    this.shownServers = "";
    side.append(usage.root, this.serversTile);
    head.append(text, side);

    this.flash = { el: el("div", "home-flash") };
    this.flash.el.hidden = true;

    const lane = (key: string, name: string, last = false) => {
      const section = el("section", "home-lane");
      section.dataset.lane = key;
      const h = el("h2", "home-lane-head");
      const count = el("span", "home-lane-count");
      const rule = el("span", "home-lane-rule");
      if (!last) rule.append(icon(ArrowRight, 12));
      h.append(el("span", "home-lane-name", name), count, rule);
      section.append(h);
      return { section, count };
    };
    const backlog = lane("backlog", "Backlog");
    const agents = lane("agents", "With an agent");
    const pulls = lane("pulls", "Pull requests", true);

    // The backlog's search and filters stay put while its list redraws.
    const tools = el("div", "home-tools");
    const search = el("label", "home-search");
    const input = el("input", "");
    input.type = "search";
    input.placeholder = "Search tickets";
    input.spellcheck = false;
    input.value = this.query;
    input.setAttribute("aria-label", "Search the backlog");
    input.addEventListener("input", () => {
      this.query = input.value;
      this.page = 0;
      this.renderBacklog();
    });
    search.append(icon(Search, 13), input);
    const filter = el("button", "home-filter");
    filter.title = "Filter the backlog";
    filter.setAttribute("aria-haspopup", "dialog");
    filter.addEventListener("click", () => this.openFilters(filter));
    const reload = el("button", "home-reload");
    reload.title = "Refresh the backlog";
    reload.setAttribute("aria-label", "Refresh the backlog");
    reload.append(icon(RotateCcw, 13));
    reload.addEventListener("click", () => this.source.refresh(true));
    const write = el("button", "home-write");
    write.title = "Write a ticket in Workdesk, GitHub or ClickUp";
    write.setAttribute("aria-label", "New ticket");
    write.append(icon(Plus, 14), "New");
    write.addEventListener("click", () => this.openComposer());
    tools.append(search, filter, reload, write);
    const chips = el("div", "home-chips");
    const errors = el("div", "home-errors");
    const backlogList = el("div", "home-list");
    const pager = el("div", "home-pager");
    pager.hidden = true;
    backlog.section.append(tools, chips, errors, backlogList, pager);
    const agentBox = el("div", "home-lane-body");
    agents.section.append(agentBox);
    const pullBox = el("div", "home-lane-body");
    pulls.section.append(pullBox);

    const lanes = el("div", "home-lanes");
    lanes.append(backlog.section, agents.section, pulls.section);
    const empty = el("div", "home-connect");
    root.append(head, this.flash.el, empty, lanes);
    body.append(root);
    this.scroller = body.parentElement;
    this.shown = { filter: "", chips: "", errors: "" };

    this.els = {
      backlogCount: backlog.count,
      agentCount: agents.count,
      pullCount: pulls.count,
      tools,
      filter,
      reload,
      chips,
      errors,
      backlog: backlogList,
      pager,
      agents: agentBox,
      pulls: pullBox,
      lanes,
      empty,
    };
    this.render();
    usage.start();
    return input;
  }

  private render() {
    const e = this.els;
    if (!e) return;
    const { connected } = this.source.tickets();
    // With nothing connected, the backlog has nothing to show; agents and PRs still do.
    if (e.empty.hidden !== connected) e.empty.hidden = connected;
    if (!connected) this.renderConnect();
    this.renderServers();
    // Lay out after each lane, as Home does after each widget: redrawn as one
    // batch after a trackpad bounce at the bottom, WebKit scrolls the page
    // back to the top; one at a time, it stays put.
    for (const render of [() => this.renderBacklog(), () => this.renderAgents(), () => this.renderPulls()]) {
      render();
      void this.scroller?.offsetHeight;
    }
  }

  private renderConnect() {
    const box = this.els!.empty;
    if (box.childElementCount) return;
    const logos = el("div", "home-connect-logos");
    for (const p of PROVIDERS) logos.insertAdjacentHTML("beforeend", logo(p.id, 16));
    const text = el("div", "home-connect-text");
    text.append(el("strong", "", "Connect GitHub, Linear or ClickUp"), el("span", "", "Add a token in Settings → Integrations, and the tickets assigned to you fill the backlog."));
    const go = el("button", "home-connect-go");
    go.append(icon(Settings, 13), "Connect in Settings");
    go.addEventListener("click", () => this.source.openSettings());
    box.append(logos, text, go);
  }

  /** A card built once per key, rebuilt only when `sig` changes. */
  private card(key: string, sig: string, build: () => HTMLElement): HTMLElement {
    const known = this.cards.get(key);
    if (known && known.sig === sig) return known.el;
    const node = build();
    node.dataset.key = key;
    this.cards.set(key, { sig, el: node });
    return node;
  }

  private group(key: string, label: string, color: string | null, children: HTMLElement[]): HTMLElement {
    const g = this.card(`group:${key}`, label + color, () => {
      const g = el("div", "home-group");
      const l = el("div", "home-group-label");
      if (color) {
        const dot = el("span", "dot");
        dot.style.setProperty("--group-color", color);
        l.append(dot);
      }
      l.append(label);
      g.append(l, el("div", "home-list"));
      return g;
    });
    sync(g.querySelector<HTMLElement>(".home-list")!, children);
    return g;
  }

  private empty(title: string, text: string): HTMLElement {
    return this.card(`empty:${title}`, text, () => {
      const e = el("div", "home-empty");
      e.append(el("strong", "", title), el("span", "", text));
      return e;
    });
  }

  /** Says what happened. An error stays, with its fixes, until one is clicked or it's dismissed. */
  private showFlash(message: string, error = false, fixes: Fix[] = []) {
    const f = this.flash;
    if (!f || !message) return;
    clearTimeout(f.timer);
    const hide = () => (f.el.hidden = true);
    f.el.replaceChildren(el("span", "home-flash-text", message));
    if (error) {
      const actions = el("span", "home-fixes");
      for (const fix of fixes) {
        const b = el("button", "home-fix", fix.label);
        b.addEventListener("click", () => {
          hide();
          fix.run();
        });
        actions.append(b);
      }
      const x = el("button", "home-flash-x");
      x.title = "Dismiss";
      x.setAttribute("aria-label", "Dismiss");
      x.append(icon(X, 13));
      x.addEventListener("click", hide);
      actions.append(x);
      f.el.append(actions);
    } else f.timer = window.setTimeout(hide, 3500);
    f.el.classList.toggle("error", error);
    f.el.hidden = false;
  }

  /** Flashes how `p` went; if it failed, with a way to fix it or `retry`. */
  private report(p: Promise<string>, retry: () => void, run?: Session) {
    return p.then(
      (msg) => this.showFlash(msg),
      (e) => this.showFlash(String(e), true, this.actionFixes(String(e), retry, run)),
    );
  }

  /** What to offer when making or removing a worktree failed. */
  private actionFixes(error: string, retry: () => void, run?: Session): Fix[] {
    const again = { label: "Try again", run: retry };
    const checkedOut = error.match(/ is checked out in (.+?)\. Switch/);
    if (checkedOut) return [{ label: "Open a tab there", run: () => this.source.openTab(checkedOut[1]) }, again];
    const taken = error.match(/^(.+) already exists and isn't a worktree/);
    if (taken) return [{ label: "Show in Finder", run: () => this.source.reveal(taken[1]) }, again];
    if (/isn't in a git repo|bare repo/.test(error)) return [{ label: "Pick another folder", run: retry }];
    if (run && /has changes that aren't committed/.test(error)) return [{ label: "Open a tab there", run: () => this.source.openTab(run.path) }, again];
    return [again];
  }

  /** What to offer when reading a service failed. */
  private serviceFixes(provider: Provider, error: string): Fix[] {
    const settings = (label: string) => ({ label, run: () => this.source.openSettings() });
    if (/^Not connected/.test(error)) {
      const fixes = [settings("Connect")];
      if (provider === "github") fixes.push({ label: "Sign in with gh", run: () => this.source.openTab(undefined, "gh auth login") });
      return fixes;
    }
    if (/rejected the token/.test(error)) return [settings("Reconnect")];
    const fixes = [{ label: "Retry", run: () => this.source.refresh(true) }];
    if (/scope|permission|access/i.test(error)) fixes.push(settings("Open Settings"));
    return fixes;
  }

  /** A service's error, with its fixes. */
  private errorRow(provider: Provider, error: string): HTMLElement {
    const row = el("div", "home-error");
    row.append(logoSpan(provider, 13), el("span", "", error));
    const actions = el("span", "home-fixes");
    for (const fix of this.serviceFixes(provider, error)) {
      const b = el("button", "home-fix", fix.label);
      b.addEventListener("click", fix.run);
      actions.append(b);
    }
    row.append(actions);
    return row;
  }

  // ---- local servers: a tile in the header, and a drawer of them ----

  private serversTile: HTMLButtonElement | null = null;
  private shownServers = "";
  private serverList: ServerList | null = null;
  private closeDrawer: ((refocus?: boolean) => void) | null = null;

  private renderServers() {
    const tile = this.serversTile;
    if (!tile) return;
    const all = this.source.servers();
    const live = all.filter((s) => s.live);
    const key = `${live.length}/${all.length}`;
    if (key !== this.shownServers) {
      this.shownServers = key;
      tile.classList.toggle("live", live.length > 0);
      tile.title = "Show local servers";
      const text = el("span", "home-servers-text");
      // "3 local" over "servers", so the button stays narrow.
      const first = el("span", "");
      first.append(el("span", "home-servers-count", String(live.length)), " local");
      text.append(first, el("span", "", live.length === 1 ? "server" : "servers"));
      tile.replaceChildren(icon(EthernetPort, 30), text);
    }
    this.serverList?.update(all);
  }

  /** Opens Home with the servers drawer showing; again, closes the drawer. */
  showServers() {
    if (!this.isOpen) this.open();
    this.openDrawer();
  }

  /** The servers' cards, in a panel sliding in from the right. */
  private openDrawer() {
    if (this.closeDrawer) return this.closeDrawer();
    const returnFocus = document.activeElement as HTMLElement | null;
    const backdrop = el("div", "home-drawer-backdrop");
    const drawer = el("aside", "home-drawer");
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Local servers");
    const head = el("div", "home-drawer-head");
    const title = el("h2", "home-drawer-title", "Local servers");
    const hint = el("span", "home-drawer-hint");
    hint.append(kbdFor("openServers"));
    hint.title = "Shows or hides this from anywhere";
    const x = el("button", "home-modal-x");
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.append(icon(X, 15));
    head.append(title, hint, x);
    this.serverList = new ServerList(
      (session) => {
        close(false);
        this.source.jumpToServer(session);
      },
      (key) => this.source.dismissServer(key),
      (url) => {
        const s = this.source.servers().find((x) => `${x.scheme}://${x.host}:${x.port}` === url);
        if (s) this.source.openServer(s);
      },
    );
    this.serverList.update(this.source.servers());
    const body = el("div", "home-drawer-body");
    body.append(this.serverList.root);
    drawer.append(head, body);
    backdrop.append(drawer);
    document.body.append(backdrop);
    const close = (refocus = true) => {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      this.serverList = null;
      this.closeDrawer = null;
      if (refocus) returnFocus?.focus();
    };
    this.closeDrawer = close;
    x.addEventListener("click", () => close());
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    x.focus();
  }

  // ---- the clock ----

  private clock: { time: HTMLElement; period: HTMLElement; date: HTMLElement; week: HTMLElement } | null = null;
  private clockTimer: number | undefined;

  /** Redraws the clock just after each new second. */
  private tick() {
    this.renderClock();
    clearTimeout(this.clockTimer);
    this.clockTimer = window.setTimeout(() => this.isOpen && this.tick(), 1000 - (Date.now() % 1000) + 5);
  }

  private renderClock() {
    const c = this.clock;
    if (!c) return;
    const now = new Date();
    const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(now);
    // Always two digits ("09:00"), so the clock keeps one width all day.
    const hour = (parts.find((p) => p.type === "hour")?.value ?? "").padStart(2, "0");
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    // A mono colon fills a whole cell; its own span lets it sit tight between the digits.
    const [h, , m] = c.time.children as unknown as HTMLElement[];
    setText(h, hour);
    setText(m, minute);
    setText(c.period, parts.find((p) => p.type === "dayPeriod")?.value ?? "");
    setText(c.date, now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }));
    setText(c.week, `Week ${isoWeek(now)}`);
  }

  // ---- usage ----

  // ---- backlog ----

  /** Tickets nobody's working on yet. */
  private backlogTickets(): Ticket[] {
    const taken = new Set(this.source.sessions().flatMap((s) => (s.ticket ? [ticketKey(s.ticket)] : [])));
    return this.source
      .tickets()
      .tickets.filter((t) => !taken.has(ticketKey(t)))
      .sort((a, b) => updatedAt(b) - updatedAt(a));
  }

  private activeCount(): number {
    const f = this.filters;
    return f.sources.length + f.projects.length + f.statuses.length + (f.within === "any" ? 0 : 1);
  }

  private setFilters(change: Partial<Filters>) {
    Object.assign(this.filters, change);
    this.page = 0;
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(this.filters));
    } catch {}
    this.renderBacklog();
  }

  /** The backlog passing every filter except `skip`, so each section of the menu can count its own options. */
  private matching(skip?: keyof Filters): Ticket[] {
    const f = this.filters;
    const q = this.query.trim().toLowerCase();
    const span = WITHIN.find(([w]) => w === f.within)![2];
    const now = Date.now();
    return this.backlogTickets().filter(
      (t) =>
        (skip === "sources" || !f.sources.length || f.sources.includes(t.provider)) &&
        (skip === "projects" || !f.projects.length || f.projects.includes(t.project)) &&
        (skip === "statuses" || !f.statuses.length || f.statuses.includes(statusKey(t))) &&
        (skip === "within" || now - updatedAt(t) <= span) &&
        (!q || `${t.id} ${t.title} ${t.project} ${t.status}`.toLowerCase().includes(q)),
    );
  }

  private renderBacklog() {
    const e = this.els;
    if (!e) return;
    const { connected, errors, refreshing } = this.source.tickets();
    if (e.reload.classList.contains("spinning") !== refreshing) e.reload.classList.toggle("spinning", refreshing);
    const count = this.backlogTickets().length;
    setText(e.backlogCount, connected || count ? String(count) : "");

    // The filter button and a chip per active filter.
    const n = this.activeCount();
    if (this.shown.filter !== String(n)) {
      this.shown.filter = String(n);
      e.filter.replaceChildren(icon(ListFilter, 14), "Filter");
      if (n) e.filter.append(el("span", "home-filter-count", String(n)));
      e.filter.classList.toggle("active", n > 0);
    }
    this.renderChips();

    const errorsKey = errors.map((x) => `${x.provider}\0${x.error}`).join("\n");
    if (this.shown.errors !== errorsKey) this.renderErrors(errors, errorsKey);
    this.renderBacklogList();
  }

  private renderErrors(errors: { provider: Provider; error: string }[], key: string) {
    this.shown.errors = key;
    this.els!.errors.replaceChildren(...errors.map(({ provider, error }) => this.errorRow(provider, error)));
  }

  private renderBacklogList() {
    const e = this.els!;
    const { connected, loading } = this.source.tickets();
    const all = this.backlogTickets();
    const n = this.activeCount();
    this.renderPager(0);
    if (!connected && !all.length) return sync(e.backlog, [this.empty("No tickets yet", "Write one with New ticket, or connect a service above.")]);
    if (!all.length) {
      return sync(e.backlog, [
        loading ? this.empty("Reading your tickets…", "") : this.empty("Backlog's clear", "Write a ticket with New ticket; ones assigned to you on GitHub, Linear and ClickUp show up here too."),
      ]);
    }
    const matching = this.matching();
    // A page can empty out as tickets move along; step back to the last one.
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    this.page = Math.min(this.page, pages - 1);
    const shown = matching.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    this.renderPager(matching.length);
    const now = Date.now();
    const cards = shown.map((t) =>
      this.card(`ticket:${ticketKey(t)}`, `${t.title}\0${t.status}\0${t.color}\0${t.project}\0${ago(updatedAt(t), now)}`, () => this.backlogCard(t)),
    );
    if (!cards.length) {
      const none = el("div", "home-empty");
      none.append(el("strong", "", "No matches"), el("span", "", "Nothing in the backlog matches your search and filters."));
      if (n) {
        const clear = el("button", "home-chip-clear", "Clear filters");
        clear.addEventListener("click", () => this.setFilters({ sources: [], projects: [], statuses: [], within: "any" }));
        none.append(clear);
      }
      cards.push(none);
    }
    sync(e.backlog, cards);
  }

  /** "11–20 of 34" and previous/next, under the backlog when it's more than a page. */
  private renderPager(total: number) {
    const box = this.els!.pager;
    const pages = Math.ceil(total / PAGE_SIZE);
    const key = pages > 1 ? `${this.page}/${total}` : "";
    if (box.dataset.shown === key) return;
    box.dataset.shown = key;
    box.hidden = !key;
    if (!key) return box.replaceChildren();
    const first = this.page * PAGE_SIZE;
    const step = (node: Parameters<typeof icon>[0], label: string, to: number) => {
      const b = el("button", "home-step");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.disabled = to < 0 || to >= pages;
      b.append(icon(node, 14));
      b.addEventListener("click", () => {
        this.page = to;
        this.renderBacklogList();
        this.els?.backlog.closest(".home-lane")?.scrollIntoView({ block: "nearest" });
      });
      return b;
    };
    const nav = el("div", "home-steps");
    nav.append(step(ChevronLeft, "Previous page", this.page - 1), el("span", "home-page-of", `${this.page + 1} / ${pages}`), step(ChevronRight, "Next page", this.page + 1));
    box.replaceChildren(el("span", "home-range", `${first + 1}–${Math.min(first + PAGE_SIZE, total)} of ${total}`), nav);
  }

  private backlogCard(t: Ticket): HTMLElement {
    const card = el("div", "home-card backlog");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.title = `${t.id} · ${t.title}`;
    // Everything you can do with a ticket is in its details.
    const open = () => this.openTicket(t);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === card) {
        e.preventDefault();
        open();
      }
    });
    const stub = el("div", "home-stub");
    stub.innerHTML = logo(t.provider, 15);
    const body = el("div", "home-body");
    const line = el("div", "home-line");
    // The title gets the room; the ID is in the tooltip and the details.
    line.append(el("span", "home-name", t.title));
    const meta = el("div", "home-meta");
    const when = el("span", "home-when", ago(updatedAt(t)));
    when.title = `Updated ${new Date(updatedAt(t)).toLocaleString()}`;
    meta.append(pill(t.status, t.provider === "github" ? "var(--pr)" : t.color), el("span", "home-project", t.project), when);
    body.append(line, meta);
    card.append(stub, body);
    return card;
  }

  // ---- a ticket's details ----

  /** A modal with the ticket's description and details, and Hand to Claude. */
  private openTicket(t: Ticket) {
    this.closeTicket?.();
    const returnFocus = document.activeElement as HTMLElement | null;
    const branch = branchName(t);
    const backdrop = el("div", "home-modal-backdrop");
    const modal = el("div", "home-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "home-modal-title");

    const head = el("div", "home-modal-head");
    const where = el("div", "home-modal-where");
    where.append(logoSpan(t.provider, 14), el("span", "home-id", t.id), el("span", "home-modal-dot", "·"), el("span", "", t.project));
    const x = el("button", "home-modal-x");
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.append(icon(X, 15));
    head.append(where, x);

    const title = el("h2", "home-modal-title", t.title);
    title.id = "home-modal-title";
    const meta = el("div", "home-meta home-modal-meta");
    const when = el("span", "", `Updated ${ago(updatedAt(t))} ago`);
    when.title = new Date(updatedAt(t)).toLocaleString();
    const br = el("span", "home-modal-branch");
    br.title = "The branch Claude works on";
    br.append(icon(GitBranch, 12), el("span", "home-branch", branch));
    meta.append(pill(t.status, t.provider === "github" ? "var(--pr)" : t.color), when, br);

    const desc = el("div", "home-modal-desc");
    const body = t.body?.trim();
    if (body) desc.append(...markdown(body, (url) => this.source.openUrl(url)));
    else desc.append(el("p", "home-modal-none", "No description."));

    const foot = el("div", "home-modal-foot");
    const secondary = (node: Parameters<typeof icon>[0], label: string, run: () => void) => {
      const b = el("button", "home-modal-button");
      b.append(icon(node, 13), label);
      b.addEventListener("click", run);
      return b;
    };
    const hand = el("button", "home-hand home-modal-hand");
    hand.append(icon(Bot, 14), "Hand to Claude");
    hand.title = `Make a worktree for ${branch} and start Claude on ${t.id}`;
    const left = el("div", "home-modal-tools");
    const native = t.provider === "workdesk";
    if (!native) left.append(secondary(ArrowUpRight, `Open in ${providerName(t.provider)}`, () => this.source.openUrl(t.url)));
    left.append(
      secondary(GitBranchPlus, "Start branch", () => {
        close();
        const start = () => void this.report(this.source.startBranch(t, branch), start);
        start();
      }),
      secondary(Hash, "Copy ID", () => void copy(t.id).then(() => showToast(`Copied ${t.id}`))),
    );
    if (!native) left.append(secondary(Copy, "Copy link", () => void copy(t.url).then(() => showToast(`Copied link to ${t.id}`))));
    else
      left.append(
        secondary(Trash2, "Delete", () => {
          close();
          this.source.deleteTicket(t);
        }),
      );
    foot.append(left, hand);

    modal.append(head, title, meta, desc, foot);
    backdrop.append(modal);
    document.body.append(backdrop);

    const close = (refocus = true) => {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      this.closeTicket = null;
      if (refocus) returnFocus?.focus();
    };
    this.closeTicket = close;
    x.addEventListener("click", () => close());
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.addEventListener("keydown", (e) => {
      // Esc closes the modal, not the page under it.
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    hand.addEventListener("click", () => {
      close(false);
      const card = this.els?.backlog.querySelector<HTMLElement>(`[data-key="${CSS.escape(`ticket:${ticketKey(t)}`)}"]`);
      if (card) this.handOver(t, card);
    });
    hand.focus();
  }

  private closeTicket: ((refocus?: boolean) => void) | null = null;

  // ---- writing a ticket ----

  /** The repos and lists each service offered, read once per visit. */
  private targetCache = new Map<Writable, Promise<Target[]>>();

  /** A modal to write a ticket: where it goes (Workdesk, GitHub or ClickUp), a title and a description. */
  private openComposer() {
    this.closeTicket?.();
    const returnFocus = document.activeElement as HTMLElement | null;
    const memory = loadCompose();
    const writable = this.source.writable();
    let provider: Writable = writable.includes(memory.provider) ? memory.provider : "workdesk";

    const backdrop = el("div", "home-modal-backdrop");
    const modal = el("form", "home-modal home-compose");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "home-compose-title");

    const head = el("div", "home-modal-head");
    const heading = el("h2", "home-compose-heading", "New ticket");
    heading.id = "home-compose-title";
    const x = el("button", "home-modal-x");
    x.type = "button";
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.append(icon(X, 15));
    head.append(heading, x);

    // Where it goes: one button per destination, then the repo, list or project in it.
    const where = el("div", "home-compose-where");
    const dests = el("div", "home-compose-dests");
    dests.setAttribute("role", "radiogroup");
    dests.setAttribute("aria-label", "Write it in");
    const destButtons = writable.map((p) => {
      const b = el("button", "home-compose-dest");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.provider = p;
      b.append(logoSpan(p, 13), providerName(p));
      b.addEventListener("click", () => pick(p));
      return b;
    });
    dests.append(...destButtons);
    const targetBox = el("div", "home-compose-target");
    where.append(dests, targetBox);

    const title = el("input", "home-compose-title");
    title.placeholder = "Title";
    title.spellcheck = true;
    title.setAttribute("aria-label", "Title");
    const body = el("textarea", "home-compose-body");
    body.placeholder = "Describe it: what's wrong or wanted, and how you'll know it's done. Markdown works.\nThis is the brief Claude starts from.";
    body.setAttribute("aria-label", "Description");

    const error = el("div", "home-compose-error");
    error.hidden = true;
    const foot = el("div", "home-modal-foot");
    const hint = el("span", "home-compose-hint", "⌘↵ to create");
    const submit = el("button", "home-hand home-modal-hand");
    submit.type = "submit";
    foot.append(hint, submit);
    modal.append(head, where, title, body, error, foot);
    backdrop.append(modal);
    document.body.append(backdrop);

    /** The repo, list or project picked for the destination showing. */
    let target: () => Target | null = () => null;
    let loadToken = 0;

    const showError = (msg: string) => {
      error.textContent = msg;
      error.hidden = !msg;
    };

    const pick = (p: Writable) => {
      provider = p;
      showError("");
      for (const b of destButtons) b.setAttribute("aria-checked", String(b.dataset.provider === p));
      submit.replaceChildren(icon(Plus, 14), p === "workdesk" ? "Create ticket" : `Create in ${providerName(p)}`);
      const remembered = memory.targets[p];
      const token = ++loadToken;
      if (p === "workdesk") {
        // Workdesk's own tickets just name a project; known ones are suggested.
        const input = el("input", "home-compose-select");
        input.placeholder = "Project (optional)";
        input.setAttribute("aria-label", "Project");
        input.value = remembered?.name ?? "";
        const list = el("datalist", "");
        list.id = "home-compose-projects";
        const known = [...new Set(this.source.tickets().tickets.map((t) => t.project).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        list.append(...known.map((name) => Object.assign(document.createElement("option"), { value: name })));
        input.setAttribute("list", list.id);
        targetBox.replaceChildren(input, list);
        target = () => ({ id: input.value.trim(), name: input.value.trim() });
        return;
      }
      const noun = p === "github" ? "repo" : "list";
      const select = el("select", "home-compose-select");
      select.setAttribute("aria-label", p === "github" ? "Repo" : "List");
      select.disabled = true;
      select.append(new Option(`Reading your ${noun}s…`, ""));
      targetBox.replaceChildren(select);
      target = () => null;
      let cached = this.targetCache.get(p);
      if (!cached) {
        cached = this.source.targets(p);
        this.targetCache.set(p, cached);
        // A failed read is tried again next time.
        cached.catch(() => this.targetCache.delete(p));
      }
      cached.then(
        (targets) => {
          if (token !== loadToken) return;
          if (!targets.length) {
            select.replaceChildren(new Option(`No ${noun}s found`, ""));
            return;
          }
          select.replaceChildren(new Option(`Pick a ${noun}…`, ""), ...targets.map((t) => new Option(t.name, t.id)));
          if (remembered && targets.some((t) => t.id === remembered.id)) select.value = remembered.id;
          select.disabled = false;
          target = () => targets.find((t) => t.id === select.value) ?? null;
        },
        (e) => {
          if (token !== loadToken) return;
          select.replaceChildren(new Option(`Couldn't read your ${noun}s`, ""));
          showError(String(e));
        },
      );
    };
    pick(provider);

    const close = (refocus = true) => {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      this.closeTicket = null;
      if (refocus) returnFocus?.focus();
    };
    this.closeTicket = close;
    x.addEventListener("click", () => close());
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        modal.requestSubmit();
      }
    });
    let busy = false;
    modal.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      const t = target();
      if (!title.value.trim()) {
        showError("Give the ticket a title.");
        return title.focus();
      }
      if (!t) {
        showError(`Pick a ${provider === "github" ? "repo" : "list"} for it.`);
        return targetBox.querySelector<HTMLElement>("select, input")?.focus();
      }
      busy = true;
      submit.disabled = true;
      modal.classList.add("busy");
      showError("");
      const p = provider;
      void this.source.createTicket({ provider: p, target: t, title: title.value, body: body.value }).then(
        (ticket) => {
          try {
            localStorage.setItem(COMPOSE_KEY, JSON.stringify({ provider: p, targets: { ...memory.targets, [p]: t } }));
          } catch {}
          close();
          this.page = 0;
          this.render();
          this.showFlash(p === "workdesk" ? `Wrote ${ticket.id}` : `Created ${ticket.id} in ${ticket.project || providerName(p)}`);
          const card = this.els?.backlog.querySelector<HTMLElement>(`[data-key="${CSS.escape(`ticket:${ticketKey(ticket)}`)}"]`);
          card?.classList.add("arrived");
          card?.scrollIntoView({ block: "nearest" });
        },
        (err) => {
          busy = false;
          submit.disabled = false;
          modal.classList.remove("busy");
          showError(String(err));
        },
      );
    });
    title.focus();
  }

  /** Hands `t` to Claude; once its session shows up, the card flies over to the agent lane. */
  private handOver(t: Ticket, card: HTMLElement) {
    const from = card.getBoundingClientRect();
    card.classList.add("busy");
    void this.source.handOver(t, branchName(t)).then(
      (msg) => {
        card.classList.remove("busy");
        if (!msg) return;
        this.showFlash(msg);
        this.render();
        const session = this.source.sessions().find((s) => s.ticket && ticketKey(s.ticket) === ticketKey(t));
        const landed = session && this.els?.agents.querySelector<HTMLElement>(`[data-key="${CSS.escape(`session:${session.id}`)}"]`);
        if (landed) this.fly(card, from, landed);
      },
      (e) => {
        card.classList.remove("busy");
        // Try again from the ticket's card as it is by then.
        const retry = () => this.handOver(t, this.els?.backlog.querySelector<HTMLElement>(`[data-key="${CSS.escape(`ticket:${ticketKey(t)}`)}"]`) ?? card);
        this.showFlash(String(e), true, this.actionFixes(String(e), retry));
      },
    );
  }

  /** A copy of `card` glides from `from` to where `landed` is, which then flashes. */
  private fly(card: HTMLElement, from: DOMRect, landed: HTMLElement) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      landed.classList.add("arrived");
      return;
    }
    const to = landed.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add("home-flying");
    ghost.querySelector(".home-actions")?.remove();
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px` });
    landed.style.visibility = "hidden";
    document.body.append(ghost);
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px)`;
      ghost.style.width = `${to.width}px`;
    });
    const done = () => {
      ghost.remove();
      landed.style.visibility = "";
      landed.classList.add("arrived");
    };
    ghost.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 800);
  }

  private renderChips() {
    const box = this.els!.chips;
    const f = this.filters;
    const key = JSON.stringify(f);
    if (this.shown.chips === key) return;
    this.shown.chips = key;
    const chip = (label: Node | string, remove: () => void, prefix?: string) => {
      const c = el("button", "home-chip");
      c.title = "Remove this filter";
      if (prefix) c.append(el("span", "home-chip-key", prefix));
      c.append(label, icon(X, 11));
      c.addEventListener("click", remove);
      return c;
    };
    const parts: HTMLElement[] = [];
    for (const p of f.sources) {
      const l = el("span", "home-chip-logo");
      l.innerHTML = logo(p, 11);
      l.append(providerName(p));
      parts.push(chip(l, () => this.setFilters({ sources: f.sources.filter((x) => x !== p) })));
    }
    for (const p of f.projects) parts.push(chip(p, () => this.setFilters({ projects: f.projects.filter((x) => x !== p) }), "Project"));
    const names = new Map(this.source.tickets().tickets.map((t) => [statusKey(t), t.status]));
    for (const k of f.statuses) parts.push(chip(names.get(k) ?? k, () => this.setFilters({ statuses: f.statuses.filter((x) => x !== k) }), "Status"));
    if (f.within !== "any") parts.push(chip(WITHIN.find(([w]) => w === f.within)![1], () => this.setFilters({ within: "any" }), "Updated"));
    if (parts.length > 1) {
      const clear = el("button", "home-chip-clear", "Clear all");
      clear.addEventListener("click", () => this.setFilters({ sources: [], projects: [], statuses: [], within: "any" }));
      parts.push(clear);
    }
    box.replaceChildren(...parts);
    box.hidden = parts.length === 0;
  }

  /** The filter menu: source, status, project and when it was updated, each option with how many tickets it leaves. */
  private openFilters(anchor: HTMLElement) {
    if (this.closeMenu) return this.closeMenu();
    const menu = el("div", "home-menu");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Filter the backlog");
    const draw = () => {
      const f = this.filters;
      const all = this.backlogTickets();
      const section = (title: string) => {
        const s = el("div", "home-menu-section");
        s.append(el("div", "home-menu-title", title));
        return s;
      };
      const option = (on: boolean, round: boolean, label: (Node | string)[], count: number | null, apply: () => void) => {
        const b = el("button", "home-option");
        b.setAttribute("role", round ? "menuitemradio" : "menuitemcheckbox");
        b.setAttribute("aria-checked", String(on));
        const box = el("span", round ? "home-check round" : "home-check");
        box.append(icon(Check, 10));
        b.append(box, ...label);
        if (count !== null) b.append(el("span", "home-option-count", String(count)));
        b.addEventListener("click", () => {
          apply();
          draw();
        });
        return b;
      };
      const counts = (skip: keyof Filters, key: (t: Ticket) => string) => {
        const m = new Map<string, number>();
        for (const t of this.matching(skip)) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
        return m;
      };
      const toggle = <K extends "sources" | "projects" | "statuses">(field: K, v: Filters[K][number]) => () => {
        const list = this.filters[field] as string[];
        this.setFilters({ [field]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
      };

      const sources = section("Source");
      const sc = counts("sources", (t) => t.provider);
      const connected = new Set(this.source.tickets().tickets.map((t) => t.provider));
      for (const p of (["workdesk", ...PROVIDERS.map((p) => p.id)] as Provider[]).filter((p) => connected.has(p) || f.sources.includes(p)))
        sources.append(option(f.sources.includes(p), false, [logoSpan(p, 13), el("span", "home-option-label", providerName(p))], sc.get(p) ?? 0, toggle("sources", p)));

      const statuses = section("Status");
      const stc = counts("statuses", statusKey);
      const seen = new Map<string, Ticket>();
      for (const t of all) if (!seen.has(statusKey(t))) seen.set(statusKey(t), t);
      for (const [k, t] of seen) {
        const dot = el("span", "home-option-dot");
        dot.style.background = t.provider === "github" ? "var(--pr)" : (t.color ?? "var(--muted)");
        statuses.append(option(f.statuses.includes(k), false, [dot, el("span", "home-option-label", t.status)], stc.get(k) ?? 0, toggle("statuses", k)));
      }

      const projects = section("Project");
      const pc = counts("projects", (t) => t.project);
      for (const p of [...new Set(all.map((t) => t.project).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
        projects.append(option(f.projects.includes(p), false, [el("span", "home-option-label", p)], pc.get(p) ?? 0, toggle("projects", p)));

      const updated = section("Updated");
      for (const [w, label] of WITHIN) updated.append(option(f.within === w, true, [el("span", "home-option-label", label)], null, () => this.setFilters({ within: w })));

      const foot = el("div", "home-menu-foot");
      foot.append(el("span", "", `${this.matching().length} of ${all.length} tickets`));
      const clear = el("button", "home-chip-clear", "Clear all");
      clear.disabled = this.activeCount() === 0;
      clear.addEventListener("click", () => {
        this.setFilters({ sources: [], projects: [], statuses: [], within: "any" });
        draw();
      });
      foot.append(clear);

      const cols = el("div", "home-menu-cols");
      const left = el("div", "");
      left.append(sources, updated);
      const right = el("div", "");
      right.append(statuses, projects);
      cols.append(left, right);
      menu.replaceChildren(cols, foot);
    };
    draw();
    anchor.after(menu);
    anchor.classList.add("open");
    const onDown = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc closes the menu, not the page.
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
    };
    const close = () => {
      menu.remove();
      anchor.classList.remove("open");
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      this.closeMenu = null;
    };
    this.closeMenu = close;
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    menu.querySelector<HTMLElement>("button")?.focus();
  }

  // ---- agents ----

  private renderAgents() {
    const e = this.els!;
    const now = Date.now();
    const runs = this.source.sessions().map((run) => ({ run, state: this.source.sessionState(run), agent: this.source.agentFor(run) }));
    const here = runs.filter((r) => laneOf(r.state, r.run) === "agents");
    setText(e.agentCount, String(here.length));
    const card = (r: (typeof here)[number]) => {
      const a = r.agent;
      const sig = [r.state, a?.status, a ? faceOf(a, now) : "", a?.color, a?.lastLog.slice(-logLines()).join("\n"), a ? ago(a.since, now) : ago(r.run.startedAt, now)].join("\0");
      return this.card(`session:${r.run.id}`, sig, () => this.agentCard(r.run, r.state, a, now));
    };
    const waiting = here.filter((r) => r.state === "waiting" || r.agent?.status === "error");
    const busy = here.filter((r) => r.state === "working" && r.agent?.status !== "error");
    const stopped = here.filter((r) => !waiting.includes(r) && !busy.includes(r));

    const parts: HTMLElement[] = [];
    if (!here.length) parts.push(this.empty("No sessions", "Open a ticket in the backlog and choose Hand to Claude, or start one with ⌘⇧N."));
    if (waiting.length) parts.push(this.group("waiting", "Needs you", "var(--waiting)", waiting.map(card)));
    if (busy.length) parts.push(this.group("busy", "Working", "var(--accent)", busy.map(card)));
    if (stopped.length) parts.push(this.group("stopped", "Stopped without a pull request", "var(--faint)", stopped.map(card)));

    // Agents in panes that aren't in any session's worktree.
    const mine = new Set(runs.map((r) => r.agent?.session).filter(Boolean));
    const loose = this.source.agents().filter((a) => !mine.has(a.session));
    if (loose.length) {
      // The ones that need you first, then busy, then idle.
      const rank = (a: Agent) => (a.status === "waiting" || a.status === "error" ? 0 : a.status === "idle" ? 2 : 1);
      // Agent Monitor's own card, kept per pane and filled in place each poll.
      for (const s of this.looseCards.keys()) if (!loose.some((a) => a.session === s)) this.looseCards.delete(s);
      const cards = [...loose]
        .sort((x, y) => rank(x) - rank(y))
        .map((a) => {
          let card = this.looseCards.get(a.session);
          if (!card) {
            card = agentCard(() => this.source.jumpTo(a));
            this.looseCards.set(a.session, card);
          }
          fillAgentCard(card, a, now);
          return card;
        });
      parts.push(this.group("loose", "Not in a session", null, cards));
    }
    sync(e.agents, parts);
  }

  private agentCard(run: Session, state: SessionState, a: Agent | undefined, now: number): HTMLElement {
    // A div acting as a button: a stopped run's card holds a button of its own.
    const card = el("div", "home-card agent");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.status = a?.status ?? "stopped";
    card.style.setProperty("--bot", a?.color ?? "var(--faint)");
    card.title = a ? `Go to the ${a.tabTitle} tab` : `Resume Claude on ${sessionLabel(run)} in a new tab`;
    card.addEventListener("click", () => this.source.openSession(run));
    card.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === card) {
        e.preventDefault();
        this.source.openSession(run);
      }
    });
    const face: BotFace = a ? faceOf(a, now) : "sleep";
    const stub = el("div", "home-stub");
    stub.innerHTML = botSvg(face);
    stub.append(el("span", "home-badge", a ? BADGE_LABELS[a.status] : "Stopped"));
    const body = el("div", "home-body");
    const line = el("div", "home-line");
    line.append(...this.sessionTitle(run), el("span", "home-when", ago(a?.since ?? run.startedAt, now)));
    body.append(line);
    const log = a?.lastLog.slice(-logLines()) ?? [];
    if (log.length && a?.status !== "idle") {
      const box = el("div", "home-log");
      for (const l of log) box.append(el("div", "", l));
      body.append(box);
    }
    const meta = el("div", "home-meta");
    const tab = el("span", "home-tab");
    tab.title = a ? `Tab ${a.tabTitle}` : "No tab";
    meta.append(tab, el("span", "home-branch", run.branch));
    if (state === "waiting") {
      const go = el("span", "home-answer");
      go.append("Answer in its tab", icon(ArrowRight, 12));
      meta.append(go);
    } else if (a?.status === "error") {
      const go = el("span", "home-answer");
      go.append("Hit an error · open its tab", icon(ArrowRight, 12));
      meta.append(go);
    } else if (!a) {
      meta.append(el("span", "home-note", "Claude isn't running · click to resume"));
    } else if (a.status === "idle") {
      meta.append(el("span", "home-note", "Finished talking, no pull request yet"));
    }
    body.append(meta);
    card.append(stub, body);
    // A stopped session can be ended here too.
    if (!a) {
      const actions = el("div", "home-actions");
      const clean = el("button", "home-action");
      clean.title = "End the session: remove the worktree (keeps the branch)";
      clean.setAttribute("aria-label", clean.title);
      clean.append(icon(Trash2, 13));
      clean.addEventListener("click", (e) => {
        e.stopPropagation();
        const remove = () => void this.report(this.source.endSession(run), remove, run);
        remove();
      });
      actions.append(clean);
      card.append(actions);
    }
    return card;
  }

  /** A session card's title: its ticket's logo, id and title, or its name and repo when it has no ticket. */
  private sessionTitle(s: Session, title?: string): HTMLElement[] {
    const t = s.ticket;
    if (t) return [logoSpan(t.provider, 12), el("span", "home-id", t.id), el("span", "home-name", title || t.title)];
    const bot = el("span", "home-logo");
    bot.append(icon(Bot, 12));
    return [bot, el("span", "home-id", s.name), el("span", "home-name", title || s.repo)];
  }

  /** Agent Monitor cards for agents with no session, by pane. */
  private looseCards = new Map<TermSession, HTMLElement>();

  // ---- pull requests ----

  private renderPulls() {
    const e = this.els!;
    const now = Date.now();
    const runs = this.source
      .sessions()
      .map((run) => ({ run, state: this.source.sessionState(run), agent: this.source.agentFor(run) }))
      .filter((r) => laneOf(r.state, r.run) === "pulls");
    const open = runs.filter((r) => r.run.pull!.state === "OPEN");
    const done = runs.filter((r) => r.run.pull!.state !== "OPEN");
    setText(e.pullCount, String(open.length));
    const card = (r: (typeof runs)[number]) => {
      const gh = this.source.pullFor(r.run.branch);
      const p = r.run.pull!;
      const sig = [p.state, p.number, p.title, p.draft, gh?.review, gh?.draft, r.agent?.color, r.agent?.tabTitle, ago(r.run.startedAt, now)].join("\0");
      return this.card(`session:${r.run.id}`, sig, () => this.pullCard(r.run, r.agent, gh));
    };
    const parts: HTMLElement[] = [];
    const error = this.source.pullError();
    if (error) parts.push(this.card("pull-error", error, () => this.errorRow("github", error)));
    if (!runs.length) parts.push(this.empty("No pull requests yet", "When a session's agent opens one, the session moves here."));
    if (open.length) parts.push(this.group("open", "Open", null, open.map(card)));
    if (done.length) parts.push(this.group("done", "Merged or closed", "var(--merged)", done.map(card)));
    sync(e.pulls, parts);
  }

  private pullCard(run: Session, agent: Agent | undefined, gh: PullRequest | undefined): HTMLElement {
    const p = run.pull!;
    const card = el("div", "home-card pull");
    card.tabIndex = 0;
    card.dataset.state = p.state;
    const review = gh?.review ?? null;
    card.dataset.review = review ?? "";
    card.title = `Open pull request #${p.number} in your browser`;
    const open = () => this.source.openUrl(p.url);
    card.addEventListener("click", (e) => {
      if (!(e.target as Element).closest("button")) open();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === card) open();
    });
    const stub = el("div", "home-stub");
    stub.append(icon(p.state === "MERGED" ? GitMerge : p.state === "CLOSED" ? GitPullRequestClosed : GitPullRequest, 15), el("span", "", `#${p.number}`));
    const body = el("div", "home-body");
    const line = el("div", "home-line");
    line.append(...this.sessionTitle(run, p.title));
    const meta = el("div", "home-meta");
    if (p.state === "OPEN") {
      const draft = gh?.draft ?? p.draft;
      const [label, color] = draft ? ["Draft", "var(--muted)"] : review ? REVIEW[review] : ["Open", "var(--pr)"];
      meta.append(pill(label, color));
    } else {
      meta.append(pill(p.state === "MERGED" ? "Merged" : "Closed", p.state === "MERGED" ? "var(--merged)" : "var(--danger)"));
      const clean = el("button", "home-cleanup");
      clean.append(icon(Trash2, 12), "End session");
      clean.title = p.state === "MERGED" ? `Remove the worktree and ${run.branch}` : "Remove the worktree (keeps the branch)";
      clean.addEventListener("click", () => {
        const remove = () => {
          card.classList.add("leaving");
          void this.report(this.source.endSession(run), remove, run).finally(() => card.classList.remove("leaving"));
        };
        remove();
      });
      meta.append(clean);
    }
    if (agent) {
      const holder = el("button", "home-holder");
      holder.style.setProperty("--bot", agent.color);
      holder.innerHTML = botSvg("idle");
      holder.append(`Tab ${agent.tabTitle} open`);
      holder.title = `Go to the ${agent.tabTitle} tab`;
      holder.addEventListener("click", () => this.source.openSession(run));
      meta.append(holder);
    }
    meta.append(el("span", "home-branch", run.repo));
    body.append(line, meta);
    card.append(stub, body);
    return card;
  }
}

// ---- the real data ----

/** Home fed by the ticket store, the run store and Agent Monitor. */
export function liveHomeSource(
  tickets: TicketStore,
  sessions: SessionStore,
  monitor: AgentMonitor,
  servers: LocalServers,
  actions: Pick<
    HomeSource,
    | "handOver"
    | "startBranch"
    | "openSession"
    | "endSession"
    | "jumpTo"
    | "openUrl"
    | "openSettings"
    | "openTab"
    | "reveal"
    | "openServer"
    | "jumpToServer"
    | "dismissServer"
  >,
): HomeSource {
  return {
    tickets: () => ({
      connected: tickets.connected.length > 0,
      loading: tickets.connected.some((p) => !tickets.state.get(p)!.at),
      refreshing: tickets.loading,
      tickets: tickets.tickets,
      errors: tickets.connected.map((provider) => ({ provider, error: tickets.state.get(provider)!.error })).filter((e) => e.error),
    }),
    sessions: () => sessions.all,
    sessionState: (s) => sessions.state(s),
    agentFor: (s) => sessions.agentFor(s),
    agents: () => monitor.current,
    pullError: () => {
      const error = tickets.hasPulls ? tickets.pullState.error : "";
      return error === tickets.state.get("github")!.error ? "" : error;
    },
    pullFor: (branch) => tickets.pulls.find((p) => p.kind === "authored" && p.branch === branch),
    usage: liveUsage,
    servers: () => servers.current,
    onChange: (fn) => {
      tickets.onChange(fn);
      sessions.onChange(fn);
      monitor.onChange(fn);
      servers.onChange(fn);
    },
    refresh: (force = false) => void tickets.refresh(force),
    writable: () => WRITABLE.filter((p) => p === "workdesk" || tickets.connected.includes(p)),
    targets: (p) => ticketsApi.targets(p),
    createTicket: (d) => tickets.create(d),
    deleteTicket: (t) => {
      const gone = tickets.removeNative(t.id);
      if (gone) showToast(`Deleted ${t.id}`, 5000, { label: "Undo", run: () => tickets.restoreNative(gone) });
    },
    ...actions,
  };
}

// ---- the sidebar row ----

export class HomeRow {
  private shown = "";
  private usage: Usage | null = null;

  constructor(
    private slot: HTMLElement,
    private page: HomePage,
    private monitor?: AgentMonitor,
    private usageSource: UsageSource = liveUsage,
  ) {
    Page.onChange(() => this.render());
    // With Agent Monitor gone, Home's row says when an agent needs you.
    monitor?.onChange(() => this.render());
    onShownHarness(() => this.render());
    this.render();
    // The 5-hour limit under the title: the numbers change slowly, the reset countdown by the minute.
    const fetch = () =>
      void this.usageSource
        .status()
        .then((u) => {
          this.usage = u;
          this.render();
        })
        .catch(() => {});
    fetch();
    setInterval(fetch, 30_000);
  }

  /** The 5-hour window of the harness Home's usage card is showing, or null with no numbers yet. */
  private limit() {
    const harness = shownHarness();
    const windows = this.usage?.[harness]?.windows ?? [];
    const five = windows.find((w) => w.minutes === 300) ?? windows.reduce<UsageWindow | undefined>((a, b) => (!a || b.minutes < a.minutes ? b : a), undefined);
    return { harness, name: harness === "claude" ? "Claude" : "Codex", window: five ? windowSummary(five) : null };
  }

  private render() {
    const attention = this.monitor?.current.filter(needsYou) ?? [];
    const error = attention.some((a) => a.status === "error");
    const limit = this.limit();
    const key = `${Page.current === this.page}/${attention.length}/${error}/${JSON.stringify(limit)}`;
    if (key === this.shown) return;
    this.shown = key;
    const row = el("button", "tab monitor-row home-row");
    row.type = "button";
    if (Page.current === this.page) row.classList.add("active");
    row.dataset.tip = attention.length ? `Home · ${attention.length} agent${attention.length === 1 ? " needs" : "s need"} you` : "Home";
    const glyph = el("span", "monitor-icon home-icon");
    glyph.append(icon(House, 14));
    const hint = el("span", "tab-hint");
    hint.append(kbdFor("openHome"));

    const w = limit.window;
    const text = el("span", "home-row-text");
    const line = el("span", "home-row-limit");
    line.title = `${limit.harness === "claude" ? "Claude Code" : "Codex"}'s 5-hour limit`;
    const logo = el("span", "home-row-logo");
    logo.innerHTML = harnessLogo(limit.harness, 10);
    const meter = el("span", "home-row-meter");
    const fill = el("i", "");
    fill.style.width = `${w?.percent ?? 0}%`;
    meter.append(fill);
    line.append(el("b", "", w ? w.used : "No usage yet"), meter);
    if (w?.resetsAt) line.append(el("span", "home-row-reset", w.resetsAt));
    // Whose limit it is, at the far right.
    line.append(logo);
    // The icon sits on the title's line, so the limit starts under it.
    const head = el("span", "home-row-head");
    head.append(glyph, el("span", "tab-title", "Home"));
    text.append(head, line);
    row.append(text);
    if (attention.length) {
      const badge = el("span", "monitor-badge", String(attention.length));
      if (error) badge.classList.add("error");
      row.append(badge);
    }
    row.append(hint);
    // Clicking it while Home is open keeps you there.
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.page.open();
    });
    this.slot.replaceChildren(row);
  }
}
