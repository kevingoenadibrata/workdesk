import { openUrl } from "@tauri-apps/plugin-opener";
import { Page, el } from "./page";
import { localServers, type Listener } from "./pty";
import { ArrowUpRight, Copy, EthernetPort, X, icon } from "./icons";
import { kbdFor } from "./kbd";
import { panesInOrder } from "./monitor";
import type { Workspace } from "./workspace";
import type { TermSession } from "./terminal";

/** A local server, as shown on its card. */
export interface Server {
  /** Its address, so a row keeps its place between polls. */
  key: string;
  /** The pane that started it, or printed its address; null for a server started outside Workdesk. */
  session: TermSession | null;
  tabTitle: string | null;
  /** Its tab's color, as CSS. */
  color: string | null;
  scheme: "http" | "https";
  /** e.g. "localhost" or "api.localhost". */
  host: string;
  port: number;
  /** Something is listening on the port right now. */
  live: boolean;
  /** What's listening, e.g. "vite". Kept after it stops. */
  name?: string;
  /** When it started listening, or when it stopped, in ms. */
  since: number;
}

export const serverUrl = (s: Pick<Server, "scheme" | "host" | "port">) => `${s.scheme}://${s.host}:${s.port}`;

// ---- reading the panes ----

type Pane = ReturnType<typeof panesInOrder>[number];

/** A localhost address printed in a pane. */
interface Address {
  scheme: Server["scheme"];
  host: string;
  port: number;
}

/** `localhost:3000`, `http://api.localhost:5173/`, and so on. */
const ADDRESS = /\b(?:(https?):\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*localhost):(\d{1,5})\b/gi;

export function findAddresses(text: string): Address[] {
  const out: Address[] = [];
  for (const m of text.matchAll(ADDRESS)) {
    const port = Number(m[3]);
    if (port < 1 || port > 65535) continue;
    out.push({ scheme: m[1]?.toLowerCase() === "https" ? "https" : "http", host: m[2].toLowerCase(), port });
  }
  return out;
}

/**
 * The addresses one pane has printed. The first look reads its whole
 * scrollback; after that only what's been written since.
 */
class PaneWatch {
  readonly found = new Map<string, Address>();
  /** Lines written since the last look; everything, before the first. */
  private fresh = Infinity;
  private sub: { dispose(): void };

  constructor(private session: TermSession) {
    this.sub = session.term.onLineFeed(() => this.fresh++);
  }

  read() {
    const term = this.session.term;
    const buf = term.buffer.active;
    let start = Math.max(0, buf.length - Math.min(buf.length, this.fresh + term.rows));
    this.fresh = 0;
    // Start at the beginning of a wrapped line, so an address split across rows is read whole.
    while (start > 0 && buf.getLine(start)?.isWrapped) start--;
    let line = "";
    const flush = () => {
      for (const a of findAddresses(line)) this.found.set(`${a.host}:${a.port}`, a);
      line = "";
    };
    for (let y = start; y < buf.length; y++) {
      const row = buf.getLine(y);
      if (!row) continue;
      if (!row.isWrapped) flush();
      line += row.translateToString(true);
    }
    flush();
  }

  dispose() {
    this.sub.dispose();
  }
}

// ---- the page ----

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Started in a Workdesk pane, or somewhere else. */
type Origin = "workdesk" | "outside";

const SECTIONS: { origin: Origin; title: string }[] = [
  { origin: "workdesk", title: "Workdesk Servers" },
  { origin: "outside", title: "Outside Workdesk Servers" },
];

/** Ports on the faceplate in the page header. */
const FACEPLATE_PORTS = 8;

/** A row for every local web server; click one to open it in the browser. */
export class ServersPage extends Page {
  readonly title = "Local Servers";
  private servers: Server[] = [];
  private list: HTMLElement | null = null;
  private faceplate: HTMLElement | null = null;
  private cards = new Map<string, HTMLElement>();
  private sections = new Map<Origin, HTMLElement>();

  constructor(
    host: HTMLElement,
    private onJump: (session: TermSession) => void,
    private onDismiss: (key: string) => void = () => {},
    private open_: (url: string) => void = (url) => void openUrl(url),
  ) {
    super(host);
  }

