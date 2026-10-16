import { Page, el } from "./page";
import { ArrowUpRight, GitPullRequest, House, Orbit, icon } from "./icons";
import { kbdFor } from "./kbd";
import { GROUP_COLORS, type Workspace } from "./workspace";
import { tildePath } from "./favorites";
import { fontStack, onFontChange } from "./fonts";
import { botSvg } from "./bot";
import { harnessLogo } from "./harnessLogos";
import { providerLogo } from "./providerLogos";
import { BADGE_LABELS, HARNESS_NAMES, faceOf, sectionOf, type Agent } from "./monitor";
import { ago, providerName, pullStatus, updatedAt, type PullRequest, type Ticket, type TicketStore } from "./tickets";
import { serverUrl, type Server } from "./servers";
import type { Action } from "./shortcuts";
import type { TermSession } from "./terminal";

/** A sidebar tab as its Home card shows it. */
export interface HomeTerminal {
  id: number;
  title: string;
  /** Its group's name, if it's in one. */
  group: string | null;
  /** Its tab's color, as CSS. */
  color: string;
  /** Where the focused pane's shell is, with ~ for home. */
  cwd: string;
  /** What's running in it, when that's not just the shell. */
  running: string | null;
  panes: number;
  /** The focused pane's last lines on screen, oldest first. */
  lines: string[];
}

export interface HomeTickets {
  connected: boolean;
  loading: boolean;
  /** Newest first. */
  tickets: Ticket[];
}

export interface HomePulls {
  /** GitHub is connected, so there are pull requests to list. */
  available: boolean;
  /** They've been read at least once. */
  loaded: boolean;
  /** Open and not dismissed, in any order. */
  pulls: PullRequest[];
}

/** Everything Home shows, and what its links do. The app reads the workspace; the preview page feeds mocks. */
export interface HomeSource {
  terminals(): HomeTerminal[];
  agents(): Agent[];
  tickets(): HomeTickets;
  pulls(): HomePulls;
  /** Live and stopped; Home shows the live ones. */
  servers(): Server[];
  /** Calls `fn` whenever agents, tickets, pull requests or servers change. */
  onChange(fn: () => void): void;
  openTab(id: number): void;
  jumpToAgent(session: TermSession): void;
  openTicket(ticket: Ticket): void;
  openServer(server: Server): void;
  openPull(pull: PullRequest): void;
  teleport(): void;
  open(page: "tickets" | "monitor" | "servers" | "integrations"): void;
}

const MAX_TERMINALS = 6;
const MAX_TICKETS = 5;
const MAX_AGENTS = 6;
const MAX_SERVERS = 4;
const MAX_PULLS = 5;
/** Lines of each terminal's screen shown on its card. */
const SCREEN_LINES = 7;
/** How often the terminal cards re-read their screens. */
const SCREEN_MS = 1000;

const SHELLS = /^-?(zsh|bash|fish|sh|nu|tcsh|ksh|login)$/;
/** Agent harnesses name their process by version ("2.1.299"), which says nothing. */
const VERSION = /^\d+(\.\d+)+$/;

/** A glimpse of everything: the time, your tabs, tickets and agents, and a way to Teleport. */
export class HomePage extends Page {
  readonly title = "Home";
  private timers: number[] = [];
  /** The page's scroller. */
  private scroller: HTMLElement | null = null;
  private clock: { time: HTMLElement; period: HTMLElement; date: HTMLElement; week: HTMLElement } | null = null;
  private terminalGrid: HTMLElement | null = null;
  private terminalCount: HTMLElement | null = null;
  private ticketBox: HTMLElement | null = null;
  private ticketCount: HTMLElement | null = null;
  private agentBox: HTMLElement | null = null;
  private agentCount: HTMLElement | null = null;
  private serverBox: HTMLElement | null = null;
  private serverCount: HTMLElement | null = null;
  private serverKey = "";
  private pullSection: HTMLElement | null = null;
  private pullBox: HTMLElement | null = null;
  private pullCount: HTMLElement | null = null;
  private pullKey = "";
  private cards = new Map<number, HTMLElement>();
  private agentRows = new Map<TermSession, HTMLElement>();
  private ticketKey = "";

