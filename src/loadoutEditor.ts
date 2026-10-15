import { invoke } from "@tauri-apps/api/core";
import { normalizePath, tildePath } from "./favorites";
import { loadMacros, runnable } from "./macros";
import { attachPathSuggest } from "./pathsuggest";
import { showMenu, type MenuItem } from "./menu";
import { el } from "./page";
import { AtSign, ChevronDown, Columns2, Folder, FolderOpen, Plus, Rows2, Trash2, X, icon } from "./icons";
import { GROUP_COLOR_NAMES, type GroupColor } from "./themes";
import { GROUP_COLORS, MAX_COLUMNS, MAX_ROWS } from "./workspace";
import {
  cleanLoadoutName,
  describeLoadout,
  isLoadoutGroup,
  loadLoadouts,
  saveLoadouts,
  tabCount,
  type Loadout,
  type LoadoutGroup,
  type LoadoutItem,
  type LoadoutPane,
  type LoadoutTab,
} from "./loadouts";

/** Where a dragged row would land: an index in a group's tabs, or (group null) among the top-level items. */
interface Spot {
  group: LoadoutGroup | null;
  index: number;
  marker: HTMLElement;
  cls: "drop-before" | "drop-after" | "drop-into";
}

const newTab = (dir = "~"): LoadoutTab => ({ columns: [[{ dir }]] });

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/**
 * Settings › Loadouts. Each loadout opens into a miniature of the app: on the
 * left, its sidebar exactly as it will appear (drag to reorder, right-click
 * for more); on the right, the picked tab's panes, each showing the folder it
 * starts in and the macro it runs. Edits save as they're made.
 */
export class LoadoutEditor {
  private loadouts: Loadout[] = loadLoadouts();
  private list = el("div", "lo-list");
  /** The loadout shown open; the rest fold to one line. */
  private open: Loadout | null = null;
  /** The tab shown in each loadout's window, and the pane in it that splits act on. */
  private picked = new WeakMap<Loadout, LoadoutTab>();
  private focused = new WeakMap<LoadoutTab, LoadoutPane>();
  private drag: LoadoutItem | null = null;
  /** Bumped per folder check so a slow one can't flag newer edits. */
  private seq = 0;

  constructor(
    private onOpen: (name: string) => void,
    /** Name of a loadout to open with its name selected, e.g. one just saved. */
    private focusName?: string,
  ) {
    this.open = this.loadouts.find((l) => l.name === focusName) ?? this.loadouts[0] ?? null;
  }

  /** Builds the section; returns it and the element to focus. */
  build(): { section: HTMLElement; focus: HTMLElement | null } {
    const section = el("section", "page-section");
    const title = el("h2", "page-section-title", "Loadouts");
    const intro = el("p", "page-intro");
    intro.append(
      "Open a set of tabs and groups in one go, from the Loadouts menu or by typing ",
      el("code", "", "#name"),
      " in Teleport. To make one from what's open, select groups or tabs in the sidebar, right-click, and choose Save as Loadout.",
    );
    const add = el("button", "macro-add");
    add.append(icon(Plus), "New loadout");
    add.addEventListener("click", () => {
      const loadout: Loadout = { name: "", items: [newTab()] };
      this.loadouts.push(loadout);
      this.open = loadout;
      this.save();
      this.render();
      this.nameInput(loadout)?.focus();
    });
    section.append(title, intro, this.list, add);
    this.render();

    let focus: HTMLElement | null = null;
    if (this.focusName != null && this.open?.name === this.focusName) {
      const input = this.nameInput(this.open);
      if (input) {
        queueMicrotask(() => {
          input.scrollIntoView({ block: "center" });
          input.select();
        });
        focus = input;
      }
    }
    return { section, focus: focus ?? add };
  }

  private nameInput(loadout: Loadout) {
    return this.list.children[this.loadouts.indexOf(loadout)]?.querySelector<HTMLInputElement>(".lo-name");
  }

  private save() {
    saveLoadouts(this.loadouts);
  }

  /** Saves and redraws, for edits that change structure. */
  private commit() {
    this.save();
    this.render();
  }

  private render() {
    const cards = this.loadouts.map((l, i) => this.card(l, i));
    if (cards.length === 0) {
      cards.push(el("p", "macro-empty", "No loadouts yet. Save some from the sidebar, or start an empty one below."));
    }
    this.list.replaceChildren(...cards);
    void this.checkFolders();
  }