  protected build(body: HTMLElement): HTMLElement | null {
    body.classList.add("monitor-body", "servers-body");
    const title = body.querySelector(".page-title")!;
    const head = el("header", "monitor-head");
    const text = el("div", "monitor-head-text");
    title.replaceWith(head);
    text.append(
      title,
      el("p", "page-intro monitor-intro", "Every web server running on this machine, and the tab that started it. Click one to open it in your browser."),
    );
    this.faceplate = el("div", "faceplate");
    this.faceplate.setAttribute("aria-hidden", "true");
    for (let i = 0; i < FACEPLATE_PORTS; i++) {
      const port = el("span", "faceplate-port");
      port.append(el("span", "faceplate-led"), el("span", "faceplate-socket"));
      this.faceplate.append(port);
    }
    head.append(this.faceplate, text);
    this.list = el("div", "server-list");
    this.cards.clear();
    this.sections.clear();
    body.append(this.list);
    this.render();
    return null;
  }

  update(servers: Server[]) {
    this.servers = servers;
    if (this.isOpen) this.render();
  }

  private render() {
    const list = this.list;
    if (!list) return;
    const live = this.servers.filter((s) => s.live).length;
    // Workdesk's servers light the first ports, then the outside ones, in teal.
    const ours = this.servers.filter((s) => s.live && s.session).length;
    this.faceplate?.querySelectorAll(".faceplate-port").forEach((port, i) => {
      port.classList.toggle("lit", i < live);
      port.classList.toggle("outside", i >= ours);
    });
    if (this.servers.length === 0) {
      this.cards.clear();
      this.sections.clear();
      const empty = el("div", "agent-empty");
      const text = el("p", "agent-empty-text");
      text.append("Start a dev server in any tab, or anywhere else. Once it's serving on a port like ", el("code", "", "localhost:3000"), ", it shows up here.");
      empty.append(el("p", "agent-empty-title", "No local servers running"), text);
      list.replaceChildren(empty);
      return;
    }
    const now = Date.now();
    for (const key of this.cards.keys()) if (!this.servers.some((s) => s.key === key)) this.cards.delete(key);
    const blocks = SECTIONS.flatMap(({ origin, title }) => {
      // Running first, then the stopped ones.
      const mine = this.servers.filter((s) => (s.session ? "workdesk" : "outside") === origin);
      const members = [...mine.filter((s) => s.live), ...mine.filter((s) => !s.live)];
      if (members.length === 0) {
        this.sections.delete(origin);
        return [];
      }
      let block = this.sections.get(origin);
      if (!block) {
        block = el("section", `server-section ${origin}`);
        const heading = el("h2", "agent-section-title");
        heading.append(el("span", "", title), el("span", "agent-section-count"));
        block.append(heading, el("div", "server-rows"));
        this.sections.set(origin, block);
      }
      setText(block.querySelector(".agent-section-count"), String(members.length));
      const cards = members.map((server) => {
        let card = this.cards.get(server.key);
        if (!card) {
          card = this.card(server.key);
          this.cards.set(server.key, card);
        }
        fillCard(card, server, now);
        return card;
      });
      placeChildren(block.querySelector(".server-rows")!, cards);
      return [block];
    });
    placeChildren(list, blocks);
  }

  private server(key: string) {
    return this.servers.find((s) => s.key === key);
  }

  private card(key: string): HTMLElement {
    const card = el("div", "server-row");

    // The address is the button, and stretches to cover the whole row; the
    // tab chip and actions sit above it.
    const open = el("button", "server-open");
    open.type = "button";
    const port = el("span", "server-port");
    port.append(el("span", "server-number"));
    const host = el("span", "server-host");
    host.append(el("span", "server-sub"), el("span", "server-domain"), el("span", "server-colon", ":"));
    // Read as one address: host, then the port.
    const address = el("span", "server-address");
    address.append(host, port);
    open.append(el("span", "server-led"), address);
    const go = el("span", "server-go");
    go.append(icon(ArrowUpRight, 16));
    open.addEventListener("click", () => {
      const s = this.server(key);
      if (s?.live) this.open_(serverUrl(s));
    });

    const tab = el("button", "server-tab");
    tab.type = "button";
    tab.append(el("span", "server-tab-dot"), el("span", "server-tab-name"));
    tab.addEventListener("click", () => {
      const s = this.server(key);
      if (s?.session) this.onJump(s.session);
    });

    const copy = el("button", "server-action server-copy");
    copy.type = "button";
    const copyLabel = el("span", "", "Copy");
    copy.append(icon(Copy, 13), copyLabel);
    let reset: number | undefined;
    copy.addEventListener("click", () => {
      const s = this.server(key);
      if (!s) return;
      void copyText(serverUrl(s)).then(() => {
        copyLabel.textContent = "Copied";
        clearTimeout(reset);
        reset = window.setTimeout(() => (copyLabel.textContent = "Copy"), 1400);
      });
    });

    const dismiss = el("button", "server-action server-dismiss");
    dismiss.type = "button";
    dismiss.append(icon(X, 13));
    dismiss.addEventListener("click", () => this.onDismiss(key));

    card.append(open, tab, el("span", "server-proc"), go, copy, dismiss);
    return card;
  }
}