  constructor(
    host: HTMLElement,
    private source: HomeSource,
  ) {
    super(host);
    onFontChange(() => this.terminalGrid?.closest<HTMLElement>(".home-body")?.style.setProperty("--term-font", fontStack()));
    source.onChange(() => {
      if (!this.isOpen) return;
      // Lay out after each widget. Redrawn as one batch after a trackpad
      // bounce at the bottom, WebKit scrolled the page back up to the clock
      // every couple of seconds; one at a time, it stays put.
      for (const render of [() => this.renderAgents(), () => this.renderTickets(), () => this.renderServers(), () => this.renderPulls()]) {
        render();
        void this.scroller?.offsetHeight;
      }
    });
  }

  open() {
    super.open();
    this.tick();
    this.timers.push(window.setInterval(() => this.renderTerminals(), SCREEN_MS));
  }

  close() {
    for (const t of this.timers) clearInterval(t), clearTimeout(t);
    this.timers = [];
    super.close();
  }

  /** Redraws the clock on each new second. */
  private tick() {
    this.renderClock();
    this.timers.push(window.setTimeout(() => this.isOpen && this.tick(), 1000 - (Date.now() % 1000) + 5));
  }

  /** Re-reads everything; the terminal cards also refresh on their own. */
  refresh() {
    if (!this.isOpen) return;
    this.renderTerminals();
    this.renderAgents();
    this.renderTickets();
    this.renderServers();
    this.renderPulls();
  }

  protected build(body: HTMLElement): HTMLElement | null {
    body.classList.add("home-body");
    // The screens use the terminal's own font, so prompt glyphs (Nerd Fonts, powerline) draw as they do in the pane.
    body.style.setProperty("--term-font", fontStack());
    this.cards.clear();
    this.agentRows.clear();
    this.ticketKey = "";
    this.serverKey = "";
    this.pullKey = "";

    // The heading stays for screen readers; the clock is the page's face.
    body.querySelector(".page-title")!.classList.add("visually-hidden");

    const hero = el("header", "home-hero");
    const clock = el("div", "home-clock");
    const date = el("p", "home-date");
    const dateText = el("span", "");
    const week = el("span", "home-week");
    date.append(dateText, week);
    const timeRow = el("p", "home-time");
    const time = el("span", "home-time-hm");
    time.append(el("span", ""), el("span", "home-time-colon", ":"), el("span", ""));
    const period = el("span", "home-time-period");
    timeRow.append(time, period);
    clock.append(date, timeRow);
    this.clock = { time, period, date: dateText, week };

    // The CTA is Teleport's own input, docked: clicking it opens the palette.
    const teleport = el("button", "home-teleport");
    teleport.type = "button";
    teleport.setAttribute("aria-label", "Teleport: open a tab in another folder");
    const field = el("span", "home-teleport-field");
    field.append(icon(Orbit, 18, "home-teleport-icon"), el("span", "home-teleport-text", "Teleport to…"), el("span", "home-teleport-caret"));
    field.append(kbdFor("newTabIn"));
    teleport.append(el("span", "home-teleport-label", "Open a tab in any folder, run a macro or a loadout"), field);
    teleport.addEventListener("click", () => this.source.teleport());
    hero.append(clock, teleport);

    const terminals = el("section", "home-section home-terminals");
    this.terminalCount = el("span", "home-count");
    terminals.append(this.heading("Terminals", this.terminalCount));
    this.terminalGrid = el("div", "home-terminal-grid");
    terminals.append(this.terminalGrid);

    const lower = el("div", "home-lower");
    const tickets = el("section", "home-section home-tickets");
    this.ticketCount = el("span", "home-count");
    tickets.append(this.heading("Tickets", this.ticketCount, "All tickets", "openTickets", () => this.source.open("tickets")));
    this.ticketBox = el("div", "home-ticket-box");
    tickets.append(this.ticketBox);

    const agents = el("section", "home-section home-agents");
    this.agentCount = el("span", "home-count");
    agents.append(this.heading("Agents", this.agentCount, "Agent Monitor", "openMonitor", () => this.source.open("monitor")));
    this.agentBox = el("div", "home-agent-list");
    agents.append(this.agentBox);

    // A small widget under the tickets: just what's up and on which port.
    const servers = el("section", "home-section home-servers");
    this.serverCount = el("span", "home-count");
    servers.append(this.heading("Local Servers", this.serverCount, "All servers", "openServers", () => this.source.open("servers")));
    this.serverBox = el("div", "home-server-list");
    servers.append(this.serverBox);

    const main = el("div", "home-side");
    main.append(tickets, servers);
    // Pull requests sit under the agents; they live on the Tickets page, so that's where the link goes.
    const pulls = el("section", "home-section home-pulls");
    this.pullCount = el("span", "home-count");
    pulls.append(this.heading("Pull requests", this.pullCount, "All tickets", "openTickets", () => this.source.open("tickets")));
    this.pullBox = el("div", "home-pull-list");
    pulls.append(this.pullBox);
    this.pullSection = pulls;

    const side = el("div", "home-side");
    side.append(agents, pulls);
    lower.append(main, side);

    body.append(hero, terminals, lower);
    this.scroller = body.parentElement;
    this.renderClock();
    this.refresh();
    return teleport;
  }