  // ---- a loadout ----

  private card(loadout: Loadout, i: number) {
    const isOpen = loadout === this.open;
    const card = el("div", `lo-card${isOpen ? " open" : ""}`);

    const head = el("div", "lo-head");
    const hash = el("span", "lo-hash", "#");
    const name = el("input", "lo-name");
    name.value = loadout.name;
    name.placeholder = "name";
    name.spellcheck = false;
    name.autocomplete = "off";
    name.setAttribute("aria-label", "Loadout name");
    // Sized to its text so the summary sits right after it.
    const wrap = el("span", "lo-name-wrap");
    const fit = () => (wrap.dataset.value = name.value || name.placeholder);
    wrap.append(name);
    fit();
    name.addEventListener("input", () => {
      loadout.name = cleanLoadoutName(name.value);
      fit();
      this.save();
      this.updateNote(loadout, card);
    });
    name.addEventListener("blur", () => {
      name.value = loadout.name;
      fit();
    });
    name.addEventListener("focus", () => {
      if (this.open === loadout) return;
      this.open = loadout;
      this.render();
      this.nameInput(loadout)?.focus();
    });

    const summary = el("span", "lo-summary", describeLoadout(loadout));
    const openButton = el("button", "lo-open", "Open");
    openButton.title = "Open these tabs now";
    openButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (loadout.name && tabCount(loadout) > 0) this.onOpen(loadout.name);
    });
    const remove = el("button", "lo-icon-button lo-delete");
    remove.append(icon(Trash2, 14));
    remove.title = "Delete loadout";
    remove.setAttribute("aria-label", `Delete #${loadout.name || "loadout"}`);
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      this.loadouts.splice(i, 1);
      if (this.open === loadout) this.open = this.loadouts[Math.min(i, this.loadouts.length - 1)] ?? null;
      this.commit();
    });
    head.append(hash, wrap, summary, remove, openButton);
    head.addEventListener("click", (e) => {
      if (isOpen || (e.target as Element).closest("button, input")) return;
      this.open = loadout;
      this.render();
    });

    card.append(head, el("p", "lo-note"));
    if (isOpen) card.append(this.desk(loadout));
    this.updateNote(loadout, card);
    return card;
  }

  /** Flags names Teleport and the menu can't use. */
  private updateNote(loadout: Loadout, card: HTMLElement) {
    const note = card.querySelector(".lo-note")!;
    let msg = "";
    if (!loadout.name) msg = "Name this loadout to open it from the menu or Teleport.";
    else if (this.loadouts.find((l) => l.name === loadout.name) !== loadout)
      msg = `Another loadout above is already #${loadout.name}. Rename this one to use it.`;
    else if (tabCount(loadout) === 0) msg = "Add a tab so there's something to open.";
    note.textContent = msg;
  }

  /** The miniature app: sidebar on the left, the picked tab's window on the right. */
  private desk(loadout: Loadout) {
    const tabs = loadout.items.flatMap((item) => (isLoadoutGroup(item) ? item.tabs : [item]));
    let picked = this.picked.get(loadout);
    if (!picked || !tabs.includes(picked)) {
      picked = tabs[0];
      if (picked) this.picked.set(loadout, picked);
    }
    const desk = el("div", "lo-desk");
    desk.append(this.sidebar(loadout, picked), picked ? this.window(loadout, picked) : this.emptyWindow(loadout));
    return desk;
  }

  // ---- the sidebar ----

  private sidebar(loadout: Loadout, picked: LoadoutTab | undefined) {
    const side = el("div", "lo-side");
    const list = el("div", "lo-tree");
    for (const item of loadout.items) {
      list.append(isLoadoutGroup(item) ? this.groupBlock(loadout, item, picked) : this.tabRow(loadout, item, null, picked));
    }
    // Empty space at the bottom drops at the end.
    list.addEventListener("dragover", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      this.clearMarkers(side);
      list.classList.add("drop-end");
    });
    list.addEventListener("dragleave", (e) => {
      if (e.target === list) list.classList.remove("drop-end");
    });
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      this.dropAt(loadout, { group: null, index: loadout.items.length, marker: list, cls: "drop-after" });
    });

    const addTab = el("button", "new-tab-row lo-new");
    addTab.append(icon(Plus, 13), el("span", "tab-title", "New tab"));
    addTab.addEventListener("click", () => {
      const tab = newTab(this.lastDir(loadout));
      loadout.items.push(tab);
      this.picked.set(loadout, tab);
      this.commit();
    });
    const addGroup = el("button", "new-tab-row lo-new");
    addGroup.append(icon(FolderOpen, 13), el("span", "tab-title", "New group"));
    addGroup.addEventListener("click", () => {
      const used = new Set(loadout.items.filter(isLoadoutGroup).map((g) => g.color));
      const color = GROUP_COLOR_NAMES.find((c) => !used.has(c)) ?? GROUP_COLOR_NAMES[0];
      const tab = newTab(this.lastDir(loadout));
      const group: LoadoutGroup = { name: "Group", color, tabs: [tab] };
      loadout.items.push(group);
      this.picked.set(loadout, tab);
      this.commit();
      this.rename(loadout, group);
    });
    side.append(list, addTab, addGroup);
    return side;
  }

  /** Folder of the last pane, so new tabs start somewhere useful. */
  private lastDir(loadout: Loadout) {
    const tabs = loadout.items.flatMap((item) => (isLoadoutGroup(item) ? item.tabs : [item]));
    return tabs[tabs.length - 1]?.columns[0][0].dir || "~";
  }

  private tabTitle(tab: LoadoutTab) {
    return tab.title || basename(tab.columns[0][0].dir || "~");
  }

  private tabRow(loadout: Loadout, tab: LoadoutTab, group: LoadoutGroup | null, picked: LoadoutTab | undefined) {
    const row = el("div", "tab");
    row.draggable = true;
    if (tab === picked) row.classList.add("active");
    if (!group && tab.color) {
      row.classList.add("colored");
      row.style.setProperty("--group-color", GROUP_COLORS[tab.color]);
    }
    const glyph = el("span", "tab-layout");
    const focus = this.focused.get(tab);
    for (const column of tab.columns) {
      const col = el("span", "tab-layout-col");
      for (const pane of column) {
        col.append(el("span", `tab-layout-pane${pane === focus || (!focus && pane === tab.columns[0][0]) ? " focused" : ""}`));
      }
      glyph.append(col);
    }
    const title = el("span", "tab-title", this.tabTitle(tab));
    if (!tab.title) title.classList.add("lo-untitled");
    const close = el("button", "tab-close");
    close.append(icon(X, 13));
    close.title = "Remove tab";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeTab(loadout, tab);
    });
    row.append(glyph, title, close);

    row.addEventListener("click", () => {
      this.picked.set(loadout, tab);
      this.render();
    });
    row.addEventListener("dblclick", () => this.rename(loadout, tab));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, this.tabMenu(loadout, tab, group));
    });
    this.makeDraggable(loadout, row, tab, (e) => {
      const list = group ? group.tabs : loadout.items;
      const after = this.lowerHalf(row, e);
      // Groups dragged over a grouped tab land beside its whole group.
      if (isLoadoutGroup(this.drag!) && group) {
        const block = row.closest<HTMLElement>(".group")!;
        return this.besideGroup(loadout, group, block, this.lowerHalf(block, e));
      }
      return { group, index: list.indexOf(tab) + (after ? 1 : 0), marker: row, cls: after ? "drop-after" : "drop-before" };
    });
    return row;
  }

  private groupBlock(loadout: Loadout, group: LoadoutGroup, picked: LoadoutTab | undefined) {
    const block = el("div", `group${group.collapsed ? " collapsed" : ""}`);
    block.style.setProperty("--group-color", GROUP_COLORS[group.color]);
    const header = el("div", "group-header");
    header.draggable = true;
    header.title = group.collapsed ? "Opens collapsed" : "";
    header.append(
      icon(ChevronDown, 12, "group-chevron"),
      icon(group.collapsed ? Folder : FolderOpen, 14, "group-icon"),
      el("span", "group-name", group.name || "Group"),
      el("span", "group-count", String(group.tabs.length)),
    );
    header.addEventListener("click", () => {
      group.collapsed = !group.collapsed;
      this.commit();
    });
    header.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.rename(loadout, group);
    });
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, this.groupMenu(loadout, group));
    });
    this.makeDraggable(loadout, header, group, (e) => {
      if (isLoadoutGroup(this.drag!)) return this.besideGroup(loadout, group, block, this.lowerHalf(block, e));
      const r = header.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.3) return this.besideGroup(loadout, group, block, false);
      if (group.collapsed && y > 0.7) return this.besideGroup(loadout, group, block, true);
      return { group, index: group.tabs.length, marker: header, cls: "drop-into" };
    });
    block.append(header);
    if (!group.collapsed) {
      const body = el("div", "group-tabs");
      for (const tab of group.tabs) body.append(this.tabRow(loadout, tab, group, picked));
      block.append(body);
    }
    return block;
  }

  /** Renames a tab or group in place, in its sidebar row. */
  private rename(loadout: Loadout, item: LoadoutItem) {
    const card = this.list.children[this.loadouts.indexOf(loadout)];
    const rows = [...(card?.querySelectorAll<HTMLElement>(".lo-tree .tab, .lo-tree .group-header") ?? [])];
    const order = loadout.items.flatMap((i) => (isLoadoutGroup(i) ? [i, ...(i.collapsed ? [] : i.tabs)] : [i]));
    const row = rows[order.indexOf(item)];
    const label = row?.querySelector<HTMLElement>(".tab-title, .group-name");
    if (!row || !label) return;
    const input = el("input", "rename");
    input.value = isLoadoutGroup(item) ? item.name : (item.title ?? "");
    input.placeholder = isLoadoutGroup(item) ? "Group" : this.tabTitle(item);
    input.spellcheck = false;
    row.draggable = false;
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      if (keep) {
        const value = input.value.trim();
        if (isLoadoutGroup(item)) item.name = value || item.name || "Group";
        else item.title = value || undefined;
      }
      this.commit();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      finish(e.key === "Enter");
    });
    input.addEventListener("blur", () => finish(true));
    for (const type of ["click", "dblclick", "mousedown"]) input.addEventListener(type, (e) => e.stopPropagation());
  }

  private swatches(current: GroupColor | undefined, pick: (c: GroupColor) => void): MenuItem {
    return {
      swatches: GROUP_COLOR_NAMES.map((c) => ({ color: GROUP_COLORS[c], selected: c === current, action: () => pick(c) })),
    };
  }

  private tabMenu(loadout: Loadout, tab: LoadoutTab, group: LoadoutGroup | null): MenuItem[] {
    const groups = loadout.items.filter(isLoadoutGroup).filter((g) => g !== group);
    const color: MenuItem[] = group
      ? []
      : [
          this.swatches(tab.color, (c) => {
            tab.color = c;
            this.commit();
          }),
          ...(tab.color
            ? [
                {
                  label: "Clear Color",
                  action: () => {
                    tab.color = undefined;
                    this.commit();
                  },
                },
              ]
            : []),
          { separator: true },
        ];
    return [
      { label: "Rename Tab", action: () => this.rename(loadout, tab) },
      {
        label: "Duplicate Tab",
        action: () => {
          const list = group ? group.tabs : loadout.items;
          const copy: LoadoutTab = structuredClone(tab);
          list.splice(list.indexOf(tab) + 1, 0, copy);
          this.picked.set(loadout, copy);
          this.commit();
        },
      },
      { separator: true },
      ...color,
      { heading: "Move to group" },
      ...groups.map((g) => ({
        label: g.name || "Group",
        color: GROUP_COLORS[g.color],
        action: () => this.moveTab(loadout, tab, g, g.tabs.length),
      })),
      {
        label: "New Group",
        action: () => {
          const group: LoadoutGroup = { name: "Group", color: GROUP_COLOR_NAMES[0], tabs: [] };
          loadout.items.splice(this.topIndex(loadout, tab), 0, group);
          this.moveTab(loadout, tab, group, 0);
          this.rename(loadout, group);
        },
      },
      ...(group
        ? [{ label: "Remove from Group", action: () => this.moveTab(loadout, tab, null, loadout.items.indexOf(group) + 1) }]
        : []),
      { separator: true },
      { label: "Remove Tab", danger: true, action: () => this.removeTab(loadout, tab) },
    ];
  }

  private groupMenu(loadout: Loadout, group: LoadoutGroup): MenuItem[] {
    return [
      { label: "Rename Group", action: () => this.rename(loadout, group) },
      this.swatches(group.color, (c) => {
        group.color = c;
        this.commit();
      }),
      { separator: true },
      {
        label: "New Tab in Group",
        action: () => {
          const tab = newTab(group.tabs[group.tabs.length - 1]?.columns[0][0].dir);
          group.tabs.push(tab);
          group.collapsed = false;
          this.picked.set(loadout, tab);
          this.commit();
        },
      },
      {
        label: group.collapsed ? "Open Expanded" : "Open Collapsed",
        action: () => {
          group.collapsed = !group.collapsed;
          this.commit();
        },
      },
      {
        label: "Ungroup",
        action: () => {
          loadout.items.splice(loadout.items.indexOf(group), 1, ...group.tabs);
          this.commit();
        },
      },
      { separator: true },
      {
        label: "Remove Group",
        danger: true,
        action: () => {
          loadout.items.splice(loadout.items.indexOf(group), 1);
          this.commit();
        },
      },
    ];
  }

  // ---- moving ----

  /** Index in the top-level items of the entry holding `tab`: the tab itself, or its group. */
  private topIndex(loadout: Loadout, tab: LoadoutTab) {
    return loadout.items.findIndex((i) => i === tab || (isLoadoutGroup(i) && i.tabs.includes(tab)));
  }

  private groupOf(loadout: Loadout, tab: LoadoutTab) {
    return loadout.items.filter(isLoadoutGroup).find((g) => g.tabs.includes(tab)) ?? null;
  }

  /** Moves a tab to `index` in a group (or the top level), counted before the move. Empty groups go away. */
  private moveTab(loadout: Loadout, tab: LoadoutTab, group: LoadoutGroup | null, index: number) {
    const dest: LoadoutItem[] = group ? group.tabs : loadout.items;
    const from = this.groupOf(loadout, tab);
    const src: LoadoutItem[] = from ? from.tabs : loadout.items;
    const at = src.indexOf(tab);
    src.splice(at, 1);
    dest.splice(src === dest && at < index ? index - 1 : index, 0, tab);
    loadout.items = loadout.items.filter((i) => !isLoadoutGroup(i) || i.tabs.length > 0);
    this.commit();
  }

  private moveGroup(loadout: Loadout, group: LoadoutGroup, index: number) {
    const at = loadout.items.indexOf(group);
    loadout.items.splice(at, 1);
    loadout.items.splice(at < index ? index - 1 : index, 0, group);
    this.commit();
  }

  private removeTab(loadout: Loadout, tab: LoadoutTab) {
    const group = this.groupOf(loadout, tab);
    const list: LoadoutItem[] = group ? group.tabs : loadout.items;
    list.splice(list.indexOf(tab), 1);
    loadout.items = loadout.items.filter((i) => !isLoadoutGroup(i) || i.tabs.length > 0);
    this.commit();
  }

  // ---- dragging ----

  private makeDraggable(loadout: Loadout, row: HTMLElement, item: LoadoutItem, spot: (e: DragEvent) => Spot) {
    const side = () => row.closest<HTMLElement>(".lo-side")!;
    row.addEventListener("dragstart", (e) => {
      this.drag = item;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", "loadout-item");
      (isLoadoutGroup(item) ? row.parentElement! : row).classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      this.drag = null;
      this.render();
    });
    row.addEventListener("dragover", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      e.stopPropagation();
      this.clearMarkers(side());
      const s = spot(e);
      // Groups only sit at the top level.
      if (!(isLoadoutGroup(this.drag) && s.group)) s.marker.classList.add(s.cls);
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropAt(loadout, spot(e));
    });
  }

  private besideGroup(loadout: Loadout, group: LoadoutGroup, block: HTMLElement, after: boolean): Spot {
    return { group: null, index: loadout.items.indexOf(group) + (after ? 1 : 0), marker: block, cls: after ? "drop-after" : "drop-before" };
  }

  private dropAt(loadout: Loadout, spot: Spot) {
    const item = this.drag;
    this.drag = null;
    if (!item) return;
    if (isLoadoutGroup(item)) {
      if (!spot.group) this.moveGroup(loadout, item, spot.index);
      else this.render();
    } else {
      this.moveTab(loadout, item, spot.group, spot.index);
    }
  }

  private lowerHalf(node: HTMLElement, e: DragEvent) {
    const r = node.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  }

  private clearMarkers(root: HTMLElement) {
    for (const node of root.querySelectorAll(".drop-before, .drop-after, .drop-into, .drop-end")) {
      node.classList.remove("drop-before", "drop-after", "drop-into", "drop-end");
    }
  }

  // ---- the window ----

  private emptyWindow(loadout: Loadout) {
    const win = el("div", "lo-window lo-window-empty");
    const add = el("button", "macro-add");
    add.append(icon(Plus), "Add a tab");
    add.addEventListener("click", () => {
      const tab = newTab();
      loadout.items.push(tab);
      this.picked.set(loadout, tab);
      this.commit();
    });
    win.append(el("p", "", "Nothing opens yet."), add);
    return win;
  }

  /** The picked tab as a window: a title bar, then its panes as little terminals. */
  private window(loadout: Loadout, tab: LoadoutTab) {
    const panes = tab.columns.flat();
    let focus = this.focused.get(tab);
    if (!focus || !panes.includes(focus)) {
      focus = panes[0];
      this.focused.set(tab, focus);
    }
    const win = el("div", "lo-window");
    const group = this.groupOf(loadout, tab);
    if (group) win.style.setProperty("--group-color", GROUP_COLORS[group.color]);
    else if (tab.color) win.style.setProperty("--group-color", GROUP_COLORS[tab.color]);

    const bar = el("div", "lo-titlebar");
    const title = el("input", "lo-title");
    title.value = tab.title ?? "";
    title.placeholder = this.tabTitle(tab);
    title.spellcheck = false;
    title.autocomplete = "off";
    title.setAttribute("aria-label", "Tab title");
    title.addEventListener("input", () => {
      tab.title = title.value.trim() || undefined;
      this.save();
    });
    // The sidebar row shows the new title once editing is done.
    title.addEventListener("change", () => this.render());

    // Splits act on the focused pane, like ⌘D and ⌘⇧D in a real tab.
    const split = (dir: "right" | "down") => {
      const current = this.focused.get(tab)!;
      const { col, row } = this.find(tab, current);
      const pane = { dir: current.dir };
      if (dir === "right") tab.columns.splice(col + 1, 0, [pane]);
      else tab.columns[col].splice(row + 1, 0, pane);
      this.focused.set(tab, pane);
      this.commit();
    };
    const splitRight = this.barButton(Columns2, "Split right", () => split("right"));
    const splitDown = this.barButton(Rows2, "Split down", () => split("down"));
    bar.append(group ? el("span", "lo-crumb", group.name || "Group") : "", title, splitRight, splitDown);

    const grid = el("div", panes.length > 1 ? "lo-grid" : "lo-grid single");
    const cells = new Map<LoadoutPane, HTMLElement>();
    /** Lights the focused pane (here and in the sidebar glyph) and enables the splits that fit. */
    const sync = () => {
      const current = this.focused.get(tab)!;
      for (const [pane, cell] of cells) cell.classList.toggle("focused", pane === current);
      const { col } = this.find(tab, current);
      const glyph = this.list.querySelector(".lo-tree .tab.active .tab-layout");
      glyph?.querySelectorAll(".tab-layout-pane").forEach((node, i) => node.classList.toggle("focused", panes[i] === current));
      this.setDisabled(splitRight, "Split right", tab.columns.length >= MAX_COLUMNS);
      this.setDisabled(splitDown, "Split down", tab.columns[col].length >= MAX_ROWS);
    };
    for (const column of tab.columns) {
      const c = el("div", "lo-col");
      for (const pane of column) {
        const cell = this.paneCell(tab, pane, panes.length > 1);
        cell.addEventListener("focusin", () => {
          this.focused.set(tab, pane);
          sync();
        });
        cell.addEventListener("mousedown", () => {
          this.focused.set(tab, pane);
          sync();
        });
        cells.set(pane, cell);
        c.append(cell);
      }
      grid.append(c);
    }
    win.append(bar, grid);
    queueMicrotask(sync);
    return win;
  }

  private setDisabled(b: HTMLButtonElement, label: string, disabled: boolean) {
    b.disabled = disabled;
    b.title = disabled ? `${label} (no room)` : label;
  }

  private find(tab: LoadoutTab, pane: LoadoutPane) {
    const col = tab.columns.findIndex((c) => c.includes(pane));
    return { col, row: tab.columns[col].indexOf(pane) };
  }

  private barButton(node: typeof Columns2, label: string, action: () => void) {
    const b = el("button", "lo-icon-button");
    b.append(icon(node, 14));
    b.title = label;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", action);
    return b;
  }

  /** One pane: its folder as the prompt, and what the macro will type after it. */
  private paneCell(tab: LoadoutTab, pane: LoadoutPane, removable: boolean) {
    const cell = el("div", "lo-pane");

    const path = el("div", "lo-path");
    const dir = el("input", "lo-dir");
    dir.value = pane.dir;
    dir.placeholder = "~";
    dir.spellcheck = false;
    dir.autocomplete = "off";
    dir.dataset.dir = pane.dir;
    dir.setAttribute("aria-label", "Starts in folder");
    dir.addEventListener("input", () => {
      pane.dir = tildePath(normalizePath(dir.value)) || "~";
      dir.dataset.dir = pane.dir;
      this.save();
      void this.checkFolders();
    });
    dir.addEventListener("change", () => {
      dir.value = pane.dir;
      dir.dataset.dir = pane.dir;
      // The sidebar row names untitled tabs after their first folder.
      const row = this.list.querySelector(".lo-tree .tab.active .lo-untitled");
      if (row) row.textContent = this.tabTitle(tab);
    });
    path.append(dir);
    attachPathSuggest(dir);

    const macros = loadMacros().filter((m) => m.name && runnable(m).length > 0);
    const macro = pane.macro ? macros.find((m) => m.name === pane.macro) : undefined;
    // "@ claude ▾": a fixed at-sign, then the macro as a native picker; hovering it lists what the macro types.
    const line = el("div", "lo-run");
    const chip = el("label", "lo-macro");
    if (macro) chip.classList.add("set");
    else if (pane.macro) chip.classList.add("missing");
    chip.append(el("span", "", pane.macro ?? "no macro"), icon(ChevronDown, 11));
    const pick = el("select", "lo-macro-pick");
    pick.setAttribute("aria-label", "Macro to run");
    const option = (value: string, label: string) => Object.assign(el("option", "", label), { value });
    pick.append(option("", "Plain shell"), ...macros.map((m) => option(m.name, `@${m.name}`)));
    if (pane.macro && !macro) pick.append(option(pane.macro, `@${pane.macro} (missing)`));
    pick.value = pane.macro ?? "";
    pick.addEventListener("change", () => {
      pane.macro = pick.value || undefined;
      this.commit();
    });
    chip.append(pick);
    line.append(icon(AtSign, 13, "lo-at"), chip);

    if (pane.macro) {
      const tip = el("div", "lo-run-tip");
      tip.setAttribute("role", "tooltip");
      if (macro) {
        for (const command of runnable(macro)) {
          const row = el("div", "lo-run-tip-line");
          row.append(el("span", "lo-prompt", "❯"), command);
          tip.append(row);
        }
      } else {
        tip.textContent = `There's no macro named @${pane.macro}, so this pane opens a plain shell.`;
        tip.classList.add("missing");
      }
      line.append(tip);
    }

    cell.append(path, line);
    if (removable) {
      const close = el("button", "lo-pane-close");
      close.append(icon(X, 12));
      close.title = "Close pane";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        const { col, row } = this.find(tab, pane);
        tab.columns[col].splice(row, 1);
        if (tab.columns[col].length === 0) tab.columns.splice(col, 1);
        this.commit();
      });
      cell.append(close);
    }
    return cell;
  }

  /** Marks folders that don't exist (those panes would start in ~). */
  private async checkFolders() {
    const seq = ++this.seq;
    const inputs = [...this.list.querySelectorAll<HTMLInputElement>(".lo-dir")];
    const paths = [...new Set(inputs.map((i) => normalizePath(i.dataset.dir ?? "")).filter(Boolean))];
    const existing = new Set(await invoke<string[]>("existing_dirs", { paths }).catch(() => paths));
    if (seq !== this.seq) return;
    for (const input of inputs) {
      const path = normalizePath(input.dataset.dir ?? "");
      const missing = !!path && !existing.has(path);
      input.classList.toggle("missing", missing);
      input.title = missing ? "No folder here, so this pane starts in ~" : "";
    }
  }
}
