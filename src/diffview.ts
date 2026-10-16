import { el } from "./page";
import { gitDiff } from "./pty";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, FileCode, RotateCcw, Rows2, X, icon } from "./icons";

// ---- parsing `git diff` ----

type LineKind = "ctx" | "add" | "del" | "note";

interface DiffLine {
  kind: LineKind;
  text: string;
  old?: number;
  new?: number;
}

interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  /** Where a renamed file used to be. */
  oldPath?: string;
  status: "added" | "deleted" | "renamed" | "modified";
  binary: boolean;
  hunks: Hunk[];
  added: number;
  removed: number;
  /** Bytes of diff, when it was too big to send over; its lines aren't shown. */
  tooLarge?: number;
}

/** What git_diff puts in place of a file's hunks when they're too big: `<bytes> <added> <removed>`. */
const TOO_LARGE = "workdesk-too-large ";

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** Both sides of `diff --git a/X b/Y`, for files whose ---/+++ lines don't name them (binary, mode-only). */
function headerPaths(line: string): [string, string] {
  const rest = line.slice("diff --git a/".length);
  // Unrenamed files name the same path twice, so the split is in the middle.
  const mid = (rest.length - " b/".length) / 2;
  if (Number.isInteger(mid) && rest.slice(mid, mid + 3) === " b/" && rest.slice(0, mid) === rest.slice(mid + 3)) {
    return [rest.slice(0, mid), rest.slice(mid + 3)];
  }
  const i = rest.indexOf(" b/");
  return i < 0 ? [rest, rest] : [rest.slice(0, i), rest.slice(i + 3)];
}

export function parseDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const [a, b] = headerPaths(line);
      file = { path: b, oldPath: a !== b ? a : undefined, status: "modified", binary: false, hunks: [], added: 0, removed: 0 };
      if (file.oldPath) file.status = "renamed";
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (hunk) {
      const c = line[0];
      if (c === "+") {
        hunk.lines.push({ kind: "add", text: line.slice(1), new: newNo++ });
        file.added++;
        continue;
      }
      if (c === "-") {
        hunk.lines.push({ kind: "del", text: line.slice(1), old: oldNo++ });
        file.removed++;
        continue;
      }
      if (c === " ") {
        hunk.lines.push({ kind: "ctx", text: line.slice(1), old: oldNo++, new: newNo++ });
        continue;
      }
      if (c === "\\") {
        hunk.lines.push({ kind: "note", text: line.slice(2) });
        continue;
      }
    }
    const m = HUNK.exec(line);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      hunk = { header: m[3].trim(), lines: [] };
      file.hunks.push(hunk);
    } else if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) file.oldPath = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
    else if (line.startsWith("Binary files ")) file.binary = true;
    else if (line.startsWith(TOO_LARGE)) {
      const [bytes, added, removed] = line.slice(TOO_LARGE.length).split(" ").map(Number);
      Object.assign(file, { tooLarge: bytes, added, removed });
    }
    else if (line.startsWith("+++ b/")) file.path = line.slice(6);
    else if (line.startsWith("--- a/") && file.status === "deleted") file.path = line.slice(6);
  }
  return files;
}

// ---- rendering ----

