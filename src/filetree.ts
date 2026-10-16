import { invoke } from "@tauri-apps/api/core";
import { currentEditor, currentFolderApp } from "./filelinks";
import { tildePath } from "./favorites";
import { kbd } from "./kbd";
import {
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  Eye,
  EyeOff,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  SquareTerminal,
  X,
  icon,
} from "./icons";

type Entry = { name: string; dir: boolean };
/** One visible line of the tree. */
type Row = { path: string; name: string; dir: boolean; depth: number };

const HIDDEN_KEY = "workdesk.fileTree.hidden";
const WIDTH_KEY = "workdesk.fileTree.width";
const MIN_WIDTH = 160;
const MAX_WIDTH = 520;
/** A folder with more entries than this only lists the first ones. */
const MAX_ENTRIES = 2000;

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered past this session.
  }
}

function loadWidth(): number {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    if (w >= MIN_WIDTH && w <= MAX_WIDTH) return w;
  } catch {
    // Default it is.
  }
  return 240;
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const join = (dir: string, name: string) => (dir === "/" ? `/${name}` : `${dir}/${name}`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/** What the tree drives: the terminal pane it sits beside. */
export interface TreeTarget {
  /** Changes the shell's folder to `path`. */
  cd(path: string): void;
  focusTerminal(): void;
  close(): void;
  /** The tree's width changed, so the terminal must refit. */
  resized(): void;
}

/**
 * A browsable tree of the folder a pane's shell is in, docked on the pane's
 * left. Moving around doesn't touch the shell; "cd here" does.
 */
export class FileTree {
  readonly el = el("div", "filetree");
  private rootLabel = el("span", "filetree-root");
  private hiddenButton: HTMLButtonElement;
  private list = el("div", "filetree-list");
  private root = "";
  private showHidden = loadFlag(HIDDEN_KEY);
  /** Listed folders by path; a folder shows its children when it's in `expanded`. */
  private children = new Map<string, Entry[] | string>();
  private expanded = new Set<string>();
  private rows: Row[] = [];
  private selected = "";

  constructor(private target: TreeTarget) {
    this.el.tabIndex = 0;
    this.el.style.width = `${loadWidth()}px`;

    const bar = el("div", "filetree-bar");
    const button = (node: Parameters<typeof icon>[0], name: string, run: () => void) => {
      const b = el("button", "filetree-button");
      b.title = name;
      b.setAttribute("aria-label", name);
      b.append(icon(node, 13));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        run();
        this.el.focus();
      });
      return b;
    };
    this.hiddenButton = button(Eye, "", () => this.toggleHidden());
    this.updateHiddenButton();
    bar.append(
      button(CornerLeftUp, "Up a folder (⌘↑)", () => void this.goUp()),
      this.rootLabel,
      this.hiddenButton,
      button(RefreshCw, "Refresh (r)", () => void this.refresh()),
      button(X, "Close file tree", () => this.target.close()),
    );

    const footer = el("div", "filetree-footer");
    const hint = (combo: string, text: string) => {
      const h = el("span", "filetree-hint");
      h.append(kbd(combo), text);
      return h;
    };
    footer.append(hint("c", "cd here"), hint("f", "Finder"), hint("enter", "open"));

    const resizer = el("div", "filetree-resizer");
    resizer.addEventListener("mousedown", (e) => this.startResize(e));

    this.list.setAttribute("role", "tree");
    this.el.append(bar, this.list, footer, resizer);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** Shows `dir` as the tree's root, keeping what was expanded. `relist` re-reads it even if it's already the root. */
  async setRoot(dir: string, relist = false) {
    if (!dir) return;
    if (dir === this.root) {
      if (relist) await this.refresh();
      return;
    }
    this.root = dir;
    this.rootLabel.textContent = tildePath(dir);
    this.rootLabel.title = dir;
    await this.load(dir);
    this.render();
  }

  /** Re-lists every open folder, picking up files made or deleted since. */
  async refresh() {
    const prefix = this.root === "/" ? "/" : this.root + "/";
    const open = [this.root, ...[...this.expanded].filter((p) => p.startsWith(prefix))];
    this.children.clear();
    await Promise.all(open.map((p) => this.load(p)));
    this.render();
  }

  focus() {
    this.el.focus();
  }

  private async load(dir: string) {
    try {
      const entries = await invoke<Entry[]>("list_entries", { path: dir, hidden: this.showHidden });
      this.children.set(dir, entries.slice(0, MAX_ENTRIES));
    } catch (e) {
      this.children.set(dir, String(e));
    }
  }

  private flatten(): Row[] {
    const rows: Row[] = [];
    const walk = (dir: string, depth: number) => {
      const kids = this.children.get(dir);
      if (!Array.isArray(kids)) return;
      for (const k of kids) {
        const path = join(dir, k.name);
        rows.push({ path, name: k.name, dir: k.dir, depth });
        if (k.dir && this.expanded.has(path)) walk(path, depth + 1);
      }
    };
    walk(this.root, 0);
    return rows;
  }

  private render() {
    this.rows = this.flatten();
    if (!this.rows.some((r) => r.path === this.selected)) this.selected = this.rows[0]?.path ?? "";
    const rootState = this.children.get(this.root);
    if (typeof rootState === "string") {
      this.list.replaceChildren(el("div", "filetree-empty", rootState));
      return;
    }
    if (this.rows.length === 0) {
      this.list.replaceChildren(el("div", "filetree-empty", "Empty folder"));
      return;
    }
    this.list.replaceChildren(...this.rows.map((r) => this.rowEl(r)));
    this.scrollToSelected();
  }

  private rowEl(r: Row): HTMLElement {
    const row = el("div", "filetree-row");
    row.setAttribute("role", "treeitem");
    row.dataset.path = r.path;
    row.style.paddingLeft = `${8 + r.depth * 14}px`;
    if (r.path === this.selected) row.classList.add("selected");
    if (r.name.startsWith(".")) row.classList.add("hidden-entry");
    const open = r.dir && this.expanded.has(r.path);
    if (r.dir) row.setAttribute("aria-expanded", String(open));
    const twisty = el("span", "filetree-twisty");
    if (r.dir) twisty.append(icon(open ? ChevronDown : ChevronRight, 12));
    const kind = icon(r.dir ? (open ? FolderOpen : Folder) : File, 13, r.dir ? "filetree-dir-icon" : "filetree-file-icon");
    const name = el("span", "filetree-name", r.name);
    const kids = this.children.get(r.path);
    if (open && typeof kids === "string") name.title = kids;

    const actions = el("span", "filetree-actions");
    const action = (node: Parameters<typeof icon>[0], title: string, run: () => void) => {
      const b = el("button", "filetree-action");
      b.title = title;
      b.setAttribute("aria-label", title);
      b.append(icon(node, 12));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selected = r.path;
        run();
      });
      return b;
    };
    actions.append(
      action(SquareTerminal, r.dir ? "cd here (c)" : "cd to its folder (c)", () => this.cdHere(r)),
      action(FolderOpen, r.dir ? "Open in Finder (f)" : "Show in Finder (f)", () => this.finder(r)),
    );
    row.append(twisty, kind, name, actions);
    row.addEventListener("mousedown", (e) => {
      // Keep focus on the tree, not the row.
      e.preventDefault();
      this.el.focus();
    });
    row.addEventListener("click", () => {
      this.select(r.path);
      if (r.dir) void this.toggle(r);
    });
    row.addEventListener("dblclick", () => {
      if (!r.dir) this.openFile(r);
    });
    return row;
  }

  private select(path: string) {
    this.selected = path;
    for (const row of this.list.children) row.classList.toggle("selected", (row as HTMLElement).dataset.path === path);
    this.scrollToSelected();
  }

  private scrollToSelected() {
    const row = [...this.list.children].find((r) => (r as HTMLElement).dataset.path === this.selected);
    row?.scrollIntoView({ block: "nearest" });
  }

  private get current(): Row | undefined {
    return this.rows.find((r) => r.path === this.selected);
  }

  private async toggle(r: Row, open = !this.expanded.has(r.path)) {
    if (open) {
      this.expanded.add(r.path);
      if (!this.children.has(r.path)) await this.load(r.path);
    } else {
      this.expanded.delete(r.path);
    }
    this.render();
  }

  private async goUp() {
    if (this.root === "/") return;
    const old = this.root;
    this.expanded.add(old);
    await this.setRoot(parentOf(old));
    this.select(old);
  }

  private toggleHidden() {
    this.showHidden = !this.showHidden;
    save(HIDDEN_KEY, this.showHidden ? "1" : "0");
    this.updateHiddenButton();
    void this.refresh();
  }

  private updateHiddenButton() {
    const name = this.showHidden ? "Hide dotfiles (.)" : "Show dotfiles (.)";
    this.hiddenButton.title = name;
    this.hiddenButton.setAttribute("aria-label", name);
    this.hiddenButton.setAttribute("aria-pressed", String(this.showHidden));
    this.hiddenButton.replaceChildren(icon(this.showHidden ? Eye : EyeOff, 13));
  }

  private cdHere(r: Row | undefined = this.current) {
    this.target.cd(r ? (r.dir ? r.path : parentOf(r.path)) : this.root);
  }

  private finder(r: Row | undefined = this.current) {
    void invoke("show_in_finder", { path: r?.path ?? this.root });
  }

  private openFile(r: Row) {
    void Promise.all([currentEditor(), currentFolderApp()]).then(([editor, folderApp]) =>
      invoke("open_in_editor", { editor, folderApp, path: r.path, line: null, col: null }),
    );
  }

  private move(by: number) {
    if (this.rows.length === 0) return;
    const i = this.rows.findIndex((r) => r.path === this.selected);
    const next = Math.max(0, Math.min(this.rows.length - 1, (i < 0 ? 0 : i) + by));
    this.select(this.rows[next].path);
  }

  private onKey(e: KeyboardEvent) {
    // ⌘↑, as in Finder.
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      void this.goUp();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const r = this.current;
    const page = Math.max(1, Math.floor(this.list.clientHeight / 24) - 1);
    const keys: Record<string, () => void> = {
      ArrowDown: () => this.move(1),
      j: () => this.move(1),
      ArrowUp: () => this.move(-1),
      k: () => this.move(-1),
      PageDown: () => this.move(page),
      PageUp: () => this.move(-page),
      Home: () => this.move(-Infinity),
      End: () => this.move(Infinity),
      ArrowRight: () => this.expandOrEnter(r),
      l: () => this.expandOrEnter(r),
      ArrowLeft: () => this.collapseOrParent(r),
      h: () => this.collapseOrParent(r),
      Enter: () => r && (r.dir ? void this.toggle(r) : this.openFile(r)),
      " ": () => r?.dir && void this.toggle(r),
      c: () => this.cdHere(r),
      f: () => this.finder(r),
      o: () => this.finder(r),
      r: () => void this.refresh(),
      ".": () => this.toggleHidden(),
      Backspace: () => void this.goUp(),
      "-": () => void this.goUp(),
      Escape: () => this.target.focusTerminal(),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  private expandOrEnter(r: Row | undefined) {
    if (!r?.dir) return;
    if (!this.expanded.has(r.path)) void this.toggle(r, true);
    else this.move(1);
  }

  private collapseOrParent(r: Row | undefined) {
    if (!r) return;
    if (r.dir && this.expanded.has(r.path)) void this.toggle(r, false);
    else if (parentOf(r.path) !== this.root) this.select(parentOf(r.path));
  }

  private startResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = this.el.offsetWidth;
    document.body.classList.add("resizing");
    const onMove = (m: MouseEvent) => {
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + m.clientX - startX));
      this.el.style.width = `${w}px`;
      this.target.resized();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing");
      save(WIDTH_KEY, String(this.el.offsetWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
}
