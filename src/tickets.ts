import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Page, el } from "./page";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranchPlus,
  GitPullRequest,
  Hash,
  Plug,
  RotateCcw,
  Search,
  Settings,
  Ticket as TicketIcon,
  Undo2,
  X,
  icon,
} from "./icons";
import { kbdFor } from "./kbd";
import { showToast } from "./toast";
import { providerLogo, type Provider } from "./providerLogos";

export type { Provider };

/** A ticket assigned to the user, from any service. */
export interface Ticket {
  provider: Provider;
  /** What the service calls it: "#123", "ENG-42", or a ClickUp task id. */
  id: string;
  title: string;
  url: string;
  /** The repo, Linear team or ClickUp list it belongs to. */
  project: string;
  status: string;
  /** The status's color as hex, when the service has one. */
  color: string | null;
  /** An ISO 8601 date, or ms since the epoch (ClickUp). */
  updated: string;
  /** A branch name the service suggests (Linear does). */
  branch: string | null;
}

/** An open GitHub pull request the user wrote, or was asked to review. */
export interface PullRequest {
  kind: "authored" | "review";
  /** "#123". */
  id: string;
  title: string;
  url: string;
  /** "owner/name". */
  repo: string;
  author: string;
  draft: boolean;
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  branch: string;
  updated: string;
}

/** Where a service's token comes from: one pasted in Settings, the `gh` CLI's login, or none. */
export type TokenSource = "keychain" | "gh" | null;

export const PROVIDERS: { id: Provider; name: string; noun: string; tokenUrl: string; tokenHelp: string }[] = [
  {
    id: "github",
    name: "GitHub",
    noun: "issues",
    tokenUrl: "https://github.com/settings/tokens/new?scopes=repo&description=Workdesk",
    tokenHelp: "A classic token with the repo scope, so private repos' issues show too.",
  },
  {
    id: "linear",
    name: "Linear",
    noun: "issues",
    tokenUrl: "https://linear.app/settings/account/security",
    tokenHelp: "A personal API key, from Settings → Security & access.",
  },
  {
    id: "clickup",
    name: "ClickUp",
    noun: "tasks",
    tokenUrl: "https://app.clickup.com/settings/apps",
    tokenHelp: "Your personal API token, from Settings → Apps.",
  },
];

export const providerName = (p: Provider) => PROVIDERS.find((x) => x.id === p)!.name;

// ---- the backend ----

export const ticketsApi = {
  accounts: () => invoke<{ provider: Provider; source: TokenSource }[]>("tickets_accounts"),
  whoami: (provider: Provider) => invoke<string>("tickets_whoami", { provider }),
  connect: (provider: Provider, token: string) => invoke<string>("tickets_connect", { provider, token }),
  disconnect: (provider: Provider) => invoke<void>("tickets_disconnect", { provider }),
  list: (provider: Provider) => invoke<Ticket[]>("tickets_list", { provider }),
  pulls: () => invoke<PullRequest[]>("tickets_pulls"),
};

export function updatedAt(t: { updated: string }): number {
  return /^\d+$/.test(t.updated) ? Number(t.updated) : Date.parse(t.updated) || 0;
}

/** "3m", "5h", "2d", "4w", or a date for anything older. */
function ago(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - ms) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The branch to check out for a ticket: Linear's own suggestion, else its id
 * and title, like `142-fix-login-redirect`. ClickUp ids get a CU- prefix,
 * which ClickUp's GitHub integration links back to the task.
 */