  private heading(title: string, count: HTMLElement, link?: string, action?: Action, onClick?: () => void): HTMLElement {
    const head = el("div", "home-heading");
    const h = el("h2", "home-heading-title");
    h.append(el("span", "", title), count);
    head.append(h);
    if (link && action && onClick) {
      const button = el("button", "home-link");
      button.type = "button";
      button.append(el("span", "", link), kbdFor(action));
      button.addEventListener("click", onClick);
      head.append(button);
    }
    return head;
  }

  // ---- the clock ----

  private renderClock() {
    const c = this.clock;
    if (!c) return;
    const now = new Date();
    const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(now);
    // Always two digits ("09:00"), so the clock keeps one width all day.
    const hour = (parts.find((p) => p.type === "hour")?.value ?? "").padStart(2, "0");
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    // A mono colon fills a whole cell; its own span lets it sit tight between the digits.
    const [h, , m] = c.time.children;
    setText(h, hour);
    setText(m, minute);
    setText(c.period, parts.find((p) => p.type === "dayPeriod")?.value ?? "");
    setText(c.date, now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }));
    setText(c.week, `Week ${isoWeek(now)}`);
  }

  // ---- terminals ----

  private renderTerminals() {
    const grid = this.terminalGrid;
    if (!grid) return;
    const all = this.source.terminals();
    setText(this.terminalCount, String(all.length));
    if (all.length === 0) {
      this.cards.clear();
      grid.replaceChildren(empty("No tabs open", "Teleport to a folder to open one."));
      return;
    }
    const shown = all.slice(0, MAX_TERMINALS);
    for (const id of this.cards.keys()) if (!shown.some((t) => t.id === id)) this.cards.delete(id);
    const cards: HTMLElement[] = shown.map((t) => {
      let card = this.cards.get(t.id);
      if (!card) {
        card = this.terminalCard(t.id);
        this.cards.set(t.id, card);
      }
      fillTerminal(card, t);
      return card;
    });
    if (all.length > shown.length) {
      const more = grid.querySelector<HTMLElement>(".home-more") ?? el("p", "home-more");
      setText(more, `+${all.length - shown.length} more in the sidebar`);
      cards.push(more);
    }
    placeChildren(grid, cards);
  }

  private terminalCard(id: number): HTMLElement {
    const card = el("button", "home-term");
    card.type = "button";
    const screen = el("div", "home-term-screen");
    const foot = el("div", "home-term-foot");
    const name = el("span", "home-term-name");
    name.append(el("span", "home-term-dot"), el("span", "home-term-group"), el("span", "home-term-title"));
    foot.append(name, el("span", "home-term-running"), el("span", "home-term-panes"));
    card.append(screen, foot, el("span", "home-term-cwd"));
    card.addEventListener("click", () => this.source.openTab(id));
    return card;
  }

  // ---- tickets ----

  private renderTickets() {
    const box = this.ticketBox;
    if (!box) return;
    const { connected, loading, tickets } = this.source.tickets();
    setText(this.ticketCount, connected && tickets.length ? String(tickets.length) : "");
    const shown = tickets.slice(0, MAX_TICKETS);
    const key = [connected, loading && !tickets.length, ...shown.map((t) => `${t.provider}${t.id}\0${t.title}\0${t.status}\0${t.updated}`)].join("\n");
    if (key === this.ticketKey) return;
    this.ticketKey = key;

    if (!connected) {
      const note = empty("No services connected", "Connect GitHub, Linear or ClickUp to see the tickets assigned to you here.");
      const button = el("button", "home-button", "Connect a service");
      button.type = "button";
      button.addEventListener("click", () => this.source.open("integrations"));
      note.append(button);
      box.replaceChildren(note);
      return;
    }
    if (!tickets.length) {
      box.replaceChildren(loading ? empty("Reading your tickets…", "") : empty("Nothing assigned to you", "New tickets assigned to you show up here."));
      return;
    }
    const table = el("table", "home-ticket-table");
    const tbody = el("tbody", "");
    for (const t of shown) {
      const row = el("tr", "home-ticket");
      row.dataset.provider = t.provider;
      const logo = el("td", "home-ticket-logo");
      logo.innerHTML = providerLogo(t.provider, 13);
      logo.title = providerName(t.provider);
      const title = el("td", "home-ticket-title");
      const open = el("button", "home-ticket-open", t.title);
      open.type = "button";
      open.title = `${t.title}\n${t.project}`;
      open.addEventListener("click", () => this.source.openTicket(t));
      title.append(open);
      const status = el("span", "ticket-status");
      if (t.color) status.style.setProperty("--status", t.color);
      status.append(el("span", "ticket-status-dot"), el("span", "ticket-status-text", t.status));
      const statusCell = el("td", "home-ticket-status");
      statusCell.append(status);
      row.append(logo, el("td", "home-ticket-id", t.id), title, statusCell, el("td", "home-ticket-age", ago(updatedAt(t))));
      // The whole row opens it; the title button is what the keyboard reaches.
      row.addEventListener("click", (e) => {
        if (!(e.target as Element).closest("button")) this.source.openTicket(t);
      });
      tbody.append(row);
    }
    table.append(tbody);
    box.replaceChildren(table);
  }

  // ---- agents ----

  private renderAgents() {
    const box = this.agentBox;
    if (!box) return;
    const order = { needs: 0, active: 1, idle: 2 };
    const all = [...this.source.agents()].sort((a, b) => order[sectionOf(a)] - order[sectionOf(b)]);
    setText(this.agentCount, all.length ? String(all.length) : "");
    if (all.length === 0) {
      this.agentRows.clear();
      box.replaceChildren(empty("No agents running", "Start claude, codex or opencode in any tab and it shows up here."));
      return;
    }
    const shown = all.slice(0, MAX_AGENTS);
    for (const s of this.agentRows.keys()) if (!shown.some((a) => a.session === s)) this.agentRows.delete(s);
    const now = Date.now();
    const rows: HTMLElement[] = shown.map((a) => {
      let row = this.agentRows.get(a.session);
      if (!row) {
        row = this.agentRow(a.session);
        this.agentRows.set(a.session, row);
      }
      fillAgent(row, a, now);
      return row;
    });
    if (all.length > shown.length) {
      const more = box.querySelector<HTMLElement>(".home-more") ?? el("p", "home-more");
      setText(more, `+${all.length - shown.length} more on the Agent Monitor`);
      rows.push(more);
    }
    placeChildren(box, rows);
  }

  // ---- pull requests ----

  private renderPulls() {
    const box = this.pullBox;
    if (!box || !this.pullSection) return;
    const { available, loaded, pulls } = this.source.pulls();
    // Without GitHub there's nothing to show; the Tickets widget already says how to connect.
    this.pullSection.hidden = !available;
    // Review requests first: someone's waiting on you. Then your own, newest first.
    const sorted = [...pulls].sort((a, b) => (a.kind === b.kind ? updatedAt(b) - updatedAt(a) : a.kind === "review" ? -1 : 1));
    setText(this.pullCount, sorted.length ? String(sorted.length) : "");
    const shown = sorted.slice(0, MAX_PULLS);
    const key = [available, loaded, sorted.length, ...shown.map((p) => `${p.url}\0${p.title}\0${p.review}\0${p.draft}\0${p.updated}`)].join("\n");
    if (key === this.pullKey) return;
    this.pullKey = key;
    if (!sorted.length) {
      box.replaceChildren(loaded ? empty("No open pull requests", "Ones you open, or are asked to review, show up here.") : empty("Reading your pull requests…", ""));
      return;
    }
    const now = Date.now();
    const rows: HTMLElement[] = shown.map((p) => {
      const row = el("button", "home-pull");
      row.type = "button";
      // Asked to review: what matters is that it's waiting on you. Your own: where its review stands.
      const [label, color] = p.kind === "review" ? ["Your review", "var(--accent)"] : pullStatus(p);
      const text = el("span", "home-pull-text");
      const meta = el("span", "home-pull-meta");
      meta.append(el("span", "", `${p.repo.replace(/^[^/]+\//, "")} ${p.id}`));
      if (p.kind === "review") meta.append(el("span", "home-pull-author", `by ${p.author}`));
      text.append(el("span", "home-pull-title", p.title), meta);
      const status = el("span", "ticket-status");
      status.style.setProperty("--status", color);
      status.append(el("span", "ticket-status-dot"), el("span", "ticket-status-text", label));
      const glyph = icon(GitPullRequest, 14, "home-pull-icon");
      glyph.style.setProperty("color", color);
      row.append(glyph, text, status, el("span", "home-pull-age", ago(updatedAt(p), now)));
      row.title = `${p.repo}${p.id}: ${p.title}`;
      row.setAttribute("aria-label", `${p.repo}${p.id} ${p.title}, ${label}. Open in your browser.`);
      row.addEventListener("click", () => this.source.openPull(p));
      return row;
    });
    if (sorted.length > shown.length) rows.push(el("p", "home-more", `+${sorted.length - shown.length} more on the Tickets page`));
    box.replaceChildren(...rows);
  }

  // ---- local servers ----

  private renderServers() {
    const box = this.serverBox;
    if (!box) return;
    const live = this.source.servers().filter((s) => s.live);
    setText(this.serverCount, live.length ? String(live.length) : "");
    const shown = live.slice(0, MAX_SERVERS);
    const key = [live.length, ...shown.map((s) => `${serverUrl(s)}\0${s.name}\0${s.tabTitle}\0${s.color}`)].join("\n");
    if (key === this.serverKey) return;
    this.serverKey = key;
    if (!live.length) {
      box.replaceChildren(empty("No servers running", "Start a dev server in any tab and its port shows up here."));
      return;
    }
    const rows: HTMLElement[] = shown.map((s) => {
      const row = el("button", "home-server");
      row.type = "button";
      row.classList.toggle("outside", !s.session);
      const sub = s.host === "localhost" ? "" : s.host.slice(0, -"localhost".length);
      const top = el("span", "home-server-top");
      const port = el("span", "home-server-port");
      if (sub) port.append(el("span", "home-server-sub", sub));
      port.append(el("span", "", `:${s.port}`));
      top.append(el("span", "home-server-light"), port, icon(ArrowUpRight, 13, "home-server-go"));
      const where = el("span", "home-server-where");
      where.append(el("span", "home-server-name", s.name ?? "server"), el("span", "home-server-tab", s.tabTitle ?? "outside"));
      row.append(top, where);
      row.title = serverUrl(s);
      row.setAttribute("aria-label", `Open ${serverUrl(s)} in your browser, ${s.name ?? "server"} in ${s.tabTitle ?? "an app outside Workdesk"}`);
      row.addEventListener("click", () => this.source.openServer(s));
      return row;
    });
    if (live.length > shown.length) rows.push(el("p", "home-more", `+${live.length - shown.length} more on Local Servers`));
    box.replaceChildren(...rows);
  }

  private agentRow(session: TermSession): HTMLElement {
    const row = el("button", "home-agent");
    row.type = "button";
    const avatar = el("span", "home-agent-avatar");
    avatar.style.setProperty("--bot-delay", `${-(Math.random() * 4).toFixed(2)}s`);
    const text = el("span", "home-agent-text");
    text.append(el("span", "home-agent-tab"), el("span", "home-agent-prompt"));
    row.append(avatar, text, el("span", "home-agent-harness"), el("span", "home-agent-status"), el("span", "home-agent-since"));
    row.addEventListener("click", () => this.source.jumpToAgent(session));
    return row;
  }
}