/** Past this many lines a file waits for a click before drawing, each time the sheet opens. */
const LARGE_FILE = 1500;
const VIEW_KEY = "workdesk.diffView";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * A critically damped spring (SwiftUI's `.smooth`) as a CSS easing: it moves
 * like something with mass that glides to a stop, with no overshoot that
 * would pull the sheet off the window's edge. `response` is the spring's
 * period in seconds; returns the easing and how long it takes to settle.
 */
function spring(response: number): { easing: string; duration: number } {
  const w = (2 * Math.PI) / response;
  // Settled once within 0.1% of the way: (1 + u)e^-u = 0.001 at u ≈ 9.23.
  const duration = 9.23 / w;
  if (!CSS.supports("animation-timing-function", "linear(0, 1)")) {
    return { easing: "cubic-bezier(0.25, 0.9, 0.3, 1)", duration: duration * 600 };
  }
  const points: string[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const u = (w * duration * i) / steps;
    points.push((i === steps ? 1 : 1 - (1 + u) * Math.exp(-u)).toFixed(4));
  }
  return { easing: `linear(${points.join(", ")})`, duration: duration * 1000 };
}
const SLIDE_IN = spring(0.5);
const SLIDE_OUT = spring(0.36);
const ms = (n: number) => (reduceMotion.matches ? 0 : n);
type ViewMode = "unified" | "split";

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

/**
 * The changed part of a removed/added line pair: what's left after their
 * common start and end. Null when nearly everything changed, where marking
 * it would just be noise.
 */
function changedSpan(a: string, b: string): [number, number] | null {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  if (start + end === 0) return null;
  return [start, end];
}

function codeCell(text: string, other?: string): HTMLElement {
  const cell = el("span", "diff-code");
  const span = other != null ? changedSpan(text, other) : null;
  if (!span || span[0] + span[1] >= text.length) {
    cell.textContent = text;
    return cell;
  }
  const [start, end] = span;
  cell.append(text.slice(0, start), el("mark", "diff-word", text.slice(start, text.length - end)), text.slice(text.length - end));
  return cell;
}

/** One side of a row: a line with its number(s), or a gap facing the other side's line. */
interface Cell {
  kind: LineKind | "empty";
  nums: (number | undefined)[];
  text: string;
  /** The line it replaces or is replaced by, to mark what changed between them. */
  pair?: string;
}

/** A hunk's header, or a line: one cell in unified view, one per side in split. */
type Row = { hunk: string } | { cells: Cell[] };

const ROW_H = 19;
const HUNK_H = 26;
const rowHeight = (r: Row) => ("hunk" in r ? HUNK_H : ROW_H);

/** Each run of removed lines followed by added ones, paired up row by row. */
function* runs(lines: DiffLine[]) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind !== "del" && line.kind !== "add") {
      yield { line, before: lines[i - 1] };
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (lines[i]?.kind === "del") dels.push(lines[i++]);
    while (lines[i]?.kind === "add") adds.push(lines[i++]);
    yield { dels, adds };
  }
}

function hunkTitle(h: Hunk): string {
  const first = h.lines.find((l) => l.kind !== "note");
  const at = first ? `${first.old ?? first.new}` : "";
  return h.header ? `@@ ${at ? `line ${at} · ` : ""}${h.header}` : `@@ line ${at}`;
}

const EMPTY: Cell = { kind: "empty", nums: [undefined], text: "" };

/** A file's diff as the rows of one view. */
function rowsOf(file: DiffFile, view: ViewMode): Row[] {
  const rows: Row[] = [];
  for (const h of file.hunks) {
    rows.push({ hunk: hunkTitle(h) });
    for (const r of runs(h.lines)) {
      if ("line" in r) {
        const l = r.line!;
        if (view === "unified") rows.push({ cells: [{ kind: l.kind, nums: [l.old, l.new], text: l.text }] });
        else if (l.kind === "note") {
          // It's about the line before it, so it goes on that line's side.
          const before = r.before?.kind;
          const note: Cell = { kind: "note", nums: [undefined], text: l.text };
          rows.push({ cells: [before !== "add" ? note : EMPTY, before !== "del" ? note : EMPTY] });
        } else {
          rows.push({ cells: [{ kind: "ctx", nums: [l.old], text: l.text }, { kind: "ctx", nums: [l.new], text: l.text }] });
        }
        continue;
      }
      // Only mark what changed when lines pair up one to one.
      const paired = r.dels.length === r.adds.length;
      const cell = (l: DiffLine, other?: DiffLine): Cell => ({
        kind: l.kind,
        nums: view === "unified" ? [l.old, l.new] : [l.kind === "add" ? l.new : l.old],
        text: l.text,
        pair: paired ? other?.text : undefined,
      });
      if (view === "unified") {
        r.dels.forEach((d, i) => rows.push({ cells: [cell(d, r.adds[i])] }));
        r.adds.forEach((a, i) => rows.push({ cells: [cell(a, r.dels[i])] }));
      } else {
        for (let i = 0; i < Math.max(r.dels.length, r.adds.length); i++) {
          const d = r.dels[i];
          const a = r.adds[i];
          rows.push({ cells: [d ? cell(d, a) : EMPTY, a ? cell(a, d) : EMPTY] });
        }
      }
    }
  }
  return rows;
}

/** Display width of a line in characters, with tabs at 4. */
function columns(text: string): number {
  let n = text.length;
  for (let i = text.indexOf("\t"); i >= 0; i = text.indexOf("\t", i + 1)) n += 3;
  return n;
}