export function branchName(t: Ticket): string {
  if (t.branch) return t.branch;
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const id = t.provider === "github" ? t.id.replace(/^#/, "") : t.provider === "clickup" && !/-/.test(t.id) ? `cu-${t.id}` : t.id;
  // Cut long titles at a word.
  const full = slug(t.title);
  const title = full.length > 48 ? full.slice(0, 48).replace(/-[^-]*$/, "") : full;
  return [slug(id), title].filter(Boolean).join("-");
}

// ---- the data, shared by the page, the sidebar row and Settings ----

interface ProviderState {
  source: TokenSource;
  tickets: Ticket[];
  error: string;
  loading: boolean;
  /** When the tickets were last read, in ms; 0 for never. */
  at: number;
}

const STALE_MS = 60_000;
const POLL_MS = 5 * 60_000;
const DISMISSED_KEY = "workdesk.dismissedPulls";

/** GitHub pull requests, read alongside GitHub's tickets. */
interface PullState {
  pulls: PullRequest[];
  error: string;
  loading: boolean;
  at: number;
}

/** Every connected service's tickets, read on start, every few minutes, and on demand. */
export class TicketStore {
  readonly state = new Map<Provider, ProviderState>(
    PROVIDERS.map((p) => [p.id, { source: null, tickets: [], error: "", loading: false, at: 0 }]),
  );
  readonly pullState: PullState = { pulls: [], error: "", loading: false, at: 0 };
  /** Links of the pull requests the user dismissed. */
  private dismissed = new Set<string>(loadDismissed());
  private listeners = new Set<() => void>();
  private started = false;

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  get connected(): Provider[] {
    return PROVIDERS.map((p) => p.id).filter((id) => this.state.get(id)!.source);
  }

  get tickets(): Ticket[] {
    return this.connected.flatMap((p) => this.state.get(p)!.tickets);
  }

  get loading(): boolean {
    return [...this.state.values()].some((s) => s.loading) || this.pullState.loading;
  }

  /** Pull requests can be listed: GitHub is connected. */
  get hasPulls(): boolean {
    return this.state.get("github")!.source != null;
  }

  get pulls(): PullRequest[] {
    return this.hasPulls ? this.pullState.pulls : [];
  }

  isDismissed(pr: PullRequest): boolean {
    return this.dismissed.has(pr.url);
  }

  /** Hides `pr` from the list, or brings it back. */
  setDismissed(pr: PullRequest, dismissed: boolean) {
    if (dismissed) this.dismissed.add(pr.url);
    else this.dismissed.delete(pr.url);
    this.saveDismissed();
    this.emit();
  }

  private saveDismissed() {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...this.dismissed]));
    } catch {}
  }

  start() {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    setInterval(() => void this.refresh(), POLL_MS);
  }

  /** Re-reads which services are connected, then their tickets (only stale ones unless `force`). */
  async refresh(force = true) {
    const accounts = await ticketsApi.accounts().catch(() => []);
    for (const a of accounts) {
      const s = this.state.get(a.provider)!;
      if (s.source !== a.source) {
        Object.assign(s, { source: a.source, tickets: [], error: "", at: 0 });
        if (a.provider === "github") Object.assign(this.pullState, { pulls: [], error: "", at: 0 });
      }
    }
    this.emit();
    await Promise.all([
      ...this.connected.map((p) => {
        const s = this.state.get(p)!;
        if (!force && Date.now() - s.at < STALE_MS) return;
        return this.load(p);
      }),
      this.hasPulls && (force || Date.now() - this.pullState.at >= STALE_MS) ? this.loadPulls() : undefined,
    ]);
  }

  private async loadPulls() {
    const s = this.pullState;
    if (s.loading) return;
    s.loading = true;
    this.emit();
    try {
      s.pulls = await ticketsApi.pulls();
      s.error = "";
      // Forget dismissals of pull requests that were merged or closed.
      const open = new Set(s.pulls.map((p) => p.url));
      const before = this.dismissed.size;
      for (const url of this.dismissed) if (!open.has(url)) this.dismissed.delete(url);
      if (this.dismissed.size !== before) this.saveDismissed();
    } catch (e) {
      s.error = String(e);
    }
    s.loading = false;
    s.at = Date.now();
    this.emit();
  }

  private async load(p: Provider) {
    const s = this.state.get(p)!;
    if (s.loading) return;
    s.loading = true;
    this.emit();
    try {
      s.tickets = await ticketsApi.list(p);
      s.error = "";
    } catch (e) {
      s.error = String(e);
    }
    s.loading = false;
    s.at = Date.now();
    this.emit();
  }
}

function loadDismissed(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

export const ticketStore = new TicketStore();

// ---- the page ----

type SortKey = "source" | "id" | "title" | "project" | "status" | "updated";
type Within = "any" | "1d" | "7d" | "30d";

/** What the table shows: filters, sort and page size, kept between visits. */
interface View {
  sources: Provider[];
  projects: string[];
  /** Status names without case, spaces or dashes, so "Todo" and "to do" are one. */
  statuses: string[];
  within: Within;
  sort: SortKey;
  /** 1 for ascending, -1 for descending. */
  dir: 1 | -1;
  pageSize: number;
}

const VIEW_KEY = "workdesk.ticketsView";
const PAGE_SIZES = [25, 50, 100];
const WITHIN: [Within, string, number][] = [
  ["any", "Any time", Infinity],
  ["1d", "Last 24 hours", 24 * 3600_000],
  ["7d", "Last 7 days", 7 * 24 * 3600_000],
  ["30d", "Last 30 days", 30 * 24 * 3600_000],
];
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "source", label: "" },
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "project", label: "Project" },
  { key: "status", label: "Status" },
];

