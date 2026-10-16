import { TermSession } from "./terminal";
import { confirmClose } from "./closeGuard";
import { gitStatus, processCwds, processNames } from "./pty";
import { touchRecent } from "./recents";
import { findMacro, runnable } from "./macros";
import { normalizePath, tildePath } from "./favorites";
import type { Loadout, LoadoutGroup, LoadoutItem, LoadoutTab } from "./loadouts";
import { GROUP_COLOR_NAMES, defaultColor, type GroupColor } from "./themes";

export type { GroupColor };
export const COLOR_NAMES = GROUP_COLOR_NAMES;
/** CSS colors for each group color; the current theme sets the variables. */
export const GROUP_COLORS = Object.fromEntries(COLOR_NAMES.map((c) => [c, `var(--group-${c})`])) as Record<GroupColor, string>;

export const MAX_COLUMNS = 3;
export const MAX_ROWS = 2;
/** Smallest a pane can be dragged to, in px. */
const MIN_PANE_WIDTH = 120;
const MIN_PANE_HEIGHT = 80;

export type Direction = "left" | "right" | "up" | "down";

/**
 * Where a dragged pane lands: an edge of a pane (splitting its column, or the
 * pane itself, in half), a gap between columns or between the panes of a
 * column (taking an even share), or a pane's place (swapping with it).
 * Indices are into the grid as it is before the drop.
 */
export type DropTarget =
  | { kind: "edge"; target: TermSession; side: Direction }
  | { kind: "col"; index: number }
  | { kind: "row"; col: number; index: number }
  | { kind: "swap"; target: TermSession };

/** A tab's grid as it would be after a drop: each column's width weight and its panes' height weights. */
export type DropPlan = { w: number; rows: { s: TermSession; w: number }[] }[];

/**
 * A sidebar tab: a grid of split panes, laid out as up to three columns of up
 * to two rows each.
 */
export class Tab {
  /** Holds the pane columns; only the active tab's is visible. */
  readonly el = document.createElement("div");
  /** Columns left to right, each a list of panes top to bottom. */
  columns: TermSession[][] = [];
  focused!: TermSession;
  customTitle?: string;
  /** Lights the tab up in this color instead of its group's or the accent. */
  color?: GroupColor;
  /** The pane filling the whole tab while the others are hidden, if any. Always the focused one. */
  maximized: TermSession | null = null;

  constructor(readonly id: number) {
    this.el.className = "panes";
  }

  /** The focused pane. */
  get session(): TermSession {
    return this.focused;
  }

  get sessions(): TermSession[] {
    return this.columns.flat();
  }

  /** Column and row of a pane. */
  find(session: TermSession): { col: number; row: number } {
    const col = this.columns.findIndex((c) => c.includes(session));
    return { col, row: col < 0 ? -1 : this.columns[col].indexOf(session) };
  }

  /** Puts pane elements into their columns. Moving a focused xterm drops focus, so it's restored. */
  layout() {
    const hadFocus = this.el.contains(document.activeElement);
    // Splitting, moving or closing panes ends maximizing, as does focusing another pane.
    if (this.maximized !== this.focused || this.sessions.length < 2) this.maximized = null;
    const columns = this.columns.map((col) => {
      // A pane moved in from another column brings that column's width; the column's first pane decides.
      for (const s of col) s.colWeight = col[0].colWeight;
      const column = document.createElement("div");
      column.className = "pane-col";
      column.style.flexGrow = String(col[0].colWeight);
      col.forEach((s, i) => {
        if (i > 0) column.append(this.divider("row", col[i - 1], s));
        s.pane.style.flexGrow = String(s.rowWeight);
        column.append(s.pane);
      });
      return column;
    });
    this.el.replaceChildren(
      ...columns.flatMap((column, i) => (i > 0 ? [this.divider("col", this.columns[i - 1], this.columns[i]), column] : [column])),
    );
    this.el.classList.toggle("split", this.sessions.length > 1);
    this.el.classList.toggle("maximized", this.maximized != null);
    for (const s of this.sessions) {
      s.pane.classList.toggle("maximized", s === this.maximized);
      s.setMaximized(s === this.maximized);
    }
    this.markFocused();
    for (const s of this.sessions) s.fit();
    if (hadFocus) this.focused.focus();
  }