/** Rows are drawn in blocks this size, so scrolling redraws only when crossing one. */
const BLOCK = 64;
/** How far past the visible area to draw, in px, so fast scrolling doesn't show gaps. */
const OVERSCAN = 600;

/**
 * One file's diff, drawing only the rows near the visible part of the
 * sheet: a 50,000-line file costs what a 50-line one does. Rows have fixed
 * heights, so where each one goes is known without laying anything out.
 */
class VirtualDiff {
  readonly el: HTMLElement;
  private rows: Row[];
  /** Top of each row, plus the total height at the end. */
  private tops: Float64Array;
  /** Per side (one in unified, two in split): its line-number layer and code layer. */
  private layers: { gutter: HTMLElement; code: HTMLElement }[] = [];
  private drawn: [number, number] = [0, 0];

  constructor(file: DiffFile, view: ViewMode) {
    this.rows = rowsOf(file, view);
    this.tops = new Float64Array(this.rows.length + 1);
    this.rows.forEach((r, i) => (this.tops[i + 1] = this.tops[i] + rowHeight(r)));
    const height = `${this.tops[this.rows.length]}px`;

    this.el = el("div", `diff-grid ${view}`);
    const sides = view === "split" ? 2 : 1;
    const codeCols: HTMLElement[] = [];
    for (let side = 0; side < sides; side++) {
      let widest = 0;
      for (const r of this.rows) if ("cells" in r) widest = Math.max(widest, columns(r.cells[side].text));
      const pane = el("div", "diff-pane");
      const gutter = el("div", "diff-layer diff-gutter");
      const codeCol = el("div", "diff-codecol");
      const code = el("div", "diff-layer");
      gutter.style.height = code.style.height = height;
      // As wide as the longest line, so every row's color runs to the same edge.
      code.style.width = `max(100%, calc(${widest}ch + 40px))`;
      codeCol.append(code);
      pane.append(gutter, codeCol);
      this.el.append(pane);
      this.layers.push({ gutter, code });
      codeCols.push(codeCol);
    }
    // Split view's two sides scroll sideways together.
    if (codeCols.length === 2) {
      let syncing = false;
      for (const [a, b] of [codeCols, [...codeCols].reverse()]) {
        a.addEventListener("scroll", () => {
          if (syncing) return void (syncing = false);
          if (b.scrollLeft !== a.scrollLeft) {
            syncing = true;
            b.scrollLeft = a.scrollLeft;
          }
        });
      }
    }
  }