function loadView(): View {
  const fallback: View = { sources: [], projects: [], statuses: [], within: "any", sort: "updated", dir: -1, pageSize: 25 };
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    return saved ? { ...fallback, ...saved } : fallback;
  } catch {
    return fallback;
  }
}

const statusKey = (t: Ticket) => t.status.toLowerCase().replace(/[\s_-]+/g, "");

/** Every open ticket assigned to you on GitHub, Linear and ClickUp, in one table. */
export class TicketsPage extends Page {
  readonly title = "Tickets";
  private view: View = loadView();
  private query = "";
  private page = 0;
  private body_: HTMLElement | null = null;
  private filters: HTMLElement | null = null;
  private refreshButton: HTMLButtonElement | null = null;
  private flash: { el: HTMLElement; timer?: number } | null = null;
  private layout: HTMLElement | null = null;
  private pullsPane: HTMLElement | null = null;
  /** The PR sections whose dismissed pull requests are showing. */
  private showDismissed = new Set<PullRequest["kind"]>();
  private menu: { el: HTMLElement; close: () => void } | null = null;

  constructor(
    host: HTMLElement,
    private store: TicketStore,
    /** Asks where, then creates or checks out the ticket's branch; resolves "" if cancelled, rejects with why it couldn't. */
    private onBranch: (ticket: Ticket, branch: string) => Promise<string>,
    private onSettings: () => void,
    private open_: (url: string) => void = (url) => void openUrl(url),
  ) {
    super(host);
    store.onChange(() => this.isOpen && this.render());
  }

  open() {
    super.open();
    void this.store.refresh(false);
  }

  close() {
    this.menu?.close();
    super.close();
  }