function fillCard(card: HTMLElement, s: Server, now: number) {
  card.dataset.state = s.live ? "live" : "stopped";
  card.classList.toggle("outside", !s.session);
  if (s.color) card.style.setProperty("--tab", s.color);
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => card.querySelector<T>(sel)!;
  const url = serverUrl(s);
  const sub = s.host === "localhost" ? "" : s.host.slice(0, -"localhost".length);
  setText(q(".server-sub"), sub);
  setText(q(".server-domain"), "localhost");
  setText(q(".server-number"), String(s.port));
  const age = ago(now - s.since);
  const when = s.live ? `up ${age}` : `${age} ago`;
  setText(q(".server-proc"), s.name ? `${s.name} · ${when}` : when);
  q(".server-sub").hidden = !sub;
  // A stopped server has nothing to open.
  const open = q<HTMLButtonElement>(".server-open");
  open.disabled = !s.live;
  open.setAttribute("aria-label", s.live ? `Open ${url} in your browser` : `${url}, stopped`);
  open.title = s.live ? url : "Stopped";
  // Started outside Workdesk: there's no pane to go to.
  const tab = q<HTMLButtonElement>(".server-tab");
  tab.disabled = !s.session;
  tab.classList.toggle("outside", !s.session);
  setText(q(".server-tab-name"), s.tabTitle ?? "");
  if (s.session) {
    tab.setAttribute("aria-label", `Go to the pane in ${s.tabTitle}`);
    tab.title = "Go to pane";
  } else {
    tab.setAttribute("aria-label", "Started outside Workdesk");
    tab.title = "Started outside Workdesk";
  }
  q(".server-copy").setAttribute("aria-label", `Copy ${url}`);
  const dismiss = q(".server-dismiss");
  dismiss.hidden = s.live;
  dismiss.setAttribute("aria-label", `Remove ${s.host}:${s.port} from the list`);
  dismiss.title = "Remove";
}

/** Puts `children` in `parent` in order, moving nothing that's already in place (which would drop focus). */
function placeChildren(parent: Element, children: Element[]) {
  const current = [...parent.children];
  if (current.length !== children.length || children.some((c, i) => current[i] !== c)) parent.replaceChildren(...children);
}

function setText(node: Element | null, text: string) {
  if (node && node.textContent !== text) node.textContent = text;
}