  /**
   * A draggable line between two columns (`col`) or two panes of a column
   * (`row`), resizing just those two. Double-click evens them out.
   */
  private divider(axis: "col", a: TermSession[], b: TermSession[]): HTMLElement;
  private divider(axis: "row", a: TermSession, b: TermSession): HTMLElement;
  private divider(axis: "col" | "row", a: TermSession | TermSession[], b: TermSession | TermSession[]): HTMLElement {
    const line = document.createElement("div");
    line.className = `pane-divider ${axis}`;
    const horizontal = axis === "col";
    const panesA = Array.isArray(a) ? a : [a];
    const panesB = Array.isArray(b) ? b : [b];
    const weight = (s: TermSession) => (horizontal ? s.colWeight : s.rowWeight);
    const setWeight = (panes: TermSession[], w: number) => {
      for (const s of panes) {
        if (horizontal) s.colWeight = w;
        else s.rowWeight = w;
      }
      const el = horizontal ? panes[0].pane.parentElement : panes[0].pane;
      if (el) el.style.flexGrow = String(w);
    };
    const changed = () => this.el.dispatchEvent(new CustomEvent("panes-resized", { bubbles: true }));

    line.addEventListener("dblclick", () => {
      const total = weight(panesA[0]) + weight(panesB[0]);
      setWeight(panesA, total / 2);
      setWeight(panesB, total / 2);
      for (const s of this.sessions) s.fit();
      changed();
    });

    line.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const elA = horizontal ? panesA[0].pane.parentElement! : panesA[0].pane;
      const elB = horizontal ? panesB[0].pane.parentElement! : panesB[0].pane;
      const size = (el: HTMLElement) => (horizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
      const start = horizontal ? e.clientX : e.clientY;
      const sizeA = size(elA);
      const span = sizeA + size(elB);
      const total = weight(panesA[0]) + weight(panesB[0]);
      const min = Math.min(span / 2, horizontal ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT);
      let fitQueued = false;
      document.body.classList.add(horizontal ? "resizing" : "resizing-rows");
      line.classList.add("dragging");

      const onMove = (ev: MouseEvent) => {
        const delta = (horizontal ? ev.clientX : ev.clientY) - start;
        const newA = Math.min(span - min, Math.max(min, sizeA + delta));
        setWeight(panesA, (total * newA) / span);
        setWeight(panesB, (total * (span - newA)) / span);
        if (fitQueued) return;
        fitQueued = true;
        requestAnimationFrame(() => {
          fitQueued = false;
          for (const s of this.sessions) s.fit();
        });
      };
      const onUp = () => {
        document.body.classList.remove("resizing", "resizing-rows");
        line.classList.remove("dragging");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        for (const s of this.sessions) s.fit();
        this.focused.focus();
        changed();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    return line;
  }

  markFocused() {
    for (const s of this.sessions) s.pane.classList.toggle("focused", s === this.focused);
  }
}

export interface Group {
  id: number;
  name: string;
  color: GroupColor;
  collapsed: boolean;
  tabIds: number[];
}

/** A tab as saved between launches: each pane's folder, by column. */
export interface SavedTab {
  title?: string;
  color?: GroupColor;
  columns: string[][];
  /** Each column's share of the width, then each pane's share of its column's height. */
  sizes?: { cols: number[]; rows: number[][] };
  /** Column and row of the focused pane. */
  focus: [number, number];
}

export interface SavedGroup {
  name: string;
  color: GroupColor;
  collapsed: boolean;
  tabs: SavedTab[];
}

/** Everything needed to reopen the same tabs, splits and groups (shells start fresh). */
export interface SavedSession {
  /** The sidebar's top level in order: ungrouped tabs and groups, mixed. */
  items: (SavedTab | SavedGroup)[];
  /** Position of the active tab in sidebar order. */
  active: number;
}

/**
 * A slot in the sidebar: an index in a group, or with `groupId` null, an
 * index among the top-level entries (ungrouped tabs and groups).
 */
export interface Location {
  groupId: number | null;
  index: number;
}

/** A top-level sidebar entry: an ungrouped tab (by id) or a group. */
export type Entry = number | Group;

export const isGroupEntry = (e: Entry): e is Group => typeof e !== "number";

/**
 * Tabs and tab groups. The sidebar's top level mixes ungrouped tabs and
 * groups in any order. A group is removed as soon as its last tab leaves it.
 */
export class Workspace {
  readonly tabs = new Map<number, Tab>();
  /** Top-level entries in sidebar order. */
  top: Entry[] = [];
  activeId: number | null = null;
  /** Extra tabs picked with ⌘/⇧-click. The active tab is always implicitly selected. */
  readonly selection = new Set<number>();
  /** Groups picked with ⌘/⇧-click on their headers. */
  readonly groupSelection = new Set<number>();
  /** Where a ⇧-click range starts: a tab, or a group by its header. */
  private anchorId: number | null = null;
  private anchorGroupId: number | null = null;

  /** The pane whose header is being dragged, if any. */
  paneDrag: TermSession | null = null;

  private nextTabId = 1;
  private nextGroupId = 1;
  private listeners = new Set<() => void>();

  constructor(
    private termHost: HTMLElement,
    private onEmpty: () => void,
  ) {
    // Dragging a divider between panes changes the saved layout.
    termHost.addEventListener("panes-resized", () => this.emit());
  }

  /** Calls `fn` on every change; returns a function that stops it. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A tab's panes were rearranged from outside (the layout picker), so save and redraw. */
  layoutChanged(tab: Tab) {
    if (this.tabs.get(tab.id) === tab) this.emit();
  }

  private emit() {
    for (const tab of this.tabs.values()) if (tab.sessions.length > 1) for (const s of tab.sessions) s.updateHeader();
    for (const fn of this.listeners) fn();
  }

  get activeTab(): Tab | undefined {
    return this.activeId == null ? undefined : this.tabs.get(this.activeId);
  }

  title(tab: Tab): string {
    return tab.customTitle || tab.session.title;
  }

  /** Groups in sidebar order. */
  get groups(): Group[] {
    return this.top.filter(isGroupEntry);
  }

  group(id: number): Group | undefined {
    return this.groups.find((g) => g.id === id);
  }

  groupOf(tabId: number): Group | undefined {
    return this.groups.find((g) => g.tabIds.includes(tabId));
  }

  /** The list a location indexes into. Group tab lists hold only tab ids. */
  private listFor(groupId: number | null): Entry[] {
    return groupId == null ? this.top : (this.group(groupId)?.tabIds ?? this.top);
  }

  locate(tabId: number): Location {
    const group = this.groupOf(tabId);
    return { groupId: group?.id ?? null, index: this.listFor(group?.id ?? null).indexOf(tabId) };
  }

  /** Index in `top` of the entry holding this tab (the tab itself, or its group). */
  private topIndexOf(tabId: number): number {
    const group = this.groupOf(tabId);
    return this.top.indexOf(group ?? tabId);
  }

  /** Tabs in sidebar order, used for ⌘1–9 and cycling. */
  orderedTabIds(): number[] {
    return this.top.flatMap((e) => (isGroupEntry(e) ? e.tabIds : [e]));
  }

  // ---- tabs ----

  /**
   * Opens a new shell in `cwd` (home by default) and runs `commands` (from the
   * macro named `macro`, if any) in it. Defaults to right after the active
   * tab, in its group.
   */
  newTab(at?: Location, cwd?: string, commands?: string[], macro?: string): Tab {
    const tab = new Tab(this.nextTabId++);
    tab.color = defaultColor();
    this.termHost.append(tab.el);
    const session = this.createPane(tab);
    tab.columns = [[session]];
    tab.focused = session;
    tab.layout();
    this.tabs.set(tab.id, tab);

    const loc = at ?? this.afterActive();
    this.listFor(loc.groupId).splice(loc.index, 0, tab.id);
    this.activate(tab.id);
    void session.start(cwd, commands, macro);
    return tab;
  }

  private createPane(tab: Tab): TermSession {
    const session = new TermSession(tab.el);
    session.hooks = this.paneHooks(tab, session);
    return session;
  }

  private paneHooks(tab: Tab, session: TermSession): TermSession["hooks"] {
    return {
      onExit: () => this.closePane(tab.id, session),
      onClose: () => void this.requestClosePane(tab.id, session),
      onMaximize: () => {
        tab.focused = session;
        this.toggleMaximized(tab);
      },
      onDragStart: () => {
        this.paneDrag = session;
      },
      onDragEnd: () => {
        this.paneDrag = null;
      },
      onFocus: () => {
        if (tab.focused === session || !tab.sessions.includes(session)) return;
        tab.focused = session;
        if (tab.maximized) tab.layout();
        else tab.markFocused();
        this.emit();
      },
    };
  }

  // ---- panes ----

  canSplit(tab: Tab | undefined, dir: "right" | "down"): boolean {
    if (!tab) return false;
    if (dir === "right") return tab.columns.length < MAX_COLUMNS;
    return tab.columns[tab.find(tab.focused).col].length < MAX_ROWS;
  }

  /** Splits the active tab's focused pane, opening a shell in `cwd` next to it. */
  split(dir: "right" | "down", cwd?: string) {
    const tab = this.activeTab;
    if (!tab || !this.canSplit(tab, dir)) return;
    const session = this.createPane(tab);
    this.insertPane(tab, session, tab.focused, dir);
    tab.focused = session;
    tab.layout();
    session.focus();
    this.emit();
    void session.start(cwd);
  }

  /** The pane being dragged onto the active tab's panes: a pane header, or a single-pane tab from the sidebar. */
  dropSource(tabIds: readonly number[] | null): TermSession | null {
    const tab = this.activeTab;
    if (!tab) return null;
    if (this.paneDrag) return tab.sessions.includes(this.paneDrag) ? this.paneDrag : null;
    const source = tabIds?.length === 1 ? this.tabs.get(tabIds[0]) : undefined;
    // Only single-pane tabs can be dropped into another tab.
    return source && source !== tab && source.sessions.length === 1 ? source.focused : null;
  }

  /**
   * The active tab's grid after dropping `source` on `target`, or null if it
   * wouldn't fit or wouldn't change anything. The drop preview draws this,
   * and the drop applies it, so the two always agree.
   */
  planDrop(source: TermSession, target: DropTarget): DropPlan | null {
    const tab = this.activeTab;
    if (!tab) return null;
    if ((target.kind === "edge" || target.kind === "swap") && target.target === source) return null;
    const plan: DropPlan = tab.columns.map((c) => ({ w: c[0].colWeight, rows: c.map((s) => ({ s, w: s.rowWeight })) }));
    const at = (s: TermSession) => {
      const col = plan.findIndex((c) => c.rows.some((r) => r.s === s));
      return { col, row: col < 0 ? -1 : plan[col].rows.findIndex((r) => r.s === s) };
    };

    if (target.kind === "swap") {
      const a = at(source);
      const b = at(target.target);
      if (a.col < 0 || b.col < 0) return null;
      // The panes trade places; the slots keep their sizes.
      plan[a.col].rows[a.row].s = target.target;
      plan[b.col].rows[b.row].s = source;
      return plan;
    }

    // Put the source in its new spot first, then take it out of its old one,
    // so targets keep meaning what they meant on screen. A NaN weight is
    // filled in last with an even share.
    const placed = { s: source, w: NaN };
    if (target.kind === "edge") {
      const { col, row } = at(target.target);
      if (col < 0) return null;
      if (target.side === "left" || target.side === "right") {
        // Splits the target's column in half.
        plan[col].w /= 2;
        placed.w = 1;
        plan.splice(target.side === "left" ? col : col + 1, 0, { w: plan[col].w, rows: [placed] });
      } else {
        // Splits the target pane in half.
        placed.w = plan[col].rows[row].w /= 2;
        plan[col].rows.splice(target.side === "up" ? row : row + 1, 0, placed);
      }
    } else if (target.kind === "col") {
      placed.w = 1;
      plan.splice(target.index, 0, { w: NaN, rows: [placed] });
    } else {
      if (!plan[target.col]) return null;
      plan[target.col].rows.splice(target.index, 0, placed);
    }

    const result = plan
      .map((c) => ({ ...c, rows: c.rows.filter((r) => r.s !== source || r === placed) }))
      .filter((c) => c.rows.length > 0);
    const even = (ws: number[]) => (ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 1);
    for (const c of result) {
      if (Number.isNaN(c.w)) c.w = even(result.filter((o) => !Number.isNaN(o.w)).map((o) => o.w));
      if (Number.isNaN(placed.w) && c.rows.includes(placed)) placed.w = even(c.rows.filter((r) => r !== placed).map((r) => r.w));
    }

    if (result.length > MAX_COLUMNS || result.some((c) => c.rows.length > MAX_ROWS)) return null;
    // A pane dropped back where it already is changes nothing.
    const same =
      result.length === tab.columns.length &&
      result.every((c, i) => c.rows.length === tab.columns[i].length && c.rows.every((r, j) => r.s === tab.columns[i][j]));
    return same ? null : result;
  }

  /** Drops a pane of the active tab, or a single-pane tab from the sidebar, as planned for `target`. */
  drop(source: TermSession, target: DropTarget) {
    const tab = this.activeTab;
    // The header may be gone from the page before its dragend fires.
    this.paneDrag = null;
    const plan = tab && this.planDrop(source, target);
    if (!tab || !plan) return;

    if (!tab.sessions.includes(source)) {
      // Retire the source tab without killing its shell.
      const sourceTab = [...this.tabs.values()].find((t) => t.sessions.includes(source));
      if (!sourceTab) return;
      const loc = this.locate(sourceTab.id);
      this.listFor(loc.groupId).splice(loc.index, 1);
      this.tabs.delete(sourceTab.id);
      this.selection.delete(sourceTab.id);
      if (this.anchorId === sourceTab.id) this.anchorId = null;
      sourceTab.el.remove();
      this.pruneGroups();
      source.hooks = this.paneHooks(tab, source);
    }

    // Weights average 1, as a lone flex item with grow under 1 wouldn't fill its space.
    const colTotal = plan.reduce((n, c) => n + c.w, 0);
    tab.columns = plan.map((c) => {
      const rowTotal = c.rows.reduce((n, r) => n + r.w, 0);
      return c.rows.map((r) => {
        r.s.colWeight = (c.w * plan.length) / colTotal;
        r.s.rowWeight = (r.w * c.rows.length) / rowTotal;
        return r.s;
      });
    });
    tab.focused = source;
    tab.layout();
    source.focus();
    this.emit();
  }

  /**
   * Puts `session` on the `side` of `target`, splitting the space `target`
   * had (its column's width, or its own height) between the two.
   */
  private insertPane(tab: Tab, session: TermSession, target: TermSession, side: Direction) {
    const { col, row } = tab.find(target);
    if (side === "left" || side === "right") {
      const half = target.colWeight / 2;
      for (const s of tab.columns[col]) s.colWeight = half;
      session.colWeight = half;
      session.rowWeight = 1;
      tab.columns.splice(side === "left" ? col : col + 1, 0, [session]);
    } else {
      session.colWeight = target.colWeight;
      session.rowWeight = target.rowWeight /= 2;
      tab.columns[col].splice(side === "up" ? row : row + 1, 0, session);
    }
  }

  /** Moves a pane out of its split tab into a tab of its own at `at`, and switches to it. */
  movePaneToSidebar(session: TermSession, at: Location) {
    const tab = [...this.tabs.values()].find((t) => t.sessions.includes(session));
    this.paneDrag = null;
    if (!tab || tab.sessions.length < 2) return;
    this.activate(this.detachPane(tab, session, at).id);
  }

  /** Closes one pane; closing the last one closes the tab. */
  closePane(tabId: number, session: TermSession) {
    const tab = this.tabs.get(tabId);
    // Already gone, e.g. the exit of a shell we killed ourselves.
    if (!tab || !tab.sessions.includes(session)) return;
    if (tab.sessions.length === 1) return this.closeTab(tabId);
    this.removePane(tab, session);
    session.dispose();
    this.emit();
  }

  /** Closes a pane, first confirming if it's running a command. */
  async requestClosePane(tabId: number, session: TermSession) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.sessions.includes(session)) return;
    if (await confirmClose([session], tab.sessions.length === 1 ? "this tab" : "this pane")) this.closePane(tabId, session);
  }

