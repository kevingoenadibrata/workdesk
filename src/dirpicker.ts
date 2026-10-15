import { invoke } from "@tauri-apps/api/core";
import { pruneRecents, recentDirs, setHome, touchRecent } from "./recents";
import { findMacro, loadMacros, runnable, type Macro } from "./macros";
import { describeLoadout, findLoadout, usableLoadouts } from "./loadouts";
import { favoriteDirs, toggleFavorite } from "./favorites";
import { kbd, kbdFor } from "./kbd";
import { comboFromEvent } from "./shortcuts";
import { AtSign, ChevronRight, Folder, History, House, Package, Star, icon } from "./icons";

interface Candidate {
  /** Absolute path, or the macro or loadout name for those kinds. */
  path: string;
  kind: "favorite" | "home" | "recent" | "dir" | "macro" | "loadout";
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

const MAX_RESULTS = 50;
const FAVORITE_COMBO = "mod+d";

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
 * Teleport (⌘⇧T): palette for choosing where a new tab starts. With no query
 * it lists favorites, home and recent directories; plain text filters those
 * (plus folders in ~), favorites always first; ⌘D stars the highlighted folder; a query starting with `~` or `/` browses the filesystem, Tab
 * completing into the highlighted folder. A leading "@name" picks a macro whose
 * commands run in the new tab; "#name" opens a loadout instead of one tab.
 */
export class DirPicker {
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private macroBar!: HTMLElement;
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

  constructor(private host: HTMLElement) {}

  get isOpen() {
    return this.root != null;
  }

  async open(onPick: (dir: string, macro?: Macro) => void, onCancel: () => void, onLoadout: (name: string) => void) {
    if (this.root) return this.input.focus();
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.onLoadout = onLoadout;
    this.dirCache.clear();
    this.recents = recentDirs();
    this.favorites = favoriteDirs();
    this.build();
    this.home = await homeReady.catch(() => "");
    void this.update();

    // Quietly forget recents that were deleted.
    void invoke<string[]>("existing_dirs", { paths: this.recents }).then((existing) => {
      if (existing.length === this.recents.length) return;
      pruneRecents(existing);
      this.recents = recentDirs();
      if (this.root) void this.update();
    });
  }

  close(picked?: { dir: string; macro?: Macro } | { loadout: string }) {
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
    if (picked && "loadout" in picked) {
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
    this.input.placeholder = "Teleport to…  (~/ or / to browse, @macro to run, #loadout to open)";
    this.input.spellcheck = false;
    this.input.autocomplete = "off";
    this.list = el("div", "dirpicker-list");
    this.macroBar = el("div", "dirpicker-macro");
    root.append(this.input, this.macroBar, this.list);
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
    else if (e.key === "Tab") this.complete();
    else if (e.key === "Enter") this.pick();
    else if (e.key === "Escape") this.close();
    else if (comboFromEvent(e) === FAVORITE_COMBO) this.toggleFavorite(this.items[this.selected]);
    else return;
    // Also keeps Enter/Escape from landing in the terminal we refocus.
    e.preventDefault();
  }

  private move(delta: number) {
    if (this.items.length === 0) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.renderSelection();
  }

  /** Teleports to the highlighted folder, running the macro if one was given, or opens the loadout. */
  private pick() {
    const item = this.items[this.selected];
    if (item?.kind === "macro") return this.complete();
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
    if (!item || item.kind === "macro" || item.kind === "loadout") return;
    toggleFavorite(item.path);
    this.favorites = favoriteDirs();
    void this.update(item.path);
  }

  /** Fills the input with the highlighted folder (so its contents are listed next) or macro. */
  private complete() {
    const item = this.items[this.selected];
    if (!item) return;
    if (item.kind === "macro") {
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
          : await this.search(parsed.query);
    if (seq !== this.seq || !this.root) return;
    this.items = items.slice(0, MAX_RESULTS);
    this.selected = Math.max(0, keep == null ? 0 : this.items.findIndex((c) => c.path === keep && c.kind !== "macro"));
    this.renderMacro(parsed);
    this.render(parsed.loadout != null ? "loadout" : parsed.naming ? "macro" : "dir");
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

  private async search(query: string): Promise<Candidate[]> {
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

  private render(listing: "dir" | "macro" | "loadout") {
    const rows = this.items.map((item, i) => {
      const row =
        item.kind === "macro" ? this.macroRow(item) : item.kind === "loadout" ? this.loadoutRow(item) : this.dirRow(item);
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
      const text = {
        dir: "No matching folders",
        macro: "No matching macros. Add one in Settings ",
        loadout: "No matching loadouts. Save a group as one from its menu, or add one in Settings ",
      }[listing];
      const empty = el("div", "dirpicker-empty", text);
      if (listing !== "dir") empty.append(kbdFor("openSettings"));
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
    this.renderSelection();
  }

  private dirRow(item: Candidate): HTMLElement {
    const label = this.tildify(item.path);
    const slash = label.lastIndexOf("/");
    const row = el("div", "dirpicker-item");
    const kindIcon = { favorite: Star, home: House, recent: History, dir: Folder, macro: AtSign, loadout: Package }[item.kind];
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
      el("span", "dirpicker-kind", item.kind === "dir" ? "" : item.kind),
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