function fillTerminal(card: HTMLElement, t: HomeTerminal) {
  const q = (sel: string) => card.querySelector<HTMLElement>(sel)!;
  card.style.setProperty("--tab", t.color);
  const screen = q(".home-term-screen");
  const lines = t.lines.slice(-SCREEN_LINES);
  while (screen.children.length > lines.length) screen.firstElementChild!.remove();
  while (screen.children.length < lines.length) screen.prepend(el("span", "home-term-line"));
  lines.forEach((line, i) => setText(screen.children[i], line));
  screen.classList.toggle("blank", lines.length === 0);
  setText(q(".home-term-title"), t.title);
  setText(q(".home-term-group"), t.group ?? "");
  q(".home-term-group").hidden = !t.group;
  setText(q(".home-term-running"), t.running ?? "");
  q(".home-term-running").hidden = !t.running;
  setText(q(".home-term-panes"), t.panes > 1 ? `${t.panes} panes` : "");
  q(".home-term-panes").hidden = t.panes < 2;
  setText(q(".home-term-cwd"), t.cwd);
  // A tab named after its folder at home ("~") would say it twice.
  q(".home-term-cwd").classList.toggle("same", t.cwd === t.title);
  card.setAttribute("aria-label", `${t.group ? `${t.group}, ` : ""}${t.title}${t.running ? `, running ${t.running}` : ""}, in ${t.cwd}. Go to tab.`);
}