async function copyText(text: string) {
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

// ---- polling, and the sidebar row ----

/**
 * Lists every local web server, named by the addresses the panes print
 * (`api.localhost:3000`) and tied to the pane that started it. While any are
 * running, a Local Servers row sits at the top of the sidebar.
 */
export class LocalServers {
  private servers: Server[] = [];
  private watches = new Map<TermSession, PaneWatch>();
  /** Every server seen this run, by address, live or stopped. */
  private seen = new Map<string, Omit<Server, "key" | "tabTitle" | "color">>();
  /** Stopped servers taken off the list; one that comes back shows again. */
  private dismissed = new Set<string>();
  private polling = false;

  constructor(
    private ws: Workspace,
    private slot: HTMLElement,
    private page: ServersPage,
  ) {
    ws.onChange(() => this.refreshTitles());
    Page.onChange(() => this.renderRow());
    this.renderRow();
  }

  start(intervalMs = 2000) {
    void this.poll();
    setInterval(() => void this.poll(), intervalMs);
  }

  dismiss(key: string) {
    this.dismissed.add(key);
    this.servers = this.servers.filter((s) => s.key !== key);
    this.page.update(this.servers);
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const panes = panesInOrder(this.ws).filter((p) => p.session.ptyId != null);
      for (const [session, watch] of this.watches) {
        if (panes.some((p) => p.session === session)) continue;
        watch.dispose();
        this.watches.delete(session);
      }
      // The addresses printed for each port, by the panes that printed them, in sidebar order.
      const printed = new Map<number, { pane: Pane; address: Address }[]>();
      for (const pane of panes) {
        let watch = this.watches.get(pane.session);
        if (!watch) this.watches.set(pane.session, (watch = new PaneWatch(pane.session)));
        watch.read();
        for (const address of watch.found.values()) printed.set(address.port, [...(printed.get(address.port) ?? []), { pane, address }]);
      }
      const listeners = await localServers(
        panes.map((p) => p.session.ptyId!),
        [...printed.keys()],
      ).catch(() => [] as Listener[]);
      // One per port, preferring the one a pane started.
      const byPort = new Map<number, Listener>();
      for (const l of listeners) if (!byPort.has(l.port) || (l.pty != null && byPort.get(l.port)!.pty == null)) byPort.set(l.port, l);

      const now = Date.now();
      const live = new Set<string>();
      for (const [port, l] of byPort) {
        const mentions = printed.get(port) ?? [];
        // The pane that started it, else the first to print its address.
        const pane = l.pty != null ? panes.find((p) => p.session.ptyId === l.pty) : mentions[0]?.pane;
        const own = mentions.filter((m) => m.pane === pane);
        const addresses = (own.length ? own : mentions).map((m) => m.address);
        if (addresses.length === 0) addresses.push({ scheme: "http", host: "localhost", port });
        for (const a of addresses) {
          const key = `${a.host}:${port}`;
          if (live.has(key)) continue;
          live.add(key);
          const prev = this.seen.get(key);
          const since = prev?.live && prev.session === (pane?.session ?? null) ? prev.since : now;
          this.seen.set(key, { ...a, live: true, since, name: l.name, session: pane?.session ?? null });
          this.dismissed.delete(key);
        }
      }
      // Gone since the last look: stopped, until its pane closes or it's dismissed.
      const open = new Set(panes.map((p) => p.session));
      for (const [key, s] of this.seen) {
        if (live.has(key)) continue;
        if (s.session && !open.has(s.session)) this.seen.delete(key);
        else if (s.live) this.seen.set(key, { ...s, live: false, since: now });
      }

      const order = (s: TermSession | null) => (s ? panes.findIndex((p) => p.session === s) : panes.length);
      this.servers = [...this.seen]
        .filter(([key]) => !this.dismissed.has(key))
        .map(([key, s]) => {
          const pane = s.session ? panes.find((p) => p.session === s.session) : undefined;
          return { key, ...s, tabTitle: pane?.tabTitle ?? null, color: pane?.color ?? null };
        })
        .sort((x, y) => order(x.session) - order(y.session) || x.port - y.port);
      this.page.update(this.servers);
      this.renderRow();
    } finally {
      this.polling = false;
    }
  }

  private refreshTitles() {
    if (this.servers.length === 0) return;
    const panes = new Map(panesInOrder(this.ws).map((p) => [p.session, p]));
    this.servers = this.servers
      .filter((s) => !s.session || panes.has(s.session))
      .map((s) => {
        const pane = s.session && panes.get(s.session);
        return pane ? { ...s, tabTitle: pane.tabTitle, color: pane.color } : s;
      });
    this.page.update(this.servers);
    this.renderRow();
  }

  /** The Local Servers row: shown while any server is live, or while the page is open. */
  private renderRow() {
    const open = Page.current === this.page;
    const live = this.servers.filter((s) => s.live).length;
    if (live === 0 && !open) {
      this.slot.replaceChildren();
      return;
    }
    const row = el("button", "tab monitor-row servers-row");
    row.type = "button";
    if (open) row.classList.add("active");
    row.dataset.tip = `Local Servers · ${live} running`;
    const glyph = el("span", "monitor-icon servers-icon");
    glyph.append(icon(EthernetPort, 14));
    const hint = el("span", "tab-hint");
    hint.append(kbdFor("openServers"));
    row.append(glyph, el("span", "tab-title", "Local Servers"), el("span", "monitor-count", String(live)), hint);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.page.toggle();
    });
    this.slot.replaceChildren(row);
  }
}