  /** First row whose bottom is below `y`. */
  private rowAt(y: number): number {
    let lo = 0;
    let hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tops[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Draws the rows between `top` and `bottom`, in px from the top of this file's rows. */
  update(top: number, bottom: number) {
    const total = this.tops[this.rows.length];
    let range: [number, number] = [0, 0];
    if (bottom + OVERSCAN > 0 && top - OVERSCAN < total) {
      const first = Math.floor(this.rowAt(Math.max(0, top - OVERSCAN)) / BLOCK) * BLOCK;
      const last = Math.min(this.rows.length, Math.ceil((this.rowAt(bottom + OVERSCAN) + 1) / BLOCK) * BLOCK);
      range = [first, last];
    }
    if (range[0] === this.drawn[0] && range[1] === this.drawn[1]) return;
    this.drawn = range;
    this.layers.forEach(({ gutter, code }, side) => {
      const nums = document.createDocumentFragment();
      const lines = document.createDocumentFragment();
      for (let i = range[0]; i < range[1]; i++) {
        const r = this.rows[i];
        const style = `top:${this.tops[i]}px;height:${rowHeight(r)}px`;
        if ("hunk" in r) {
          const g = el("div", "diff-line hunk");
          const c = el("div", "diff-line hunk", side === 0 ? r.hunk : "");
          g.style.cssText = c.style.cssText = style;
          nums.append(g);
          lines.append(c);
          continue;
        }
        const cell = r.cells[side];
        const g = el("div", `diff-line ${cell.kind}`);
        for (const n of cell.nums) g.append(el("span", "diff-num", n != null ? String(n) : ""));
        const c = el("div", `diff-line ${cell.kind}`);
        c.append(codeCell(cell.text, cell.pair));
        g.style.cssText = c.style.cssText = style;
        nums.append(g);
        lines.append(c);
      }
      gutter.replaceChildren(nums);
      code.replaceChildren(lines);
    });
  }
}

const STATUS_LETTER: Record<DiffFile["status"], string> = { added: "A", deleted: "D", renamed: "R", modified: "M" };

function counts(added: number, removed: number): HTMLElement {
  const wrap = el("span", "diff-counts");
  wrap.append(el("span", "diff-added", `+${added}`), el("span", "diff-removed", `-${removed}`));
  return wrap;
}

/** Five blocks showing the file's share of added to removed lines, like GitHub's. */
function bar(added: number, removed: number): HTMLElement {
  const wrap = el("span", "diff-bar");
  const total = added + removed;
  const green = total ? Math.round((added / total) * 5) : 0;
  const red = total ? Math.min(5 - green, Math.max(removed ? 1 : 0, Math.round((removed / total) * 5))) : 0;
  for (let i = 0; i < 5; i++) wrap.append(el("span", i < green ? "add" : i < green + red ? "del" : ""));
  return wrap;
}

/**
 * Every change since the last commit in one repo, in a sheet that slides in
 * from the right over the terminals. Opened from a pane's +/- card.
 */
export class DiffSheet {
  private dir = "";
  private repo = "";
  private branch = "";
  private view: ViewMode = loadView();
  private files: DiffFile[] = [];
  private error = "";
  private collapsed = new Set<string>();
  /** Large files shown since the sheet last opened. */
  private shownLarge = new Set<string>();
  /** Each expanded file's rows, by path. */
  private virtual = new Map<string, VirtualDiff>();
  private drawQueued = false;
  private root: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private loading = 0;
  /** Waiting on the first read of this repo's diff. */
  private pending = false;
  /** The patch on screen, to skip re-rendering when nothing changed. */
  private patch: string | null = null;
  /** The Collapse all / Expand all button in the header. */
  private foldButton: HTMLButtonElement | null = null;
  /** Bumped per open/close, so a slow first read can't open a sheet that was since closed. */
  private opening = 0;
  /** Called after the sheet closes, e.g. to put focus back in the terminal. */
  onClose = () => {};

  constructor() {
    window.addEventListener("focus", () => this.isOpen && void this.refresh());
  }

  get isOpen() {
    return this.root != null;
  }

  /** Opens the sheet on the repo `dir` is in. */
  async show(dir: string, repo: string, branch: string) {
    const switching = dir !== this.dir;
    if (switching) {
      this.collapsed.clear();
      this.files = [];
      this.error = "";
      this.patch = null;
      this.pending = true;
    }
    this.dir = dir;
    this.repo = repo;
    this.branch = branch;
    if (this.root) {
      this.root.querySelector(".diff-head")?.replaceWith(this.buildHead());
      if (switching) this.render();
      void this.refresh();
      return;
    }
    // Read the diff before sliding in, so the sheet arrives full instead of
    // filling in mid-animation. A slow repo gets the loading state instead.
    const opening = ++this.opening;
    await Promise.race([this.refresh(), new Promise((r) => setTimeout(r, 120))]);
    if (opening === this.opening && !this.root) this.build();
  }

  close() {
    const root = this.root;
    if (!root) return;
    this.root = null;
    this.content = null;
    this.opening++;
    // Reopening starts large files hidden again.
    this.shownLarge.clear();
    const sheet = root.querySelector<HTMLElement>(".diff-sheet")!;
    const scrim = root.querySelector<HTMLElement>(".diff-scrim")!;
    root.style.pointerEvents = "none";
    // Reverse from wherever the open animation got to.
    const at = new DOMMatrix(getComputedStyle(sheet).transform).m41;
    sheet.getAnimations().forEach((a) => a.cancel());
    scrim.getAnimations().forEach((a) => a.cancel());
    const out = sheet.animate([{ transform: `translateX(${at}px)` }, { transform: "translateX(100%)" }], {
      duration: ms(SLIDE_OUT.duration),
      easing: SLIDE_OUT.easing,
      fill: "forwards",
    });
    scrim.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], { duration: ms(SLIDE_OUT.duration), easing: SLIDE_OUT.easing, fill: "forwards" });
    out.finished.then(() => root.remove(), () => root.remove());
    this.onClose();
  }