function fillAgent(row: HTMLElement, a: Agent, now: number) {
  const q = (sel: string) => row.querySelector<HTMLElement>(sel)!;
  row.dataset.status = a.status;
  row.style.setProperty("--bot", a.color);
  const face = faceOf(a, now);
  if (row.dataset.face !== face) {
    row.dataset.face = face;
    q(".home-agent-avatar").innerHTML = botSvg(face);
  }
  setText(q(".home-agent-tab"), a.tabTitle);
  setText(q(".home-agent-prompt"), a.prompt ?? "No prompt yet");
  q(".home-agent-prompt").classList.toggle("empty", !a.prompt);
  const harness = q(".home-agent-harness");
  if (harness.dataset.harness !== a.harness) {
    harness.dataset.harness = a.harness;
    harness.innerHTML = harnessLogo(a.harness, 12);
    harness.title = HARNESS_NAMES[a.harness];
  }
  setText(q(".home-agent-status"), BADGE_LABELS[a.status]);
  setText(q(".home-agent-since"), ago(a.since, now));
  row.setAttribute("aria-label", `${a.tabTitle}, ${HARNESS_NAMES[a.harness]}, ${BADGE_LABELS[a.status]}. Go to pane.`);
}

function empty(title: string, text: string): HTMLElement {
  const box = el("div", "home-empty");
  box.append(el("p", "home-empty-title", title));
  if (text) box.append(el("p", "home-empty-text", text));
  return box;
}