  /** Takes a pane out of a split tab's grid, leaving its shell running. */
  private removePane(tab: Tab, session: TermSession) {
    const { col, row } = tab.find(session);
    tab.columns[col].splice(row, 1);
    // The neighbour that takes its place takes its space too, so the other panes stay put.
    if (tab.columns[col].length === 0) {
      tab.columns.splice(col, 1);
      const next = tab.columns[Math.min(col, tab.columns.length - 1)];
      for (const s of next) s.colWeight += session.colWeight;
    } else {
      tab.columns[col][Math.min(row, tab.columns[col].length - 1)].rowWeight += session.rowWeight;
    }
    if (tab.focused === session) {
      // Focus the neighbour that took its place.
      const c = Math.min(col, tab.columns.length - 1);
      tab.focused = tab.columns[c][Math.min(row, tab.columns[c].length - 1)];
    }
    tab.layout();
    if (tab.id === this.activeId) tab.focused.focus();
  }

  /** Moves a pane out of a split tab into its own tab at `at`. */
  private detachPane(tab: Tab, session: TermSession, at: Location): Tab {
    this.removePane(tab, session);
    const own = new Tab(this.nextTabId++);
    // A pane split off keeps the color of the tab it came from.
    own.color = tab.color;
    this.termHost.append(own.el);
    session.hooks = this.paneHooks(own, session);
    own.columns = [[session]];
    session.colWeight = session.rowWeight = 1;
    own.focused = session;
    own.layout();
    this.tabs.set(own.id, own);
    this.listFor(at.groupId).splice(at.index, 0, own.id);
    return own;
  }