  private build() {
    const root = el("div", "diff-overlay");
    const scrim = el("div", "diff-scrim");
    scrim.addEventListener("click", () => this.close());
    const sheet = el("aside", "diff-sheet");
    sheet.tabIndex = -1;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Changes");
    sheet.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    this.content = el("div", "diff-content");
    const scroller = el("div", "diff-scroll");
    scroller.append(this.content);
    scroller.addEventListener("scroll", () => this.scheduleDraw(), { passive: true });
    new ResizeObserver(() => this.scheduleDraw()).observe(scroller);
    sheet.append(this.buildHead(), scroller);
    root.append(scrim, sheet);
    document.body.append(root);
    this.root = root;
    this.render();
    sheet.focus({ preventScroll: true });
    // Web Animations start from their first keyframe on the very first frame,
    // so the sheet never shows in place before sliding.
    sheet.animate([{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], {
      duration: ms(SLIDE_IN.duration),
      easing: SLIDE_IN.easing,
    });
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(SLIDE_IN.duration), easing: SLIDE_IN.easing });
  }

  private buildHead(): HTMLElement {
    const head = el("header", "diff-head");
    // It sits where the title bar was, so it moves the window like one.
    head.dataset.tauriDragRegion = "";
    const text = el("div", "diff-head-text");
    text.dataset.tauriDragRegion = "";
    text.append(
      el("h2", "diff-title", "Changes"),
      el("span", "diff-meta-repo", this.repo),
      el("span", "diff-meta-sep", "·"),
      el("span", "diff-meta-branch", this.branch || "no commits"),
    );

    const tools = el("div", "diff-tools");
    const toggle = el("div", "diff-toggle");
    toggle.setAttribute("role", "radiogroup");
    for (const [mode, node, label] of [["unified", Rows2, "Unified"], ["split", Columns2, "Split"]] as const) {
      const b = el("button", "diff-toggle-option");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(this.view === mode));
      b.append(icon(node, 13), label);
      b.addEventListener("click", () => {
        this.view = mode;
        try {
          localStorage.setItem(VIEW_KEY, mode);
        } catch {}
        toggle.querySelectorAll("button").forEach((o) => o.setAttribute("aria-checked", String(o === b)));
        this.render();
      });
      toggle.append(b);
    }
    const button = (node: Parameters<typeof icon>[0], label: string, run: () => void) => {
      const b = el("button", "diff-icon-button");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(node, 13));
      b.addEventListener("click", run);
      return b;
    };
    this.foldButton = el("button", "diff-fold");
    this.foldButton.addEventListener("click", () => {
      if (this.allCollapsed) this.collapsed.clear();
      else for (const f of this.files) this.collapsed.add(f.path);
      this.render();
    });
    this.syncFold();
    tools.append(this.foldButton, toggle, button(RotateCcw, "Refresh", () => void this.refresh()), button(X, "Close", () => this.close()));
    head.append(text, tools);
    return head;
  }

  private get allCollapsed() {
    return this.files.length > 0 && this.files.every((f) => this.collapsed.has(f.path));
  }

  /** Points the fold button at whichever of collapsing or expanding everything is left to do. */
  private syncFold() {
    const b = this.foldButton;
    if (!b) return;
    const expand = this.allCollapsed;
    b.hidden = this.files.length === 0;
    b.replaceChildren(icon(expand ? ChevronsUpDown : ChevronsDownUp, 13), expand ? "Expand all" : "Collapse all");
  }

  private async refresh() {
    const dir = this.dir;
    const ticket = ++this.loading;
    try {
      const patch = await gitDiff(dir);
      if (ticket !== this.loading) return;
      // Unchanged: leave the DOM alone, so polling never flickers the sheet.
      if (patch === this.patch && !this.error) return;
      this.patch = patch;
      this.files = parseDiff(patch);
      this.error = "";
    } catch (e) {
      if (ticket !== this.loading) return;
      this.files = [];
      this.patch = null;
      this.error = String(e);
    }
    this.pending = false;
    this.render();
  }

  private render() {
    const content = this.content;
    if (!content?.isConnected) return;
    this.syncFold();
    const scroller = content.closest(".diff-scroll");
    const scroll = scroller?.scrollTop ?? 0;

    if (this.pending) {
      content.replaceChildren(el("p", "diff-empty-text", "Reading changes…"));
      return;
    }
    if (this.error || this.files.length === 0) {
      const empty = el("div", "diff-empty");
      empty.append(
        el("p", "diff-empty-title", this.error ? "Couldn't read the changes" : "No changes"),
        el("p", "diff-empty-text", this.error || "Nothing has changed since the last commit."),
      );
      content.replaceChildren(empty);
      return;
    }

    const added = this.files.reduce((n, f) => n + f.added, 0);
    const removed = this.files.reduce((n, f) => n + f.removed, 0);

    const nav = el("nav", "diff-files");
    const summary = el("div", "diff-summary");
    summary.append(el("span", "", `${this.files.length} ${this.files.length === 1 ? "file" : "files"}`), counts(added, removed));
    nav.append(summary);

    this.virtual.clear();
    const list = el("div", "diff-list");
    for (const file of this.files) {
      const section = this.renderFile(file);
      list.append(section);

      const item = el("button", `diff-file-link ${file.status}`);
      const slash = file.path.lastIndexOf("/");
      item.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
      item.append(
        el("span", "diff-status", STATUS_LETTER[file.status]),
        el("span", "diff-file-name", file.path.slice(slash + 1)),
        el("span", "diff-file-dir", slash > 0 ? file.path.slice(0, slash) : ""),
        bar(file.added, file.removed),
      );
      item.addEventListener("click", () => {
        if (this.collapsed.delete(file.path)) this.render();
        list.querySelector<HTMLElement>(`[data-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: "start" });
      });
      nav.append(item);
    }

    const layout = el("div", `diff-layout ${this.view}`);
    layout.append(nav, list);
    content.replaceChildren(layout);
    if (scroller) scroller.scrollTop = scroll;
    this.drawVisible();
  }

  private renderFile(file: DiffFile): HTMLElement {
    const section = el("section", "diff-file");
    section.dataset.path = file.path;
    const collapsed = this.collapsed.has(file.path);
    const head = el("button", "diff-file-head");
    head.setAttribute("aria-expanded", String(!collapsed));
    const name = el("span", "diff-file-path");
    if (file.oldPath) name.append(el("span", "diff-file-old", file.oldPath), " → ");
    name.append(file.path);
    head.append(
      icon(collapsed ? ChevronRight : ChevronDown, 14, "diff-chevron"),
      icon(FileCode, 13, "diff-file-icon"),
      name,
      el("span", `diff-badge ${file.status}`, file.status),
      counts(file.added, file.removed),
    );
    head.addEventListener("click", () => {
      if (!this.collapsed.delete(file.path)) this.collapsed.add(file.path);
      this.virtual.delete(file.path);
      section.replaceWith(this.renderFile(file));
      this.syncFold();
      this.scheduleDraw();
    });
    section.append(head);
    if (collapsed) return section;

    if (file.binary || file.hunks.length === 0 || file.tooLarge != null) {
      const note = file.binary
        ? "Binary file not shown."
        : file.tooLarge != null
          ? `Too large to show (${(file.tooLarge / 1024 / 1024).toFixed(1)} MB of changes).`
          : file.oldPath
            ? "Renamed without changes."
            : "Only the file mode changed.";
      section.append(el("div", "diff-note", note));
      return section;
    }
    const lines = file.hunks.reduce((n, h) => n + h.lines.length, 0);
    if (lines > LARGE_FILE && !this.shownLarge.has(file.path)) {
      const note = el("div", "diff-note");
      const show = el("button", "diff-show", `Show ${lines.toLocaleString()} lines`);
      show.addEventListener("click", () => {
        this.shownLarge.add(file.path);
        section.replaceWith(this.renderFile(file));
      });
      note.append("Large diff hidden. ", show);
      section.append(note);
      return section;
    }
    const diff = new VirtualDiff(file, this.view);
    this.virtual.set(file.path, diff);
    section.append(diff.el);
    this.scheduleDraw();
    return section;
  }

  /** Draws the rows of each file that are on screen, or nearly. */
  private drawVisible() {
    const scroller = this.root?.querySelector<HTMLElement>(".diff-scroll");
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    // Read every position first, then draw, so layout runs once.
    const spans = [...this.virtual.values()]
      .filter((d) => d.el.isConnected)
      .map((d) => {
        const r = d.el.getBoundingClientRect();
        return [d, view.top - r.top, view.bottom - r.top] as const;
      });
    for (const [d, top, bottom] of spans) d.update(top, bottom);
  }

  private scheduleDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.drawVisible();
    });
  }

}

let sheet: DiffSheet | null = null;

/** Lets panes open the diff sheet, which main.ts creates. */
export function registerDiffSheet(s: DiffSheet) {
  sheet = s;
}

export function showDiff(dir: string, repo: string, branch: string) {
  void sheet?.show(dir, repo, branch);
}