  private saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(this.view));
    } catch {}
  }

  /** Changes the view, back to the first page. */
  private setView(change: Partial<View>) {
    Object.assign(this.view, change);
    this.page = 0;
    this.saveView();
    this.render();
  }

  protected build(body: HTMLElement): HTMLElement | null {
    body.classList.add("monitor-body", "tickets-body");
    const title = body.querySelector(".page-title")!;
    const head = el("header", "monitor-head tickets-head");
    title.replaceWith(head);
    const text = el("div", "monitor-head-text");
    text.append(title, el("p", "page-intro monitor-intro", "Open tickets assigned to you on GitHub, Linear and ClickUp, with the GitHub pull requests you opened or were asked to review alongside. Click one to open it."));
    head.append(text);

    const bar = el("div", "tickets-bar");
    const search = el("label", "tickets-search");
    const input = el("input", "");
    input.type = "search";
    input.placeholder = "Search by ID, title, project or status";
    input.spellcheck = false;
    input.value = this.query;
    input.setAttribute("aria-label", "Search tickets");
    input.addEventListener("input", () => {
      this.query = input.value;
      this.page = 0;
      this.renderTable();
    });
    search.append(icon(Search, 13), input);
    this.refreshButton = el("button", "tickets-refresh");
    this.refreshButton.title = "Refresh";
    this.refreshButton.setAttribute("aria-label", "Refresh");
    this.refreshButton.append(icon(RotateCcw, 13));
    this.refreshButton.addEventListener("click", () => void this.store.refresh());
    const integrations = el("button", "tickets-integrations");
    integrations.title = "Settings → Integrations";
    integrations.append(icon(Plug, 13), "Integrations");
    integrations.addEventListener("click", () => this.onSettings());
    bar.append(search, this.refreshButton, integrations);

    this.filters = el("div", "tickets-filters");
    this.flash = { el: el("div", "tickets-flash") };
    this.flash.el.hidden = true;
    this.body_ = el("div", "tickets-main");
    // Tickets on the left, GitHub pull requests in a column on the right.
    this.layout = el("div", "tickets-layout");
    const left = el("div", "tickets-col");
    left.append(bar, this.filters, this.flash.el, this.body_);
    this.pullsPane = el("aside", "pulls-pane");
    this.pullsPane.setAttribute("aria-label", "Pull requests");
    this.layout.append(left, this.pullsPane);
    body.append(this.layout);
    this.render();
    return input;
  }

  private render() {
    if (!this.body_) return;
    const none = this.store.connected.length === 0;
    this.body_.parentElement?.querySelector<HTMLElement>(".tickets-bar")?.toggleAttribute("hidden", none);
    this.filters?.toggleAttribute("hidden", none);
    this.refreshButton?.classList.toggle("spinning", this.store.loading);
    this.layout?.classList.toggle("with-pulls", this.store.hasPulls);
    this.renderPulls();
    if (none) {
      this.body_.replaceChildren(this.emptyState());
      return;
    }
    this.renderFilters();
    this.renderTable();
  }

  private emptyState(): HTMLElement {
    const empty = el("div", "tickets-empty");
    const logos = el("div", "tickets-empty-logos");
    for (const p of PROVIDERS) logos.insertAdjacentHTML("beforeend", providerLogo(p.id, 22));
    const go = el("button", "tickets-connect");
    go.append(icon(Settings, 14), "Connect in Settings");
    go.addEventListener("click", () => this.onSettings());
    empty.append(
      logos,
      el("p", "tickets-empty-title", "Connect GitHub, Linear or ClickUp"),
      el("p", "tickets-empty-text", "Add a token in Settings → Integrations and the tickets assigned to you show up here."),
      go,
    );
    return empty;
  }

  // ---- filtering ----

  /** The tickets passing every filter except `skip`, so a filter's menu can count its own options. */
  private filtered(skip?: "sources" | "projects" | "statuses" | "within"): Ticket[] {
    const v = this.view;
    const q = this.query.trim().toLowerCase();
    const now = Date.now();
    const span = WITHIN.find(([w]) => w === v.within)![2];
    return this.store.tickets.filter(
      (t) =>
        (skip === "sources" || !v.sources.length || v.sources.includes(t.provider)) &&
        (skip === "projects" || !v.projects.length || v.projects.includes(t.project)) &&
        (skip === "statuses" || !v.statuses.length || v.statuses.includes(statusKey(t))) &&
        (skip === "within" || now - updatedAt(t) <= span) &&
        (!q || `${t.id} ${t.title} ${t.project} ${t.status}`.toLowerCase().includes(q)),
    );
  }

  private renderFilters() {
    const bar = this.filters;
    if (!bar) return;
    const v = this.view;
    const all = this.store.tickets;
    const connected = this.store.connected;

    /** A filter button that opens a checklist of `options`. */
    const multi = (
      field: "sources" | "projects" | "statuses",
      label: string,
      options: { value: string; label: string; logo?: Provider; color?: string | null }[],
    ) => {
      const picked = v[field] as string[];
      const b = this.filterButton(label, picked.length === 1 ? options.find((o) => o.value === picked[0])?.label ?? picked[0] : picked.length ? `${picked.length} selected` : "");
      b.addEventListener("click", () => {
        const counts = new Map<string, number>();
        const key = field === "sources" ? (t: Ticket) => t.provider : field === "projects" ? (t: Ticket) => t.project : statusKey;
        for (const t of this.filtered(field)) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
        this.openChecklist(b, options, counts, picked, (next) => this.setView({ [field]: next }));
      });
      return b;
    };

    const projects = [...new Set(all.map((t) => t.project).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const statuses = new Map<string, { label: string; color: string | null }>();
    for (const t of all) if (!statuses.has(statusKey(t))) statuses.set(statusKey(t), { label: t.status, color: t.color });

    const within = this.filterButton("Updated", v.within === "any" ? "" : WITHIN.find(([w]) => w === v.within)![1]);
    within.addEventListener("click", () =>
      this.openChoice(
        within,
        WITHIN.map(([value, label]) => ({ value, label })),
        v.within,
        (value) => this.setView({ within: value as Within }),
      ),
    );

    const active = v.sources.length + v.projects.length + v.statuses.length + (v.within === "any" ? 0 : 1);
    const clear = el("button", "tickets-clear", "Clear filters");
    clear.hidden = active === 0;
    clear.addEventListener("click", () => this.setView({ sources: [], projects: [], statuses: [], within: "any" }));

    const parts: HTMLElement[] = [];
    // One service connected: nothing to pick between.
    if (connected.length > 1)
      parts.push(multi("sources", "Source", connected.map((p) => ({ value: p, label: providerName(p), logo: p }))));
    parts.push(
      multi("projects", "Project", projects.map((p) => ({ value: p, label: p }))),
      multi("statuses", "Status", [...statuses].map(([value, s]) => ({ value, label: s.label, color: s.color }))),
      within,
      clear,
    );
    bar.replaceChildren(...parts);
  }

  private filterButton(label: string, value: string): HTMLButtonElement {
    const b = el("button", value ? "tickets-filter active" : "tickets-filter");
    b.append(el("span", "tickets-filter-label", label));
    if (value) b.append(el("span", "tickets-filter-value", value));
    b.append(icon(ChevronDown, 12));
    return b;
  }

  /** A popover under `anchor`; one at a time, closed by Esc or a click outside. */
  private popover(anchor: HTMLElement, build: (menu: HTMLElement, close: () => void) => HTMLElement | null) {
    const wasOpen = this.menu?.el.dataset.for === anchor.textContent;
    this.menu?.close();
    if (wasOpen) return;
    const menu = el("div", "menu tickets-menu");
    menu.dataset.for = anchor.textContent ?? "";
    const onOutside = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
    };
    const close = () => {
      if (this.menu?.el !== menu) return;
      this.menu = null;
      anchor.classList.remove("open");
      window.removeEventListener("mousedown", onOutside, true);
      window.removeEventListener("keydown", onKey, true);
      menu.remove();
    };
    const focus = build(menu, close);
    document.body.append(menu);
    const a = anchor.getBoundingClientRect();
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(a.left, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.min(a.bottom + 6, innerHeight - r.height - 4)}px`;
    anchor.classList.add("open");
    this.menu = { el: menu, close };
    window.addEventListener("mousedown", onOutside, true);
    window.addEventListener("keydown", onKey, true);
    focus?.focus();
  }

  /** A checklist of `options`, with a search box when there are many; applies each change as it's made. */
  private openChecklist(
    anchor: HTMLElement,
    options: { value: string; label: string; logo?: Provider; color?: string | null }[],
    counts: Map<string, number>,
    picked: string[],
    apply: (next: string[]) => void,
  ) {
    const chosen = new Set(picked);
    this.popover(anchor, (menu) => {
      const list = el("div", "tickets-menu-list");
      let input: HTMLInputElement | null = null;
      const draw = () => {
        const q = input?.value.trim().toLowerCase() ?? "";
        const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q));
        list.replaceChildren(
          ...shown.map((o) => {
            const item = el("button", "menu-item tickets-option");
            item.setAttribute("role", "menuitemcheckbox");
            item.setAttribute("aria-checked", String(chosen.has(o.value)));
            const box = el("span", "tickets-check");
            box.append(icon(Check, 11));
            item.append(box);
            if (o.logo) item.insertAdjacentHTML("beforeend", providerLogo(o.logo, 13));
            if (o.color !== undefined) {
              const dot = el("span", "ticket-status-dot");
              if (o.color) dot.style.background = o.color;
              item.append(dot);
            }
            item.append(el("span", "menu-label", o.label), el("span", "tickets-option-count", String(counts.get(o.value) ?? 0)));
            item.addEventListener("click", () => {
              if (!chosen.delete(o.value)) chosen.add(o.value);
              item.setAttribute("aria-checked", String(chosen.has(o.value)));
              apply([...chosen]);
            });
            return item;
          }),
        );
        if (shown.length === 0) list.append(el("div", "menu-heading", options.length ? "No matches" : "Nothing to filter by yet"));
      };
      if (options.length > 8) {
        input = el("input", "tickets-menu-search");
        input.placeholder = "Filter…";
        input.spellcheck = false;
        input.addEventListener("input", draw);
        menu.append(input);
      }
      menu.append(list);
      draw();
      return input ?? (list.querySelector<HTMLElement>("button") ?? null);
    });
  }

  /** A list of `options` to pick one of. */
  private openChoice(anchor: HTMLElement, options: { value: string; label: string }[], current: string, apply: (value: string) => void) {
    this.popover(anchor, (menu, close) => {
      for (const o of options) {
        const item = el("button", "menu-item tickets-option");
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", String(o.value === current));
        const box = el("span", "tickets-check round");
        box.append(icon(Check, 11));
        item.append(box, el("span", "menu-label", o.label));
        item.addEventListener("click", () => {
          close();
          apply(o.value);
        });
        menu.append(item);
      }
      return menu.querySelector<HTMLElement>("[aria-checked=true]");
    });
  }

  // ---- the table ----

  private sorted(tickets: Ticket[]): Ticket[] {
    const { sort, dir } = this.view;
    const key: Record<SortKey, (t: Ticket) => string | number> = {
      source: (t) => providerName(t.provider),
      id: (t) => t.id,
      title: (t) => t.title.toLowerCase(),
      project: (t) => t.project.toLowerCase(),
      status: statusKey,
      updated: updatedAt,
    };
    const k = key[sort];
    return [...tickets].sort((a, b) => {
      const x = k(a);
      const y = k(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      // Ties fall back to most recently updated.
      return c * dir || updatedAt(b) - updatedAt(a);
    });
  }

  private renderTable() {
    const main = this.body_;
    if (!main || this.store.connected.length === 0) return;
    const errors = this.store.connected
      .map((p) => [p, this.store.state.get(p)!] as const)
      .filter(([, s]) => s.error)
      .map(([p, s]) => {
        const err = el("div", "tickets-error");
        err.insertAdjacentHTML("afterbegin", providerLogo(p, 14));
        err.append(el("span", "", s.error));
        if (/token|connected/i.test(s.error)) {
          const fix = el("button", "tickets-link", "Open Settings");
          fix.addEventListener("click", () => this.onSettings());
          err.append(fix);
        }
        return err;
      });

    const rows = this.sorted(this.filtered());
    const pages = Math.max(1, Math.ceil(rows.length / this.view.pageSize));
    this.page = Math.min(this.page, pages - 1);
    const first = this.page * this.view.pageSize;
    const shown = rows.slice(first, first + this.view.pageSize);
    const loading = this.store.connected.every((p) => !this.store.state.get(p)!.at);

    const table = el("table", "tickets-table");
    const colgroup = el("colgroup", "");
    for (const c of ["source", "id", "title", "project", "status", "actions"]) colgroup.append(el("col", `col-${c}`));
    const head = el("thead", "");
    const tr = el("tr", "");
    for (const c of COLUMNS) {
      const th = el("th", `col-${c.key}`);
      const sorted = this.view.sort === c.key;
      th.setAttribute("aria-sort", sorted ? (this.view.dir === 1 ? "ascending" : "descending") : "none");
      const b = el("button", sorted ? "tickets-sort sorted" : "tickets-sort");
      b.title = `Sort by ${c.label || "source"}`;
      b.append(c.label);
      if (sorted) b.append(icon(this.view.dir === 1 ? ArrowUp : ArrowDown, 11));
      // A to Z, then Z to A, then back to most recently updated first (the default, which has no column).
      b.addEventListener("click", () =>
        this.setView(!sorted ? { sort: c.key, dir: 1 } : this.view.dir === 1 ? { dir: -1 } : { sort: "updated", dir: -1 }),
      );
      th.append(b);
      tr.append(th);
    }
    tr.append(el("th", "col-actions"));
    head.append(tr);
    const tbody = el("tbody", "");
    tbody.append(...shown.map((t) => this.row(t)));
    if (shown.length === 0) {
      const empty = el("tr", "tickets-none");
      const td = el("td", "", loading ? "Loading…" : this.store.tickets.length ? "No tickets match these filters." : "No open tickets assigned to you.");
      td.colSpan = 6;
      empty.append(td);
      tbody.append(empty);
    }
    table.append(colgroup, head, tbody);
    const wrap = el("div", "tickets-table-wrap");
    wrap.append(table);

    main.replaceChildren(...errors, wrap, this.pager(rows.length, pages, first, shown.length));
  }

  private pager(total: number, pages: number, first: number, count: number): HTMLElement {
    const bar = el("div", "tickets-pager");
    bar.append(el("span", "tickets-range", total ? `${first + 1}–${first + count} of ${total}` : "0 tickets"));
    const size = el("label", "tickets-page-size");
    const select = el("select", "");
    for (const n of PAGE_SIZES) select.add(new Option(`${n} per page`, String(n), false, n === this.view.pageSize));
    select.addEventListener("change", () => this.setView({ pageSize: Number(select.value) }));
    size.append(select);
    const step = (node: Parameters<typeof icon>[0], label: string, to: number) => {
      const b = el("button", "tickets-step");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.disabled = to < 0 || to >= pages;
      b.append(icon(node, 14));
      b.addEventListener("click", () => {
        this.page = to;
        this.renderTable();
        this.body_?.closest(".page")?.scrollTo({ top: 0 });
      });
      return b;
    };
    const nav = el("div", "tickets-steps");
    nav.append(step(ChevronLeft, "Previous page", this.page - 1), el("span", "tickets-page-of", `${this.page + 1} / ${pages}`), step(ChevronRight, "Next page", this.page + 1));
    bar.append(size, nav);
    return bar;
  }

  private row(t: Ticket): HTMLElement {
    const row = el("tr", "ticket-row");
    row.dataset.provider = t.provider;
    // Anywhere on the row but the actions opens the ticket.
    row.addEventListener("click", (e) => {
      if (!(e.target as Element).closest(".ticket-actions")) this.open_(t.url);
    });
    const cell = (cls: string, ...children: (Node | string)[]) => {
      const td = el("td", cls);
      td.append(...children);
      return td;
    };
    const logo = el("span", "ticket-logo");
    logo.innerHTML = providerLogo(t.provider, 14);
    logo.title = providerName(t.provider);
    const open = el("button", "ticket-open", t.title);
    open.title = t.title;
    open.setAttribute("aria-label", `Open ${t.id} ${t.title} in your browser`);
    const status = el("span", "ticket-status");
    if (t.color) status.style.setProperty("--status", t.color);
    status.append(el("span", "ticket-status-dot"), el("span", "ticket-status-text", t.status));
    const project = el("span", "", t.project);
    project.title = t.project;

    const actions = el("div", "ticket-actions");
    const action = (node: Parameters<typeof icon>[0], label: string, run: (b: HTMLButtonElement) => void) => {
      const b = el("button", "ticket-action");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(node, 13));
      b.addEventListener("click", () => run(b));
      return b;
    };
    const branch = branchName(t);
    actions.append(
      action(GitBranchPlus, `Start branch ${branch}`, () => {
        this.onBranch(t, branch).then(
          (msg) => msg && this.showFlash(msg),
          (e) => this.showFlash(String(e), true),
        );
      }),
      action(Hash, `Copy ${t.id}`, (b) => void copy(t.id).then(() => copied(b, `Copied ${t.id}`))),
      action(Copy, "Copy link", (b) => void copy(t.url).then(() => copied(b, `Copied link to ${t.id}`))),
    );
    row.append(
      cell("col-source", logo),
      cell("col-id", t.id),
      cell("col-title", open),
      cell("col-project", project),
      cell("col-status", status),
      cell("col-actions", actions),
    );
    return row;
  }

  // ---- pull requests ----

  private renderPulls() {
    const pane = this.pullsPane;
    if (!pane) return;
    pane.hidden = !this.store.hasPulls;
    if (pane.hidden) return;
    const s = this.store.pullState;
    const parts: HTMLElement[] = [];
    if (s.error) {
      const err = el("div", "tickets-error");
      err.insertAdjacentHTML("afterbegin", providerLogo("github", 14));
      err.append(el("span", "", s.error));
      parts.push(err);
    }
    parts.push(
      this.pullSection("review", "Review requested", "Nobody's waiting on your review."),
      this.pullSection("authored", "Opened by you", "You have no open pull requests."),
    );
    pane.replaceChildren(...parts);
  }

  private pullSection(kind: PullRequest["kind"], heading: string, none: string): HTMLElement {
    const section = el("section", "pulls-section");
    const all = this.store.pulls.filter((p) => p.kind === kind).sort((a, b) => updatedAt(b) - updatedAt(a));
    const dismissed = all.filter((p) => this.store.isDismissed(p));
    const showing = this.showDismissed.has(kind) && dismissed.length > 0;
    const items = showing ? all : all.filter((p) => !this.store.isDismissed(p));

    const head = el("div", "pulls-head");
    head.append(icon(GitPullRequest, 13), el("h2", "pulls-title", heading), el("span", "pulls-count", String(all.length - dismissed.length)));
    if (dismissed.length) {
      const toggle = el("button", "tickets-clear pulls-toggle", showing ? "Hide dismissed" : `${dismissed.length} dismissed`);
      toggle.title = showing ? "Hide the pull requests you dismissed" : "Show the pull requests you dismissed";
      toggle.addEventListener("click", () => {
        if (!this.showDismissed.delete(kind)) this.showDismissed.add(kind);
        this.renderPulls();
      });
      head.append(toggle);
    }

    const list = el("div", "pulls-list");
    const now = Date.now();
    list.append(...items.map((p) => this.pullItem(p, now)));
    if (items.length === 0) list.append(el("div", "pulls-none", !this.store.pullState.at ? "Loading…" : dismissed.length ? "All dismissed." : none));
    section.append(head, list);
    return section;
  }

  private pullItem(p: PullRequest, now: number): HTMLElement {
    const dismissed = this.store.isDismissed(p);
    const item = el("div", dismissed ? "pull-item dismissed" : "pull-item");
    item.addEventListener("click", (e) => {
      if (!(e.target as Element).closest(".ticket-actions")) this.open_(p.url);
    });
    const name = `${p.repo}${p.id}`;
    const open = el("button", "pull-title", p.title);
    open.title = `${p.title}\n${p.branch}`;
    open.setAttribute("aria-label", `Open ${name} ${p.title} in your browser`);

    const [label, color] = pullStatus(p);
    const status = el("span", "ticket-status");
    status.style.setProperty("--status", color);
    status.append(el("span", "ticket-status-dot"), el("span", "ticket-status-text", label));
    const where = el("span", "pull-where", `${p.repo.replace(/^[^/]+\//, "")} ${p.id}`);
    where.title = name;
    const meta = el("div", "pull-meta");
    meta.append(status, where);
    // Your own pull requests are all by you.
    if (p.kind === "review") meta.append(el("span", "pull-author", p.author));
    const when = el("span", "pull-when", ago(updatedAt(p), now));
    when.title = `Updated ${new Date(updatedAt(p)).toLocaleString()}`;
    meta.append(when);

    const actions = el("div", "ticket-actions pull-actions");
    const action = (node: Parameters<typeof icon>[0], label: string, run: (b: HTMLButtonElement) => void) => {
      const b = el("button", "ticket-action");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(node, 13));
      b.addEventListener("click", () => run(b));
      return b;
    };
    actions.append(
      action(GitBranchPlus, `Copy branch ${p.branch}`, (b) => void copy(p.branch).then(() => copied(b, `Copied ${p.branch}`))),
      action(Copy, "Copy link", (b) => void copy(p.url).then(() => copied(b, `Copied link to ${name}`))),
      dismissed
        ? action(Undo2, "Restore", () => this.store.setDismissed(p, false))
        : action(X, "Dismiss", () => {
            this.store.setDismissed(p, true);
            showToast(`Dismissed ${name}`, 4000, { label: "Undo", run: () => this.store.setDismissed(p, false) });
          }),
    );
    item.append(open, meta, actions);
    return item;
  }

  /** A note above the table, e.g. why a branch couldn't be made. */
  private showFlash(message: string, error = false) {
    const f = this.flash;
    if (!f) return;
    clearTimeout(f.timer);
    f.el.textContent = message;
    f.el.classList.toggle("error", error);
    f.el.hidden = false;
    f.timer = window.setTimeout(() => (f.el.hidden = true), error ? 6000 : 3000);
  }
}

/** What a pull request is waiting on, and its color. */
function pullStatus(p: PullRequest): [string, string] {
  if (p.draft) return ["Draft", "var(--muted)"];
  switch (p.review) {
    case "APPROVED":
      return ["Approved", "var(--group-green, #4ade80)"];
    case "CHANGES_REQUESTED":
      return ["Changes requested", "var(--danger)"];
    case "REVIEW_REQUIRED":
      return ["Review required", "var(--group-yellow, #facc15)"];
    default:
      return ["Open", "var(--group-green, #4ade80)"];
  }
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

/** Ticks a copy button for a moment, and says what was copied. */
function copied(b: HTMLButtonElement, message: string) {
  showToast(message);
  b.classList.add("done");
  setTimeout(() => b.classList.remove("done"), 1200);
}

// ---- the sidebar row ----

/** The Tickets row at the top of the sidebar, while any service is connected or the page is open. */
export class TicketsRow {
  constructor(
    private store: TicketStore,
    private slot: HTMLElement,
    private page: TicketsPage,
  ) {
    store.onChange(() => this.render());
    Page.onChange(() => this.render());
    this.render();
  }

  private render() {
    const open = Page.current === this.page;
    if (this.store.connected.length === 0 && !open) {
      this.slot.replaceChildren();
      return;
    }
    const count = this.store.tickets.length;
    const row = el("button", "tab monitor-row tickets-row");
    row.type = "button";
    if (open) row.classList.add("active");
    const reviews = this.store.pulls.filter((p) => p.kind === "review" && !this.store.isDismissed(p)).length;
    row.dataset.tip = `Tickets · ${count} assigned to you${reviews ? ` · ${reviews} review${reviews === 1 ? "" : "s"} requested` : ""}`;
    const glyph = el("span", "monitor-icon tickets-icon");
    glyph.append(icon(TicketIcon, 14));
    const hint = el("span", "tab-hint");
    hint.append(kbdFor("openTickets"));
    row.append(glyph, el("span", "tab-title", "Tickets"), el("span", "monitor-count", count ? String(count) : ""), hint);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.page.toggle();
    });
    this.slot.replaceChildren(row);
  }
}