  /** Moves the focused pane of a split tab into a new tab right after it, and switches to it. */
  movePaneToNewTab(tabId: number) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.sessions.length < 2) return;
    const loc = this.locate(tabId);
    const own = this.detachPane(tab, tab.focused, { groupId: loc.groupId, index: loc.index + 1 });
    this.activate(own.id);
  }

  /** Turns every pane of a split tab back into its own tab, in grid order, after this one. */
  unsplit(tabId: number) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.sessions.length < 2) return;
    const loc = this.locate(tabId);
    tab.sessions.slice(1).forEach((session, i) => {
      this.detachPane(tab, session, { groupId: loc.groupId, index: loc.index + 1 + i });
    });
    this.emit();
  }

  /** Makes the tab's focused pane fill the tab, or puts the grid back. */
  toggleMaximized(tab: Tab | undefined = this.activeTab) {
    if (!tab || tab.sessions.length < 2) return;
    const pane = tab.focused.pane;
    const before = pane.getBoundingClientRect();
    tab.maximized = tab.maximized ? null : tab.focused;
    tab.layout();
    tab.focused.focus();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) this.animateMaximize(tab, pane, before);
    this.emit();
  }

  /**
   * Grows (or shrinks) the pane from where it was to where layout put it, so
   * maximizing doesn't snap. Panes coming back on restore fade in underneath.
   */
  private animateMaximize(tab: Tab, pane: HTMLElement, before: DOMRect) {
    const after = pane.getBoundingClientRect();
    if (!after.width || !after.height) return;
    const timing = { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" };
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    const sx = before.width / after.width;
    const sy = before.height / after.height;
    pane.style.zIndex = "5";
    pane.style.position = "relative";
    pane
      .animate(
        [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }],
        timing,
      )
      .finished.catch(() => {})
      .finally(() => {
        pane.style.zIndex = "";
        pane.style.position = "";
      });
    if (!tab.maximized) {
      for (const s of tab.sessions) if (s.pane !== pane) s.pane.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    }
  }

  /** Brings back a maximized tab's other panes, so they can be focused. */
  private restoreGrid(tab: Tab) {
    if (!tab.maximized) return;
    tab.maximized = null;
    tab.layout();
  }

  /** Switches to the tab holding `session` and focuses that pane, un-maximizing another. */
  reveal(session: TermSession) {
    const tab = [...this.tabs.values()].find((t) => t.sessions.includes(session));
    if (!tab) return;
    if (tab.maximized && tab.maximized !== session) this.restoreGrid(tab);
    tab.focused = session;
    tab.markFocused();
    this.activate(tab.id);
  }

  /** Moves focus to the pane on the given side of the focused one. */
  focusPane(dir: Direction) {
    const tab = this.activeTab;
    if (!tab) return;
    this.restoreGrid(tab);
    let { col, row } = tab.find(tab.focused);
    if (dir === "left" || dir === "right") {
      col += dir === "left" ? -1 : 1;
      if (col < 0 || col >= tab.columns.length) return;
      row = Math.min(row, tab.columns[col].length - 1);
    } else {
      row += dir === "up" ? -1 : 1;
      if (row < 0 || row >= tab.columns[col].length) return;
    }
    tab.columns[col][row].focus();
  }

  /** Cycles focus through the active tab's panes, column by column. */
  cyclePane(delta: number) {
    const tab = this.activeTab;
    if (!tab) return;
    this.restoreGrid(tab);
    const all = tab.sessions;
    all[(all.indexOf(tab.focused) + delta + all.length) % all.length].focus();
  }

  private afterActive(): Location {
    if (this.activeId == null) return { groupId: null, index: this.top.length };
    const loc = this.locate(this.activeId);
    return { groupId: loc.groupId, index: loc.index + 1 };
  }

  closeTab(id: number) {
    this.closeTabs([id]);
  }

  /** Closes tabs, first confirming if any of their panes is running a command. */
  async requestCloseTabs(ids: number[]) {
    const tabs = ids.map((id) => this.tabs.get(id)).filter((t) => t != null);
    if (tabs.length === 0) return;
    const what = tabs.length === 1 ? "this tab" : `${tabs.length} tabs`;
    if (await confirmClose(tabs.flatMap((t) => t.sessions), what)) this.closeTabs(ids);
  }

  /** Closes groups and all their tabs, first confirming if anything in them is running a command. */
  async requestCloseGroups(groupIds: number[]) {
    const groups = groupIds.map((id) => this.group(id)).filter((g) => g != null);
    if (groups.length === 0) return;
    const tabIds = groups.flatMap((g) => [...g.tabIds]);
    const sessions = tabIds.flatMap((id) => this.tabs.get(id)?.sessions ?? []);
    const what = groups.length === 1 ? `“${groups[0].name}”` : `${groups.length} groups`;
    if (await confirmClose(sessions, what)) this.closeTabs(tabIds);
  }

  /** Every pane in every tab. */
  get allSessions(): TermSession[] {
    return [...this.tabs.values()].flatMap((t) => t.sessions);
  }

  closeTabs(ids: number[]) {
    const closing = ids.filter((id) => this.tabs.has(id));
    if (closing.length === 0) return;
    const position = this.activeId == null ? 0 : this.orderedTabIds().indexOf(this.activeId);

    for (const id of closing) {
      const loc = this.locate(id);
      this.listFor(loc.groupId).splice(loc.index, 1);
      const tab = this.tabs.get(id)!;
      for (const session of tab.sessions) session.dispose();
      tab.el.remove();
      this.tabs.delete(id);
      this.selection.delete(id);
      if (this.anchorId === id) this.anchorId = null;
    }
    this.pruneGroups();

    if (this.tabs.size === 0) {
      this.activeId = null;
      this.emit();
      return this.onEmpty();
    }
    if (this.activeId != null && !this.tabs.has(this.activeId)) {
      this.activeId = null;
      const rest = this.orderedTabIds();
      this.activate(rest[Math.min(position, rest.length - 1)]);
    } else {
      this.emit();
    }
  }

  /** Switches to a tab. Clears any multi-selection. */
  activate(id: number) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.selection.clear();
    this.groupSelection.clear();
    this.anchorId = id;
    this.anchorGroupId = null;
    if (this.activeId !== id) {
      this.activeTab?.el.classList.remove("active");
      this.activeId = id;
    }
    const group = this.groupOf(id);
    if (group) group.collapsed = false;
    tab.el.classList.add("active");
    for (const session of tab.sessions) session.fit();
    tab.focused.focus();
    this.emit();
  }

  activateIndex(n: number) {
    const order = this.orderedTabIds();
    // ⌘9 always jumps to the last tab, like browsers do.
    const id = n === 9 ? order[order.length - 1] : order[n - 1];
    if (id != null) this.activate(id);
  }

  cycle(delta: number) {
    const order = this.orderedTabIds();
    if (order.length === 0 || this.activeId == null) return;
    const i = order.indexOf(this.activeId);
    this.activate(order[(i + delta + order.length) % order.length]);
  }

  renameTab(id: number, title: string | undefined) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.customTitle = title?.trim() || undefined;
    this.emit();
  }

  /** Colors tabs, or with no color, returns them to their group's color or the accent. */
  setTabColor(ids: number[], color: GroupColor | undefined) {
    for (const id of ids) {
      const tab = this.tabs.get(id);
      if (tab) tab.color = color;
    }
    this.emit();
  }

  // ---- selection ----

  isSelected(id: number): boolean {
    return id === this.activeId || this.selection.has(id);
  }

  /** Selected tabs (including the active one) in sidebar order. */
  selectedIds(): number[] {
    return this.orderedTabIds().filter((id) => this.isSelected(id));
  }

  /** ⌘-click: add or remove a tab from the selection without switching to it. */
  toggleSelected(id: number) {
    if (!this.tabs.has(id) || id === this.activeId) return;
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.anchorId = id;
    this.anchorGroupId = null;
    this.emit();
  }

  /** ⇧-click: select every tab between the anchor and this one. */
  selectRange(id: number) {
    const order = this.orderedTabIds();
    const anchorGroup = this.anchorGroupId == null ? undefined : this.group(this.anchorGroupId);
    const from = order.indexOf(anchorGroup?.tabIds[0] ?? this.anchorId ?? this.activeId ?? id);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return;
    this.selection.clear();
    for (const tabId of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      if (tabId !== this.activeId) this.selection.add(tabId);
    }
    this.emit();
  }

  isGroupSelected(id: number): boolean {
    return this.groupSelection.has(id);
  }

  /** ⌘-click on a group header: add or remove the group from the selection. */
  toggleGroupSelected(id: number) {
    if (!this.group(id)) return;
    if (this.groupSelection.has(id)) this.groupSelection.delete(id);
    else this.groupSelection.add(id);
    this.anchorGroupId = id;
    this.anchorId = null;
    this.emit();
  }

  /**
   * ⇧-click on a group header: select every top-level entry between the
   * anchor and this group, groups and ungrouped tabs alike.
   */
  selectGroupRange(id: number) {
    const group = this.group(id);
    if (!group) return;
    const anchor = this.anchorGroupId != null ? this.group(this.anchorGroupId) : undefined;
    const anchorTab = this.anchorId ?? this.activeId;
    const from = anchor ? this.top.indexOf(anchor) : anchorTab != null ? this.topIndexOf(anchorTab) : -1;
    const to = this.top.indexOf(group);
    const lo = Math.min(from < 0 ? to : from, to);
    const hi = Math.max(from < 0 ? to : from, to);
    this.selection.clear();
    this.groupSelection.clear();
    for (const e of this.top.slice(lo, hi + 1)) {
      if (isGroupEntry(e)) this.groupSelection.add(e.id);
      else if (e !== this.activeId) this.selection.add(e);
    }
    this.emit();
  }

  /** Makes `id` the only selected group, dropping any tab selection. */
  selectOnlyGroup(id: number) {
    this.selection.clear();
    this.groupSelection.clear();
    this.groupSelection.add(id);
    this.anchorGroupId = id;
    this.anchorId = null;
    this.emit();
  }

  clearSelection() {
    if (this.selection.size === 0 && this.groupSelection.size === 0) return;
    this.selection.clear();
    this.groupSelection.clear();
    this.emit();
  }

  // ---- moving ----

  moveTab(tabId: number, dest: Location) {
    this.moveTabs([tabId], dest);
  }

  /** Moves tabs (kept in the given order) to `dest`, an index in the list as it is before the move. */
  moveTabs(tabIds: number[], dest: Location) {
    const destList = this.listFor(dest.groupId);
    // Tabs being moved out from in front of the drop point shift it left.
    const index = dest.index - destList.slice(0, dest.index).filter((e) => typeof e === "number" && tabIds.includes(e)).length;
    for (const id of tabIds) {
      const from = this.locate(id);
      this.listFor(from.groupId).splice(from.index, 1);
    }
    destList.splice(index, 0, ...tabIds);
    this.pruneGroups();
    this.emit();
  }

  /**
   * Moves groups (kept in sidebar order) to `index` among the top-level
   * entries, counted as they are before the move.
   */
  moveGroups(groupIds: number[], index: number) {
    const moving = this.groups.filter((g) => groupIds.includes(g.id));
    const at = index - this.top.slice(0, index).filter((e) => isGroupEntry(e) && moving.includes(e)).length;
    this.top = this.top.filter((e) => !(isGroupEntry(e) && moving.includes(e)));
    this.top.splice(at, 0, ...moving);
    this.emit();
  }

  /** Takes tabs out of their groups, placing them right after the group each came from. */
  removeFromGroups(tabIds: number[]) {
    for (const id of tabIds) {
      const group = this.groupOf(id);
      if (!group) continue;
      group.tabIds.splice(group.tabIds.indexOf(id), 1);
      const after = this.top.indexOf(group) + 1;
      // Later tabs land after earlier ones, keeping their order.
      let at = after;
      while (at < this.top.length && typeof this.top[at] === "number" && tabIds.includes(this.top[at] as number)) at++;
      this.top.splice(at, 0, id);
    }
    this.pruneGroups();
    this.emit();
  }

  // ---- groups ----

  /**
   * Creates a group from existing tabs (where the first of them sits), or with
   * a fresh shell after the active tab's entry if none are given.
   */
  createGroup(tabIds: number[] = []): Group {
    const id = this.nextGroupId++;
    const group: Group = {
      id,
      name: `Group ${id}`,
      color: defaultColor(),
      collapsed: false,
      tabIds: [],
    };
    const first = tabIds[0] ?? this.activeId;
    const at = first == null ? this.top.length : this.topIndexOf(first) + (tabIds.length > 0 ? 0 : 1);
    this.top.splice(Math.max(0, at), 0, group);
    if (tabIds.length === 0) {
      this.newTab({ groupId: id, index: 0 });
    } else {
      for (const tabId of tabIds) {
        const loc = this.locate(tabId);
        this.listFor(loc.groupId).splice(loc.index, 1);
        group.tabIds.push(tabId);
      }
      this.selection.clear();
    }
    this.pruneGroups();
    this.emit();
    return group;
  }

  renameGroup(id: number, name: string) {
    const group = this.group(id);
    if (!group || !name.trim()) return;
    group.name = name.trim();
    this.emit();
  }

  setGroupColor(id: number, color: GroupColor) {
    const group = this.group(id);
    if (!group) return;
    group.color = color;
    this.emit();
  }

  toggleCollapsed(id: number) {
    const group = this.group(id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.emit();
  }

  /** Dissolves the group, leaving its tabs ungrouped where it was. */
  ungroup(id: number) {
    const group = this.group(id);
    if (!group) return;
    this.top.splice(this.top.indexOf(group), 1, ...group.tabIds);
    group.tabIds = [];
    this.groupSelection.delete(id);
    this.emit();
  }

  private pruneGroups() {
    this.top = this.top.filter((e) => !isGroupEntry(e) || e.tabIds.length > 0);
    for (const id of this.groupSelection) if (!this.group(id)) this.groupSelection.delete(id);
  }

  // ---- saving and restoring ----

  snapshot(): SavedSession {
    const saveTab = (id: number): SavedTab => {
      const tab = this.tabs.get(id)!;
      const { col, row } = tab.find(tab.focused);
      return {
        title: tab.customTitle,
        color: tab.color,
        columns: tab.columns.map((c) => c.map((s) => s.cwd || s.startCwd)),
        sizes: { cols: tab.columns.map((c) => c[0].colWeight), rows: tab.columns.map((c) => c.map((s) => s.rowWeight)) },
        focus: [col, row],
      };
    };
    return {
      items: this.top.map((e) =>
        isGroupEntry(e) ? { name: e.name, color: e.color, collapsed: e.collapsed, tabs: e.tabIds.map(saveTab) } : saveTab(e),
      ),
      active: this.activeId == null ? 0 : this.orderedTabIds().indexOf(this.activeId),
    };
  }

  /**
   * Builds a tab from a grid of pane starts and appends it to `list`, without
   * activating it. Returns its id, or null if the grid was empty.
   */
  private openGrid(
    panes: { cwd?: string; commands?: string[]; macro?: string }[][],
    list: Entry[],
    opts: { focus?: [number, number]; title?: string; color?: GroupColor; sizes?: SavedTab["sizes"] } = {},
  ): number | null {
    const columns = panes.filter((c) => c.length > 0).slice(0, MAX_COLUMNS).map((c) => c.slice(0, MAX_ROWS));
    if (columns.length === 0) return null;
    const tab = new Tab(this.nextTabId++);
    this.termHost.append(tab.el);
    tab.columns = columns.map((c) => c.map(() => this.createPane(tab)));
    const [col, row] = opts.focus ?? [0, 0];
    tab.focused = tab.columns[col]?.[row] ?? tab.columns[0][0];
    tab.customTitle = opts.title || undefined;
    tab.color = opts.color && COLOR_NAMES.includes(opts.color) ? opts.color : undefined;
    const weight = (w: unknown) => (typeof w === "number" && w > 0 && isFinite(w) ? w : 1);
    tab.columns.forEach((c, i) =>
      c.forEach((s, j) => {
        s.colWeight = weight(opts.sizes?.cols?.[i]);
        s.rowWeight = weight(opts.sizes?.rows?.[i]?.[j]);
      }),
    );
    tab.layout();
    this.tabs.set(tab.id, tab);
    list.push(tab.id);
    columns.forEach((c, i) => c.forEach((p, j) => void tab.columns[i][j].start(p.cwd || undefined, p.commands, p.macro)));
    return tab.id;
  }

  /** A new group, not yet in the sidebar. */
  private makeGroup(g: { name: string; color: GroupColor; collapsed?: boolean }): Group {
    return {
      id: this.nextGroupId++,
      name: g.name || "Group",
      color: COLOR_NAMES.includes(g.color) ? g.color : COLOR_NAMES[0],
      collapsed: !!g.collapsed,
      tabIds: [],
    };
  }

  /** Reopens a saved session's tabs, each pane in a new shell in its old folder. False if it had no tabs. */
  restore(saved: SavedSession): boolean {
    const openTab = (t: SavedTab, list: Entry[]) =>
      this.openGrid(
        t.columns.map((c) => c.map((cwd) => ({ cwd }))),
        list,
        { focus: t.focus, title: t.title, color: t.color, sizes: t.sizes },
      );
    for (const item of saved.items) {
      if (!("tabs" in item)) {
        openTab(item, this.top);
        continue;
      }
      const group = this.makeGroup(item);
      this.top.push(group);
      for (const t of item.tabs) openTab(t, group.tabIds);
    }
    this.pruneGroups();
    const order = this.orderedTabIds();
    if (order.length === 0) return false;
    // Opening the active tab would expand its group; keep it as it was.
    const active = order[Math.min(Math.max(saved.active, 0), order.length - 1)];
    const group = this.groupOf(active);
    const collapsed = group?.collapsed;
    this.activate(active);
    if (group && collapsed) group.collapsed = true;
    this.emit();
    return true;
  }

  // ---- loadouts ----

  /**
   * The picked tabs and groups as a loadout, in sidebar order: each pane's
   * current folder and the macro it was started with. A picked group brings
   * all its tabs; picked tabs in an unpicked group bring just that much of it.
   */
  captureLoadout(name: string, tabIds: ReadonlySet<number>, groupIds: ReadonlySet<number>): Loadout {
    const saveTab = (id: number): LoadoutTab => {
      const tab = this.tabs.get(id)!;
      return {
        title: tab.customTitle,
        color: tab.color,
        columns: tab.columns.map((c) => c.map((s) => ({ dir: tildePath(s.cwd || s.startCwd), macro: s.macro }))),
      };
    };
    const items: LoadoutItem[] = [];
    for (const e of this.top) {
      if (!isGroupEntry(e)) {
        if (tabIds.has(e)) items.push(saveTab(e));
        continue;
      }
      const ids = groupIds.has(e.id) ? e.tabIds : e.tabIds.filter((id) => tabIds.has(id));
      if (ids.length > 0) items.push({ name: e.name, color: e.color, collapsed: e.collapsed, tabs: ids.map(saveTab) });
    }
    return { name, items };
  }

  /** Every tab and group, as a loadout. */
  captureAll(name: string): Loadout {
    return this.captureLoadout(name, new Set(this.tabs.keys()), new Set(this.groups.map((g) => g.id)));
  }

  /**
   * Opens a loadout's tabs and groups, in its order, after everything already
   * open (even if groups of the same name are open). Switches to the first new tab.
   */
  deployLoadout(loadout: Loadout) {
    const grid = (t: LoadoutTab) =>
      t.columns.map((c) =>
        c.map((p) => {
          const macro = p.macro ? findMacro(p.macro) : undefined;
          return { cwd: normalizePath(p.dir) || undefined, commands: macro ? runnable(macro) : [], macro: macro?.name };
        }),
      );
    let first: number | null = null;
    for (const item of loadout.items) {
      if (!("tabs" in item)) {
        const id = this.openGrid(grid(item), this.top, { title: item.title, color: item.color ?? defaultColor() });
        first ??= id;
        continue;
      }
      const group = this.makeGroup(item as LoadoutGroup);
      this.top.push(group);
      for (const t of item.tabs) this.openGrid(grid(t), group.tabIds, { title: t.title, color: t.color });
      first ??= group.tabIds[0] ?? null;
    }
    this.pruneGroups();
    if (first != null) this.activate(first);
    this.emit();
  }

  // ---- misc ----

  fitAll() {
    for (const tab of this.tabs.values()) for (const session of tab.sessions) session.fit();
  }

  /**
   * Keeps default tab titles in sync with each shell's foreground process, and
   * records the directories shells visit as recents.
   */
  startTitlePolling(intervalMs = 1000) {
    setInterval(async () => {
      const byPty = new Map<number, TermSession>();
      for (const tab of this.tabs.values()) {
        for (const session of tab.sessions) if (session.ptyId != null) byPty.set(session.ptyId, session);
      }
      if (byPty.size === 0) return;
      const ids = [...byPty.keys()];
      const none = () => ({}) as Record<string, string>;
      const [names, cwds] = await Promise.all([processNames(ids).catch(none), processCwds(ids).catch(none)]);
      let changed = false;
      for (const [ptyId, session] of byPty) {
        const name = names[ptyId] ?? "";
        if (name && name !== session.procName) {
          session.procName = name;
          changed = true;
        }
        const cwd = cwds[ptyId] ?? "";
        if (cwd && cwd !== session.cwd) {
          session.setCwd(cwd);
          touchRecent(cwd);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, intervalMs);
  }

  /** Keeps the git status bar of each pane in the active tab up to date. */
  startGitPolling(intervalMs = 2000) {
    let busy = false;
    const poll = async () => {
      const sessions = this.activeTab?.sessions ?? [];
      if (busy || sessions.length === 0) return;
      busy = true;
      try {
        const dirs = [...new Set(sessions.map((s) => s.cwd || s.startCwd).filter(Boolean))];
        const status = await gitStatus(dirs).catch(() => null);
        if (!status) return;
        for (const s of sessions) s.setGit(status[s.cwd || s.startCwd] ?? null);
      } finally {
        busy = false;
      }
    };
    setInterval(() => void poll(), intervalMs);
    // Switching tabs or changing directory shouldn't wait out the interval.
    let last = "";
    this.onChange(() => {
      const tab = this.activeTab;
      const key = tab ? `${tab.id}\0${tab.sessions.map((s) => s.cwd || s.startCwd).join("\0")}` : "";
      if (key !== last) {
        last = key;
        void poll();
      }
    });
  }
}
