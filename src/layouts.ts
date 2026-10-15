import { MAX_COLUMNS, MAX_ROWS, type Tab, type Workspace } from "./workspace";
import type { TermSession } from "./terminal";
import { suspendShortcuts } from "./shortcuts";
import { kbdKeys } from "./kbd";

/** A grid shape: how many panes each column holds, left to right. */
type Shape = number[];

/** Every grid that fits `n` panes: up to three columns of one or two panes each. */
function shapesFor(n: number): Shape[] {
  const out: Shape[] = [];
  const build = (left: number, shape: Shape) => {
    if (left === 0) return void out.push(shape);
    if (shape.length === MAX_COLUMNS) return;
    for (let rows = 1; rows <= Math.min(MAX_ROWS, left); rows++) build(left - rows, [...shape, rows]);
  };
  build(n, []);
  // Fewest columns last, so side-by-side layouts come first.
  return out.sort((a, b) => b.length - a.length);
}

const sameShape = (a: Shape, b: Shape) => a.length === b.length && a.every((n, i) => n === b[i]);

/** The tab's panes and sizes, to put back on cancel. */
interface Snapshot {
  columns: TermSession[][];
  weights: Map<TermSession, [number, number]>;
}

function snapshot(tab: Tab): Snapshot {
  return {
    columns: tab.columns.map((c) => [...c]),
    weights: new Map(tab.sessions.map((s) => [s, [s.colWeight, s.rowWeight]])),
  };
}

