import { invoke } from "@tauri-apps/api/core";
import { pruneRecents, recentDirs, setHome, touchRecent } from "./recents";
import { findMacro, loadMacros, runnable, type Macro } from "./macros";
import { describeLoadout, findLoadout, usableLoadouts } from "./loadouts";
import { favoriteDirs, toggleFavorite } from "./favorites";
import { kbd, kbdFor } from "./kbd";
import { comboFromEvent } from "./shortcuts";
import { AtSign, Bot, ChevronRight, Folder, History, House, Package, Star, Trash2, icon } from "./icons";
import type { IconNode } from "lucide";
import { showToast } from "./toast";

interface Candidate {
  /** Absolute path, the macro or loadout name, or the session id, for those kinds. */
  path: string;
  kind: "favorite" | "home" | "recent" | "dir" | "macro" | "loadout" | "session";
}

/** A session as Teleport lists it. */
export interface TeleportSession {
  id: string;
  /** Its ticket's id, else its name. */
  label: string;
  /** "repo · branch", and the ticket's title if it has one. */
  detail: string;
  /** What it's up to, like "Stopped" or "PR open". */
  status: string;
  /** It has a pane right now; picking it goes there. */
  open: boolean;
}

/** Where Teleport finds sessions to pick back up, and how it ends one. */
export interface SessionSource {
  list(): TeleportSession[];
  recall(id: string): void;
  /** Removes the session's worktree; resolves with what happened. */
  end(id: string): Promise<string>;
}

/**
 * The input split into an optional leading "@macro" and the folder query
 * after it, or a "#loadout" (which takes no folder).
 */
interface Parsed {
  /** Text after "#", or null when not picking a loadout. */
  loadout: string | null;
  /** Text after "@", or null when there's no macro. */
  macro: string | null;
  /** Still typing the macro name (no space after it yet). */
  naming: boolean;
  /** Everything up to the folder query, kept when completing folders. */
  prefix: string;
  query: string;
}

/** Teleport's tabs, in Tab order. */
export type TeleportTab = "directory" | "history" | "favorites" | "sessions";

const TABS: { id: TeleportTab; label: string; icon: IconNode; placeholder: string }[] = [
  { id: "directory", label: "Directory", icon: Folder, placeholder: "Teleport to a folder…  (~/ or / to browse, → to complete, @macro to run, #loadout to open)" },
  { id: "history", label: "History", icon: History, placeholder: "Search recent folders…" },
  { id: "favorites", label: "Favorites", icon: Star, placeholder: "Search favorite folders…" },
  { id: "sessions", label: "Sessions", icon: Bot, placeholder: "Search sessions…" },
];

/** Teleport used to pick a folder for something else, like a ticket's branch. */
export interface PickOptions {
  /**
   * The folder Directory starts in: filled in and highlighted, so Enter opens
   * it and typing replaces it. Undefined (or resolving to it) means home.
   * Leave the option out to start with an empty query.
   */
  cwd?: string | Promise<string | undefined>;
  /** Shown above the input, saying what the folder is for. */
  title?: Node | string;
  placeholder?: string;
  /** Folders only: no @macro or #loadout. */
  plain?: boolean;
}

const MAX_RESULTS = 50;
const COMPLETE_COMBO = "arrowright";
const FAVORITE_COMBO = "mod+d";
const END_SESSION_COMBO = "mod+backspace";