/** ISO 8601 week number: weeks start on Monday, and week 1 holds the year's first Thursday. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
}

function placeChildren(parent: Element, children: Element[]) {
  const current = [...parent.children];
  if (current.length !== children.length || children.some((c, i) => current[i] !== c)) parent.replaceChildren(...children);
}

function setText(node: Element | null, text: string) {
  if (node && node.textContent !== text) node.textContent = text;
}

// ---- the app's data, and the sidebar row ----

/** Home's data from the running app. `actions` are what its links do. */
export function liveHomeSource(
  ws: Workspace,
  agents: { current: Agent[]; onChange(fn: () => void): void },
  servers: { current: Server[]; onChange(fn: () => void): void },
  store: TicketStore,
  actions: Pick<HomeSource, "openTab" | "jumpToAgent" | "openTicket" | "openServer" | "openPull" | "teleport" | "open">,
): HomeSource {
  return {
    ...actions,
    terminals: () => {
      const running = new Map(agents.current.map((a) => [a.session, HARNESS_NAMES[a.harness]]));
      return ws.orderedTabIds().map((id) => {
        const tab = ws.tabs.get(id)!;
        const group = ws.groupOf(id);
        const c = group?.color ?? tab.color;
        const s = tab.session;
        const agent = tab.sessions.map((p) => running.get(p)).find(Boolean);
        const proc = s.procName;
        return {
          id,
          title: ws.title(tab),
          group: group?.name ?? null,
          color: c ? GROUP_COLORS[c] : "var(--accent)",
          cwd: tildePath(s.cwd || s.startCwd || "~"),
          running: agent ?? (proc && !SHELLS.test(proc) && !VERSION.test(proc) ? proc : null),
          panes: tab.sessions.length,
          lines: s.screenLines(SCREEN_LINES),
        };
      });
    },
    agents: () => agents.current,
    servers: () => servers.current,
    pulls: () => ({
      available: store.hasPulls,
      loaded: store.pullState.at > 0 || !!store.pullState.error,
      pulls: store.pulls.filter((p) => !store.isDismissed(p)),
    }),
    tickets: () => ({
      connected: store.connected.length > 0,
      loading: store.loading,
      tickets: [...store.tickets].sort((a, b) => updatedAt(b) - updatedAt(a)),
    }),
    onChange: (fn) => {
      agents.onChange(fn);
      servers.onChange(fn);
      store.onChange(fn);
    },
  };
}

/** The Home row at the top of the sidebar; always there. */
export class HomeRow {
  constructor(
    private slot: HTMLElement,
    private page: HomePage,
  ) {
    Page.onChange(() => this.render());
    this.render();
  }

  private render() {
    const row = el("button", "tab monitor-row home-row");
    row.type = "button";
    if (Page.current === this.page) row.classList.add("active");
    row.dataset.tip = "Home";
    const glyph = el("span", "monitor-icon home-icon");
    glyph.append(icon(House, 14));
    const hint = el("span", "tab-hint");
    hint.append(kbdFor("openHome"));
    row.append(glyph, el("span", "tab-title", "Home"), hint);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.page.toggle();
    });
    this.slot.replaceChildren(row);
  }
}