function restore(tab: Tab, snap: Snapshot) {
  tab.columns = snap.columns.map((c) => [...c]);
  for (const [s, [cw, rw]] of snap.weights) [s.colWeight, s.rowWeight] = [cw, rw];
  tab.layout();
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Lays the tab's panes out again and slides each from where it was to where it lands. */
function relayout(tab: Tab) {
  const before = new Map(tab.sessions.map((s) => [s, s.pane.getBoundingClientRect()]));
  tab.layout();
  if (reducedMotion()) return;
  for (const [s, from] of before) {
    const to = s.pane.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(from.width - to.width) < 1 && Math.abs(from.height - to.height) < 1) continue;
    // `translate` and `scale` are separate from the wiggle's `rotate`, so both run at once.
    s.pane.animate(
      [
        { translate: `${dx}px ${dy}px`, scale: `${from.width / to.width} ${from.height / to.height}`, transformOrigin: "top left" },
        { translate: "0 0", scale: "1 1", transformOrigin: "top left" },
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }
}

/**
 * ⌘L on a split tab: pick a grid for its panes, then place them by clicking
 * one pane and then another to swap them, and apply (or cancel to put
 * everything back).
 */
export class LayoutPicker {
  private tab: Tab | null = null;
  private snap: Snapshot | null = null;
  private picker: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private selected: TermSession | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    private ws: Workspace,
  ) {
    window.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  get isOpen() {
    return this.tab != null;
  }

  /** Opens the layout picker for the active tab, or does nothing if it has just one pane. */
  open() {
    const tab = this.ws.activeTab;
    if (this.tab || !tab || tab.sessions.length < 2) return;
    this.tab = tab;
    this.snap = snapshot(tab);
    if (tab.maximized) {
      tab.maximized = null;
      tab.layout();
    }
    suspendShortcuts(true);
    (document.activeElement as HTMLElement | null)?.blur();
    // Switching tabs or losing a pane underneath ends it, keeping things as they are.
    this.stopWatching = this.ws.onChange(() => {
      const t = this.tab;
      if (t && (this.ws.activeTab !== t || t.sessions.length !== this.snap!.weights.size)) this.finish(false, false);
    });
    this.showPicker();
  }

  // ---- step 1: pick a grid ----

  private showPicker() {
    const tab = this.tab!;
    this.bar?.remove();
    this.bar = null;
    this.setPlacing(false);

    const current = tab.columns.map((c) => c.length);
    const shapes = shapesFor(tab.sessions.length);
    const picker = document.createElement("div");
    picker.className = "layout-picker";
    const panel = document.createElement("div");
    panel.className = "layout-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Choose a layout");
    const head = document.createElement("div");
    head.className = "layout-head";
    head.append(
      Object.assign(document.createElement("span"), { className: "layout-title", textContent: "Layout" }),
      Object.assign(document.createElement("span"), { className: "layout-sub", textContent: `${tab.sessions.length} panes` }),
    );
    const grid = document.createElement("div");
    grid.className = "layout-options";
    const buttons = shapes.map((shape, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "layout-option";
      if (sameShape(shape, current)) b.classList.add("current");
      b.setAttribute("aria-label", shape.map((n) => (n === 1 ? "full" : "split")).join(", "));
      const thumb = document.createElement("div");
      thumb.className = "layout-thumb";
      for (const rows of shape) {
        const col = document.createElement("div");
        col.className = "layout-thumb-col";
        for (let r = 0; r < rows; r++) col.append(Object.assign(document.createElement("div"), { className: "layout-thumb-pane" }));
        thumb.append(col);
      }
      b.append(thumb);
      if (i < 9) b.append(Object.assign(document.createElement("span"), { className: "layout-num", textContent: String(i + 1) }));
      b.addEventListener("click", () => this.choose(shape));
      return b;
    });
    grid.append(...buttons);
    const foot = document.createElement("div");
    foot.className = "layout-foot";
    foot.append(hint(["←", "→"], "choose"), hint(["↩"], "pick"), hint(["Esc"], "cancel"));
    panel.append(head, grid, foot);
    picker.append(panel);
    picker.addEventListener("mousedown", (e) => {
      if (e.target === picker) this.finish(false);
    });
    this.host.append(picker);
    this.picker = picker;
    (buttons.find((b) => b.classList.contains("current")) ?? buttons[0]).focus();
  }

  /** Puts the panes, in reading order, into `shape` with even sizes, then moves on to placing them. */
  private choose(shape: Shape) {
    const tab = this.tab!;
    if (!sameShape(shape, tab.columns.map((c) => c.length))) {
      const panes = tab.sessions;
      let i = 0;
      tab.columns = shape.map((rows) => panes.slice(i, (i += rows)));
      for (const s of panes) s.colWeight = s.rowWeight = 1;
      relayout(tab);
    }
    this.picker?.remove();
    this.picker = null;
    this.startPlacing();
  }

  // ---- step 2: place the panes ----

  private startPlacing() {
    const tab = this.tab!;
    this.setPlacing(true);
    for (const s of tab.sessions) {
      const cover = document.createElement("button");
      cover.type = "button";
      cover.className = "arrange-cover";
      cover.append(Object.assign(document.createElement("span"), { className: "arrange-label", textContent: s.title }));
      cover.addEventListener("click", () => this.pick(s));
      s.pane.append(cover);
      // Out of step with each other, like icons on a home screen.
      s.pane.style.animationDelay = `${-Math.random() * 0.5}s`;
    }

    const bar = document.createElement("div");
    bar.className = "arrange-bar";
    const text = Object.assign(document.createElement("span"), { className: "arrange-text" });
    const back = button("Layouts", "arrange-secondary", () => this.showPicker());
    const cancel = button("Cancel", "arrange-secondary", () => this.finish(false));
    const apply = button("Apply", "arrange-primary", () => this.finish(true));
    apply.append(kbdKeys(["↩"]));
    bar.append(text, back, cancel, apply);
    this.host.append(bar);
    this.bar = bar;
    this.updateText();
    apply.focus();
  }

  private pick(s: TermSession) {
    const tab = this.tab!;
    if (!this.selected) this.selected = s;
    else if (this.selected === s) this.selected = null;
    else {
      const a = this.selected;
      this.selected = null;
      swap(tab, a, s);
      relayout(tab);
    }
    for (const p of tab.sessions) p.pane.classList.toggle("arrange-selected", p === this.selected);
    this.updateText();
  }

  private updateText() {
    const text = this.bar?.querySelector(".arrange-text");
    if (text) text.textContent = this.selected ? `Now click where “${this.selected.title}” should go` : "Click a pane, then another to swap them";
  }

  private setPlacing(on: boolean) {
    const tab = this.tab;
    if (!tab) return;
    tab.el.classList.toggle("arranging", on);
    if (on) return;
    this.selected = null;
    for (const s of tab.sessions) {
      s.pane.classList.remove("arrange-selected");
      s.pane.style.animationDelay = "";
      s.pane.querySelector(".arrange-cover")?.remove();
    }
  }

  // ---- ending ----

  /** Keeps the new layout (`keep`) or puts the old one back, and leaves. */
  private finish(keep: boolean, revert = true) {
    const tab = this.tab;
    if (!tab) return;
    this.stopWatching?.();
    this.stopWatching = null;
    this.setPlacing(false);
    this.picker?.remove();
    this.bar?.remove();
    this.picker = this.bar = null;
    this.tab = null;
    suspendShortcuts(false);
    if (!keep && revert) restore(tab, this.snap!);
    this.snap = null;
    if (keep) this.ws.layoutChanged(tab);
    tab.focused.focus();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.tab) return;
    const inPicker = this.picker != null;
    if (e.key === "Escape") {
      // Esc first lets go of a picked pane, then cancels.
      if (!inPicker && this.selected) this.pick(this.selected);
      else this.finish(false);
    } else if (e.key === "Enter" && !inPicker) {
      this.finish(true);
    } else if (inPicker && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const options = [...this.picker!.querySelectorAll<HTMLButtonElement>(".layout-option")];
      const at = options.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      options[(at + step + options.length) % options.length]?.focus();
    } else if (inPicker && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      this.picker!.querySelectorAll<HTMLButtonElement>(".layout-option")[Number(e.key) - 1]?.click();
    } else if (e.key === "Enter" || e.key === " " || e.key === "Tab") {
      // Let buttons work.
      return;
    }
    // Nothing reaches the terminals or the app's shortcuts meanwhile.
    e.preventDefault();
    e.stopPropagation();
  }
}

/** Trades two panes' places; each spot keeps its size. */
function swap(tab: Tab, a: TermSession, b: TermSession) {
  const pa = tab.find(a);
  const pb = tab.find(b);
  tab.columns[pa.col][pa.row] = b;
  tab.columns[pb.col][pb.row] = a;
  [a.colWeight, b.colWeight] = [b.colWeight, a.colWeight];
  [a.rowWeight, b.rowWeight] = [b.rowWeight, a.rowWeight];
}

function button(label: string, className: string, action: () => void) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", action);
  return b;
}

function hint(keys: string[], label: string) {
  const el = document.createElement("span");
  el.className = "layout-hint";
  el.append(kbdKeys(keys), label);
  return el;
}