const homeReady = invoke<string>("home_dir").then((dir) => {
  setHome(dir);
  return dir;
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function basename(path: string) {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

/** 0 = no match; higher is better. Basename hits beat hits elsewhere in the path. */
function score(path: string, label: string, query: string): number {
  const q = query.toLowerCase();
  const base = basename(path).toLowerCase();
  if (base === q) return 5;
  if (base.startsWith(q)) return 4;
  if (base.includes(q)) return 3;
  const full = label.toLowerCase();
  if (full.includes(q)) return 2;
  let i = 0;
  for (const ch of full) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

/**
 * Teleport (⌘T): palette for choosing where a new tab starts, in tabs that
 * Tab / ⇧Tab cycle through:
 * - Directory opens on the current folder (so ⌘T ↩ is a new tab right here).
 *   With no query it lists favorites, home and recent directories; plain text
 *   filters those (plus folders in ~), favorites always first; a query
 *   starting with `~` or `/` browses the filesystem, → completing into the
 *   highlighted folder. A leading "@name" picks a macro whose commands run in
 *   the new tab; "#name" opens a loadout instead of one tab.
 * - History and Favorites list just recent or starred folders.
 * - Sessions: picking one picks it back up (or goes to its pane); ⌘⌫ ends it.
 * ⌘D stars the highlighted folder in any of them.
 */
export class DirPicker {
  /** Sessions to list; set once the app has them. */
  sessions?: SessionSource;
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private macroBar!: HTMLElement;
  private tabBar!: HTMLElement;
  private tab: TeleportTab = "directory";
  /** What Directory was filled in with, while it's still untouched. */
  private prefill = "";
  /** The folder Teleport was opened from, marked in the list. */
  private cwd = "";
  private items: Candidate[] = [];
  private selected = 0;
  private home = "";
  private recents: string[] = [];
  private favorites: string[] = [];
  private dirCache = new Map<string, Promise<string[]>>();
  /** Bumped per query so slow directory listings can't overwrite newer results. */
  private seq = 0;
  private onPick: ((dir: string, macro?: Macro) => void) | null = null;
  private onCancel: (() => void) | null = null;
  private onLoadout: ((name: string) => void) | null = null;
  private options: PickOptions = {};

  constructor(private host: HTMLElement) {}

  get isOpen() {
    return this.root != null;
  }

  async open(
    onPick: (dir: string, macro?: Macro) => void,
    onCancel: () => void,
    onLoadout: (name: string) => void = () => {},
    options: PickOptions = {},
  ) {
    if (this.root) return this.input.focus();
    this.options = options;
    this.tab = "directory";
    this.prefill = this.cwd = "";
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.onLoadout = onLoadout;
    this.dirCache.clear();
    this.recents = recentDirs();
    this.favorites = favoriteDirs();
    this.build();
    this.home = await homeReady.catch(() => "");
    if ("cwd" in options) await this.fillCwd(options.cwd);
    void this.update();

    // Quietly forget recents that were deleted.
    void invoke<string[]>("existing_dirs", { paths: this.recents }).then((existing) => {
      if (existing.length === this.recents.length) return;
      pruneRecents(existing);
      this.recents = recentDirs();
      if (this.root) void this.update();
    });
  }

  /** Starts Directory on `cwd` (home if it's unknown), unless something's been typed meanwhile. */
  private async fillCwd(cwd: PickOptions["cwd"]) {
    const dir = (await Promise.resolve(cwd).catch(() => undefined)) || this.home;
    if (!this.root || !dir || this.input.value) return;
    this.cwd = dir;
    const label = this.tildify(dir);
    this.prefill = label.endsWith("/") ? label : `${label}/`;
    this.input.value = this.prefill;
    this.input.select();
  }

  close(picked?: { dir: string; macro?: Macro } | { loadout: string } | { session: string }) {
    if (!this.root) return;
    // Cleared first: removing the focused input can fire blur, which re-enters close().
    const root = this.root;
    this.root = null;
    root.remove();
    this.backdrop?.remove();
    this.backdrop = null;
    this.seq++;
    const { onPick, onCancel, onLoadout } = this;
    this.onPick = this.onCancel = this.onLoadout = null;
    if (picked && "session" in picked) {
      this.sessions?.recall(picked.session);
    } else if (picked && "loadout" in picked) {
      onLoadout?.(picked.loadout);
    } else if (picked) {
      touchRecent(picked.dir);
      onPick?.(picked.dir, picked.macro);
    } else {
      onCancel?.();
    }
  }

  private build() {
    const root = el("div", "dirpicker");
    this.input = el("input", "dirpicker-input");
    this.input.spellcheck = false;
    this.input.autocomplete = "off";
    this.list = el("div", "dirpicker-list");
    this.macroBar = el("div", "dirpicker-macro");
    this.tabBar = el("div", "dirpicker-tabs");
    this.tabBar.addEventListener("mousedown", (e) => e.preventDefault());
    root.append(this.input, this.tabBar, this.macroBar, this.list);
    this.renderTabs();
    if (this.options.title) {
      const title = el("div", "dirpicker-title");
      title.append(this.options.title);
      root.prepend(title);
    }
    this.backdrop = el("div", "dirpicker-backdrop");
    this.host.append(this.backdrop, root);
    this.root = root;
    this.input.focus();

    this.input.addEventListener("input", () => void this.update());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    // Switching apps blurs too; only a click elsewhere in the window cancels.
    this.input.addEventListener("blur", () => {
      if (document.hasFocus()) this.close();
    });
    // Keep focus in the input while clicking results.
    this.list.addEventListener("mousedown", (e) => e.preventDefault());
  }

  private onKey(e: KeyboardEvent) {
    e.stopPropagation();
    const ctrl = e.ctrlKey && !e.metaKey;
    if (e.key === "ArrowDown" || (ctrl && e.key === "n")) this.move(1);
    else if (e.key === "ArrowUp" || (ctrl && e.key === "p")) this.move(-1);
    else if (e.key === "Tab") this.cycleTab(e.shiftKey ? -1 : 1);
    else if (comboFromEvent(e) === COMPLETE_COMBO && this.caretAtEnd() && this.completable()) this.complete();
    else if (e.key === "Enter") this.pick();
    else if (e.key === "Escape") this.close();
    else if (comboFromEvent(e) === FAVORITE_COMBO) this.toggleFavorite(this.items[this.selected]);
    else if (comboFromEvent(e) === END_SESSION_COMBO && this.items[this.selected]?.kind === "session") this.endSession(this.items[this.selected].path);
    else return;
    // Also keeps Enter/Escape from landing in the terminal we refocus.
    e.preventDefault();
  }

  private visibleTabs() {
    const sessions = !!this.sessions && !this.options.plain;
    return TABS.filter((t) => t.id !== "sessions" || sessions);
  }

  private cycleTab(delta: number) {
    const tabs = this.visibleTabs();
    const i = tabs.findIndex((t) => t.id === this.tab);
    this.switchTab(tabs[(i + delta + tabs.length) % tabs.length].id);
  }

  /**
   * Shows `tab`, keeping what's typed as its filter, except the untouched
   * current folder, which only Directory starts on.
   */
  private switchTab(tab: TeleportTab) {
    if (tab === this.tab) return;
    if (this.prefill && this.input.value === this.prefill) this.input.value = "";
    this.tab = tab;
    if (tab === "directory" && this.prefill && !this.input.value) {
      this.input.value = this.prefill;
      this.input.select();
    }
    this.renderTabs();
    void this.update();
  }

  private renderTabs() {
    const tabs = this.visibleTabs();
    const current = TABS.find((t) => t.id === this.tab)!;
    this.input.placeholder = this.options.placeholder ?? current.placeholder;
    this.tabBar.hidden = tabs.length < 2;
    const buttons = tabs.map((t) => {
      const button = el("button", `dirpicker-tab${t.id === this.tab ? " active" : ""}`);
      button.tabIndex = -1;
      button.append(icon(t.icon, 13), t.label);
      button.addEventListener("click", () => this.switchTab(t.id));
      return button;
    });
    const hint = el("span", "dirpicker-tabs-hint");
    hint.append(kbd("tab"), " to switch");
    this.tabBar.replaceChildren(...buttons, hint);
  }

  /** The caret sits at the end of the input with nothing selected, so → has nowhere to go. */
  private caretAtEnd() {
    const { selectionStart, selectionEnd, value } = this.input;
    return selectionStart === value.length && selectionEnd === value.length;
  }

  private completable() {
    const item = this.items[this.selected];
    return !!item && item.kind !== "session";
  }

  private move(delta: number) {
    if (this.items.length === 0) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.renderSelection();
  }

  /** Ends a session from the list, then lists what's left. */
  private endSession(id: string) {
    if (!this.sessions) return;
    void this.sessions.end(id).then(
      (msg) => {
        if (msg) showToast(msg, 4000);
        if (this.root) void this.update();
      },
      (e) => showToast(String(e), 6000),
    );
  }

  /** Teleports to the highlighted folder, running the macro if one was given, opens the loadout, or picks the session back up. */
  private pick() {
    const item = this.items[this.selected];
    if (item?.kind === "macro") return this.complete();
    if (item?.kind === "session" && this.parse().macro == null) return this.close({ session: item.path });
    const parsed = this.parse();
    if (parsed.loadout != null) {
      const name = item?.kind === "loadout" ? item.path : findLoadout(parsed.loadout)?.name;
      if (name) this.close({ loadout: name });
      return;
    }
    let macro: Macro | undefined;
    if (parsed.macro != null) {
      macro = findMacro(parsed.macro);
      // Don't open a bare tab when the macro was mistyped.
      if (!macro) return;
    }
    const path = item?.path ?? this.typedPath();
    if (path != null) this.close({ dir: path, macro });
  }

  /** Stars or unstars a folder, keeping it highlighted as the list reorders. */
  private toggleFavorite(item: Candidate | undefined) {
    if (!item || item.kind === "macro" || item.kind === "loadout" || item.kind === "session") return;
    toggleFavorite(item.path);
    this.favorites = favoriteDirs();
    void this.update(item.path);
  }

  /** Fills the input with the highlighted folder (so its contents are listed next) or macro. */
  private complete() {
    const item = this.items[this.selected];
    if (!item) return;
    if (item.kind === "session") {
      return;
    } else if (item.kind === "macro") {
      this.input.value = `@${item.path} `;
    } else if (item.kind === "loadout") {
      this.input.value = `#${item.path}`;
    } else {
      const label = this.tildify(item.path);
      this.input.value = this.parse().prefix + (label === "/" ? "/" : `${label}/`);
    }
    void this.update();
  }

  private parse(): Parsed {
    const raw = this.input.value;
    if (this.options.plain || this.tab === "sessions") return { loadout: null, macro: null, naming: false, prefix: "", query: raw.trim() };
    const hash = /^\s*#(\S*)/.exec(raw);
    if (hash) return { loadout: hash[1], macro: null, naming: false, prefix: hash[0], query: "" };
    const m = /^\s*@(\S*)(\s+)?/.exec(raw);
    if (!m) return { loadout: null, macro: null, naming: false, prefix: "", query: raw.trim() };
    return { loadout: null, macro: m[1], naming: m[2] == null, prefix: m[0], query: raw.slice(m[0].length).trim() };
  }

  private tildify(path: string) {
    if (!this.home) return path;
    if (path === this.home) return "~";
    return path.startsWith(this.home + "/") ? "~" + path.slice(this.home.length) : path;
  }

  private expand(query: string) {
    if (query === "~") return this.home;
    return query.startsWith("~/") ? this.home + query.slice(1) : query;
  }

  /** The query as a path, when it is one. */
  private typedPath(): string | null {
    const q = this.parse().query;
    if (!q.startsWith("/") && !q.startsWith("~")) return null;
    const path = this.expand(q);
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  }

  private listDirs(dir: string, hidden: boolean): Promise<string[]> {
    const key = `${hidden}:${dir}`;
    let names = this.dirCache.get(key);
    if (!names) {
      names = invoke<string[]>("list_dirs", { path: dir, hidden }).catch(() => []);
      this.dirCache.set(key, names);
    }
    return names;
  }

  /** Refreshes the results, highlighting `keep` if it's still listed (else the first). */
  private async update(keep?: string) {
    const seq = ++this.seq;
    const parsed = this.parse();
    const items =
      parsed.loadout != null
        ? this.loadoutCandidates(parsed.loadout)
        : parsed.naming
          ? this.macroCandidates(parsed.macro!)
          : await this.tabCandidates(parsed.query);
    if (seq !== this.seq || !this.root) return;
    this.items = items.slice(0, MAX_RESULTS);
    this.selected = Math.max(0, keep == null ? 0 : this.items.findIndex((c) => c.path === keep && c.kind !== "macro" && c.kind !== "session"));
    this.renderMacro(parsed);
    this.render(parsed.loadout != null ? "loadout" : parsed.naming ? "macro" : this.tab, parsed.query);
  }

  /** Loadouts whose name starts with (then contains) the typed text. */
  private loadoutCandidates(typed: string): Candidate[] {
    const q = typed.toLowerCase();
    const names = usableLoadouts().map((l) => l.name);
    const starts = names.filter((n) => n.startsWith(q));
    const contains = names.filter((n) => !n.startsWith(q) && n.includes(q));
    return [...starts, ...contains].map((path) => ({ path, kind: "loadout" }));
  }

  /** Macros whose name starts with (then contains) the typed text. */
  private macroCandidates(typed: string): Candidate[] {
    const q = typed.toLowerCase();
    const names = loadMacros()
      .filter((m) => m.name && runnable(m).length > 0)
      .map((m) => m.name)
      .filter((n, i, all) => all.indexOf(n) === i);
    const starts = names.filter((n) => n.startsWith(q));
    const contains = names.filter((n) => !n.startsWith(q) && n.includes(q));
    return [...starts, ...contains].map((path) => ({ path, kind: "macro" }));
  }

  /** Shows what the chosen macro will run, or that it doesn't exist. */
  private renderMacro({ macro: name, naming }: Parsed) {
    const macro = name != null && !naming ? findMacro(name) : undefined;
    const show = name != null && !naming;
    this.macroBar.hidden = !show;
    this.macroBar.classList.toggle("error", show && !macro);
    if (!show) return;
    if (macro) {
      this.macroBar.replaceChildren(el("span", "dirpicker-macro-label", `@${macro.name} runs`), this.commandList(runnable(macro)));
    } else {
      this.macroBar.replaceChildren(`No macro named @${name}. Add one in Settings `, kbdFor("openSettings"));
    }
  }

  /** Sessions matching `query` (all of them, recent first, when it's empty). */
  private sessionCandidates(query: string): Candidate[] {
    if (!this.sessions) return [];
    const all = this.sessions.list();
    if (!query) return all.map((s) => ({ path: s.id, kind: "session" }));
    return all
      .map((s, i) => ({ s, i, score: score(s.label, `${s.label} ${s.detail}`, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((r) => ({ path: r.s.id, kind: "session" }));
  }

  /** What the current tab lists for `query`. */
  private async tabCandidates(query: string): Promise<Candidate[]> {
    const favs = new Set(this.favorites);
    switch (this.tab) {
      case "directory":
        return this.searchDirs(query);
      case "history":
        return this.rank(
          this.recents.map((path) => ({ path, kind: favs.has(path) ? "favorite" : "recent" })),
          query,
        );
      case "favorites":
        return this.rank(
          this.favorites.map((path) => ({ path, kind: "favorite" })),
          query,
        );
      case "sessions":
        return this.sessionCandidates(query);
    }
  }

  /** Folders matching `query`, best first, list order breaking ties. */
  private rank(candidates: Candidate[], query: string): Candidate[] {
    if (!query) return candidates;
    return candidates
      .map((c, i) => ({ c, i, s: score(c.path, this.tildify(c.path), query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((r) => r.c);
  }

  private async searchDirs(query: string): Promise<Candidate[]> {
    const favs = new Set(this.favorites);
    const favorites: Candidate[] = this.favorites.map((path) => ({ path, kind: "favorite" }));
    const home: Candidate[] = favs.has(this.home) ? [] : [{ path: this.home, kind: "home" }];
    const recents: Candidate[] = this.recents.filter((p) => !favs.has(p)).map((path) => ({ path, kind: "recent" }));

    if (!query) return [...favorites, ...home, ...recents];

    if (query.startsWith("/") || query.startsWith("~")) {
      const full = this.expand(query === "~" ? "~/" : query);
      const slash = full.lastIndexOf("/");
      const dir = full.slice(0, slash) || "/";
      const partial = full.slice(slash + 1).toLowerCase();
      const names = await this.listDirs(dir, partial.startsWith("."));
      const join = (name: string) => (dir === "/" ? `/${name}` : `${dir}/${name}`);
      const starts = names.filter((n) => n.toLowerCase().startsWith(partial));
      const contains = names.filter((n) => !n.toLowerCase().startsWith(partial) && n.toLowerCase().includes(partial));
      const children: Candidate[] = [...starts, ...contains].map((n) => {
        const path = join(n);
        return { path, kind: favs.has(path) ? "favorite" : "dir" };
      });
      // Starred folders float to the top of the listing.
      const sorted = [...children.filter((c) => c.kind === "favorite"), ...children.filter((c) => c.kind !== "favorite")];
      if (partial) return sorted;
      // "~/foo/" offers foo itself first.
      const self: Candidate = { path: dir, kind: favs.has(dir) ? "favorite" : dir === this.home ? "home" : "dir" };
      return [self, ...sorted];
    }

    // Plain text: favorites, then recents (each ranked, list order breaking
    // ties), then folders in ~.
    const ranked = [...favorites, ...home, ...recents]
      .map((c, i) => ({ c, i, fav: c.kind === "favorite" ? 1 : 0, s: score(c.path, this.tildify(c.path), query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.fav - a.fav || b.s - a.s || a.i - b.i)
      .map((r) => r.c);
    const seen = new Set(ranked.map((c) => c.path));
    const q = query.toLowerCase();
    const inHome = (await this.listDirs(this.home, q.startsWith(".")))
      .filter((n) => n.toLowerCase().includes(q))
      .map((n): Candidate => ({ path: `${this.home}/${n}`, kind: "dir" }))
      .filter((c) => !seen.has(c.path));
    return [...ranked, ...inHome];
  }

  private loadoutRow(item: Candidate): HTMLElement {
    const loadout = findLoadout(item.path);
    const row = el("div", "dirpicker-item");
    row.append(
      icon(Package, 14, "dirpicker-icon"),
      el("span", "dirpicker-name", item.path),
      el("span", "dirpicker-kind", loadout ? describeLoadout(loadout) : ""),
    );
    return row;
  }

  private sessionRow(item: Candidate): HTMLElement {
    const s = this.sessions?.list().find((x) => x.id === item.path);
    const row = el("div", "dirpicker-item dirpicker-session");
    const end = el("button", "dirpicker-star dirpicker-end");
    end.tabIndex = -1;
    end.title = "End session: remove its worktree";
    end.append(kbd(END_SESSION_COMBO), icon(Trash2, 13));
    end.addEventListener("click", (e) => {
      e.stopPropagation();
      this.endSession(item.path);
    });
    row.append(
      icon(Bot, 14, "dirpicker-icon"),
      el("span", "dirpicker-name", s?.label ?? item.path),
      el("span", "dirpicker-parent dirpicker-session-detail", s?.detail ?? ""),
      el("span", "dirpicker-kind", s ? (s.open ? `open · ${s.status}` : s.status) : ""),
      end,
    );
    return row;
  }

  private macroRow(item: Candidate): HTMLElement {
    const macro = findMacro(item.path);
    const row = el("div", "dirpicker-item");
    row.append(
      icon(AtSign, 14, "dirpicker-icon"),
      el("span", "dirpicker-name", item.path),
      this.commandList(macro ? runnable(macro) : [], "dirpicker-kind"),
    );
    return row;
  }

  /** Commands as prompt lines on one row, matching the macro editor in Settings. */
  private commandList(commands: string[], className = "") {
    const list = el("code", `dirpicker-commands ${className}`.trim());
    for (const command of commands) {
      const item = el("span", "dirpicker-command");
      item.append(icon(ChevronRight, 12), command);
      list.append(item);
    }
    return list;
  }

  private render(listing: TeleportTab | "macro" | "loadout", query: string) {
    const rows = this.items.map((item, i) => {
      const row =
        item.kind === "macro"
          ? this.macroRow(item)
          : item.kind === "loadout"
            ? this.loadoutRow(item)
            : item.kind === "session"
              ? this.sessionRow(item)
              : this.dirRow(item);
      row.addEventListener("mousemove", () => {
        if (this.selected === i) return;
        this.selected = i;
        this.renderSelection();
      });
      row.addEventListener("click", () => {
        this.selected = i;
        this.pick();
      });
      return row;
    });
    if (rows.length === 0) {
      const empty = el("div", "dirpicker-empty");
      if (listing === "macro") empty.append("No matching macros. Add one in Settings ", kbdFor("openSettings"));
      else if (listing === "loadout") empty.append("No matching loadouts. Save a group as one from its menu, or add one in Settings ", kbdFor("openSettings"));
      else if (listing === "directory") empty.append("No matching folders");
      else if (listing === "history") empty.append(query ? "No matching recent folders" : "No recent folders yet");
      else if (listing === "favorites") empty.append(query ? "No matching favorites" : "No favorites yet. Star a folder with ", ...(query ? [] : [kbd(FAVORITE_COMBO)]));
      else empty.append(query ? "No matching sessions" : "No sessions yet. Start one with ", ...(query ? [] : [kbdFor("newSession")]));
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
    this.renderSelection();
  }

  private dirRow(item: Candidate): HTMLElement {
    const label = this.tildify(item.path);
    const slash = label.lastIndexOf("/");
    const row = el("div", "dirpicker-item");
    const kindIcon = { favorite: Star, home: House, recent: History, dir: Folder, macro: AtSign, loadout: Package, session: Bot }[item.kind];
    const fav = item.kind === "favorite";
    const star = el("button", `dirpicker-star${fav ? " on" : ""}`);
    star.tabIndex = -1;
    star.title = fav ? "Remove from favorites" : "Add to favorites";
    star.append(kbd(FAVORITE_COMBO), icon(Star, 13));
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleFavorite(item);
    });
    row.append(
      icon(kindIcon, 14, `dirpicker-icon${fav ? " favorite" : ""}`),
      // LRMs keep the rtl ellipsis trick from moving the slashes around.
      el("span", "dirpicker-parent", slash > 0 ? `\u200e${label.slice(0, slash + 1)}\u200e` : ""),
      el("span", "dirpicker-name", slash > 0 ? label.slice(slash + 1) : label),
      el("span", "dirpicker-kind", item.path === this.cwd ? "current folder" : item.kind === "dir" ? "" : item.kind),
      star,
    );
    return row;
  }

  private renderSelection() {
    const rows = this.list.querySelectorAll<HTMLElement>(".dirpicker-item");
    rows.forEach((row, i) => row.classList.toggle("selected", i === this.selected));
    rows[this.selected]?.scrollIntoView({ block: "nearest" });
  }
}
