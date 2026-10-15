import { ChevronDown, Folder, FolderOpen, Package, Plus, Star, X, icon } from "./icons";
import { favoriteDirs, tildePath } from "./favorites";
import { COLOR_NAMES, GROUP_COLORS, isGroupEntry, type Group, type Location, type Workspace } from "./workspace";
import { closeMenu, isMenuOpen, showMenu, type MenuItem } from "./menu";
import { isModClick, type Action } from "./shortcuts";
import { kbdFor } from "./kbd";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

type Renaming = { kind: "tab" | "group"; id: number };

/** Where a drag would land, and how to show it. */
interface Spot {
  loc: Location;
  marker: HTMLElement;
  cls: "drop-before" | "drop-after" | "drop-into" | "drop-end";
}

/** Vertical tab list with collapsible, colored tab groups. */
export class Sidebar {
  /** Tabs being dragged, in sidebar order. */
  private dragTabIds: number[] | null = null;
  /** Groups being dragged by their headers, in sidebar order. */
  private dragGroupIds: number[] | null = null;
  private renaming: Renaming | null = null;
  /** False while a page (Settings, Shortcuts) replaces the terminals, so no tab looks active. */
  private showActive = true;
  /** Lowercased search text; non-empty while the list is filtered. */
  private query = "";
  /** Index into the visible matches of the one Enter would open. */
  private hit = 0;

  constructor(
    private root: HTMLElement,
    private ws: Workspace,
    /** Opens a tab in `dir`, or in the active tab's directory if omitted. */
    private onNewTab: (dir?: string) => void,
    private onTeleport: () => void,
    /** Saves the given tabs and groups as one new loadout. */
    private onSaveLoadout: (tabIds: Set<number>, groupIds: Set<number>) => void,
  ) {
    ws.onChange(() => this.render());

    // Empty space below the list drops at the very end.
    root.addEventListener("dragover", (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      this.showSpot({ loc: { groupId: null, index: this.ws.top.length }, marker: root, cls: "drop-end" });
    });
    root.addEventListener("dragleave", (e) => {
      if (e.target === root) root.classList.remove("drop-end");
    });
    root.addEventListener("drop", (e) => {
      e.preventDefault();
      this.drop({ groupId: null, index: this.ws.top.length });
    });

    // A pane drag that ends elsewhere leaves no marker behind.
    window.addEventListener("dragend", () => this.clearDropMarkers());

    // Clicking around the sidebar shouldn't leave the terminal unfocused.
    root.addEventListener("click", () => {
      if (!this.renaming) this.ws.activeTab?.session.term.focus();
    });
  }

  /** A tab, a group, or a pane by its header, is being dragged over the sidebar. */
  private get dragging() {
    return this.dragTabIds != null || this.dragGroupIds != null || this.ws.paneDrag != null;
  }

  /** Tabs currently being dragged out of the sidebar, if any. */
  get draggingTabIds(): readonly number[] | null {
    return this.dragTabIds;
  }

  setShowActive(show: boolean) {
    if (this.showActive === show) return;
    this.showActive = show;
    this.render();
  }

  /** The tab to mark active, if any. */
  private get activeId() {
    return this.showActive ? this.ws.activeId : null;
  }

  // ---- search ----

  /** Filters the list to tabs matching `query`; empty shows everything. */
  setQuery(query: string) {
    this.query = query.trim().toLowerCase();
    this.hit = 0;
    this.render();
  }

  /** Moves the highlighted match up or down. */
  moveHit(delta: number) {
    const n = this.matches().length;
    if (n === 0) return;
    this.hit = (this.hit + delta + n) % n;
    this.render();
  }

  /** The highlighted match, if the search has any. */
  get hitId(): number | undefined {
    return this.matches()[this.hit];
  }

  private tabMatches(id: number): boolean {
    const tab = this.ws.tabs.get(id)!;
    const text = [this.ws.title(tab), ...tab.sessions.flatMap((s) => [s.cwd, s.procName])].join("\n").toLowerCase();
    return text.includes(this.query);
  }

  /** Visible tabs in sidebar order. A matching group name shows all its tabs. */
  private matches(): number[] {
    if (!this.query) return this.ws.orderedTabIds();
    return this.ws.top.flatMap((e) => {
      if (!isGroupEntry(e)) return this.tabMatches(e) ? [e] : [];
      return e.name.toLowerCase().includes(this.query) ? e.tabIds : e.tabIds.filter((id) => this.tabMatches(id));
    });
  }

  render() {
    // Re-rendering would destroy the rename input; we render again when it closes.
    if (this.renaming) return;
    const order = this.ws.orderedTabIds();
    if (this.query) {
      const visible = this.matches();
      this.hit = Math.min(this.hit, Math.max(0, visible.length - 1));
      const shown = new Set(visible);
      const hit = visible[this.hit];
      const rows = this.ws.top.flatMap((e) => {
        if (!isGroupEntry(e)) return shown.has(e) ? [this.tabRow(e, order, hit)] : [];
        return e.tabIds.some((id) => shown.has(id)) ? [this.groupBlock(e, order, shown, hit)] : [];
      });
      if (visible.length === 0) rows.push(el("div", "search-empty", "No tabs match."));
      this.root.replaceChildren(...rows);
      return;
    }
    const rows = this.ws.top.map((e) => (isGroupEntry(e) ? this.groupBlock(e, order) : this.tabRow(e, order)));
    this.root.replaceChildren(...rows, this.newTabRow());
  }

  /** Last row of the list, right under the tabs. */
  private newTabRow() {
    const row = el("button", "new-tab-row");
    const hint = el("span", "tab-hint");
    hint.append(kbdFor("newTab"));
    row.append(icon(Plus, 13), el("span", "tab-title", "New tab"), hint);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeFavoritesMenu();
      this.onNewTab();
    });
    row.addEventListener("mouseenter", () => this.hoverFavorites(row, true));
    row.addEventListener("mouseleave", () => this.hoverFavorites(row, false));
    return row;
  }

  // ---- favorites flyout ----

  /** The hover flyout listing Teleport favorites, while open. */
  private favoritesMenu: HTMLElement | null = null;
  private favoritesTimer: number | undefined;

  /** Opens the flyout after a short hover; closes it shortly after the pointer leaves both it and the row. */
  private hoverFavorites(row: HTMLElement, inside: boolean) {
    clearTimeout(this.favoritesTimer);
    if (inside && this.favoritesMenu?.isConnected) return;
    if (!inside && !this.favoritesMenu?.isConnected) return;
    this.favoritesTimer = window.setTimeout(
      () => (inside ? this.openFavoritesMenu(row) : this.closeFavoritesMenu()),
      inside ? 250 : 200,
    );
  }

  private openFavoritesMenu(row: HTMLElement) {
    // Don't replace a context menu that's already open.
    if (this.dragging || !row.isConnected || isMenuOpen()) return;
    const items: MenuItem[] = [{ heading: "New tab in" }];
    for (const dir of favoriteDirs()) {
      const label = tildePath(dir);
      items.push({ label: label.slice(label.lastIndexOf("/") + 1) || label, title: label, icon: Star, action: () => this.onNewTab(dir) });
    }
    if (items.length === 1) items.push({ heading: "No favorites yet — star folders in Teleport" });
    items.push({ separator: true }, { label: "Teleport…", shortcut: "newTabIn", action: this.onTeleport });
    const sidebar = row.closest("#sidebar") ?? row;
    const menu = showMenu(sidebar.getBoundingClientRect().right + 4, row.getBoundingClientRect().top - 5, items);
    menu.classList.add("favorites-menu");
    menu.addEventListener("mouseenter", () => clearTimeout(this.favoritesTimer));
    menu.addEventListener("mouseleave", () => this.hoverFavorites(row, false));
    this.favoritesMenu = menu;
  }

  private closeFavoritesMenu() {
    clearTimeout(this.favoritesTimer);
    if (this.favoritesMenu?.isConnected) closeMenu();
    this.favoritesMenu = null;
  }

  // ---- rows ----

  private tabRow(id: number, order: number[], hitId?: number) {
    const tab = this.ws.tabs.get(id)!;
    const row = el("div", "tab");
    row.dataset.tabId = String(id);
    row.dataset.tip = this.ws.title(tab);
    // Reordering a filtered list would land tabs in surprising places.
    row.draggable = !this.query;
    // Tabs in a group take the group's color; their own shows again once ungrouped.
    if (tab.color && !this.ws.groupOf(id)) {
      row.classList.add("colored");
      row.style.setProperty("--group-color", GROUP_COLORS[tab.color]);
    }
    if (id === hitId) row.classList.add("search-hit");
    if (id === this.activeId) row.classList.add("active");
    else if (this.ws.selection.has(id)) row.classList.add("selected");

    const position = order.indexOf(id);
    const hint = el("span", "tab-hint");
    // ⌘9 jumps to the last tab, so only the first eight get a number.
    if (position < 8) hint.append(kbdFor(`goToTab${position + 1}` as Action));
    const close = el("button", "tab-close");
    close.append(icon(X, 13));
    close.title = "Close tab";
    row.append(this.layoutIcon(id), el("span", "tab-title", this.ws.title(tab)), hint, close);

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.ws.requestCloseTabs([id]);
    });
    row.addEventListener("click", (e) => {
      if (isModClick(e)) this.ws.toggleSelected(id);
      else if (e.shiftKey) this.ws.selectRange(id);
      else this.ws.activate(id);
    });
    row.addEventListener("dblclick", () => this.startRename("tab", id));
    row.addEventListener("auxclick", (e) => {
      if (e.button === 1) void this.ws.requestCloseTabs([id]);
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // Right-clicking inside a multi-selection acts on all of it.
      if (!this.ws.isSelected(id)) this.ws.activate(id);
      showMenu(e.clientX, e.clientY, this.tabMenu(id));
    });

    row.addEventListener("dragstart", (e) => {
      // Dragging a selected tab drags the whole selection.
      const ids = this.ws.isSelected(id) ? this.ws.selectedIds() : [id];
      this.dragTabIds = ids;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", ids.join(","));
      if (ids.length > 1) this.setCountDragImage(e, `${ids.length} tabs`);
      for (const tabId of ids) this.rowFor(tabId)?.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      this.dragTabIds = null;
      for (const node of this.root.querySelectorAll(".dragging")) node.classList.remove("dragging");
      this.clearDropMarkers();
    });
    row.addEventListener("dragover", (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      this.showSpot(this.tabSpot(id, row, e));
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.drop(this.tabSpot(id, row, e).loc);
    });
    return row;
  }

  /** Miniature of the tab's pane grid (a single box when unsplit), with the focused pane lit. */
  private layoutIcon(id: number) {
    const tab = this.ws.tabs.get(id)!;
    const icon = el("span", "tab-layout");
    if (tab.sessions.length > 1) icon.title = `${tab.sessions.length} panes`;
    for (const column of tab.columns) {
      const col = el("span", "tab-layout-col");
      for (const session of column) col.append(el("span", "tab-layout-pane" + (session === tab.focused ? " focused" : "")));
      icon.append(col);
    }
    return icon;
  }

  /** While searching, `shown` limits the tabs and collapsed groups open up. */
  private groupBlock(group: Group, order: number[], shown?: Set<number>, hitId?: number) {
    const collapsed = group.collapsed && !shown;
    const block = el("div", "group" + (collapsed ? " collapsed" : ""));
    block.dataset.groupId = String(group.id);
    block.style.setProperty("--group-color", GROUP_COLORS[group.color]);

    const header = el("div", "group-header");
    header.dataset.tip = `${group.name} (${group.tabIds.length})`;
    header.draggable = !this.query;
    if (this.ws.isGroupSelected(group.id)) header.classList.add("selected");
    if (collapsed && this.activeId != null && group.tabIds.includes(this.activeId)) {
      header.classList.add("has-active");
    }
    const add = el("button", "group-add");
    add.append(icon(Plus, 13));
    add.title = "New tab in group";
    header.append(
      icon(ChevronDown, 12, "group-chevron"),
      icon(collapsed ? Folder : FolderOpen, 14, "group-icon"),
      el("span", "group-name", group.name),
      el("span", "group-count", String(group.tabIds.length)),
      add,
    );

    add.addEventListener("click", (e) => {
      e.stopPropagation();
      this.ws.newTab({ groupId: group.id, index: group.tabIds.length });
    });
    header.addEventListener("click", (e) => {
      if (isModClick(e)) return this.ws.toggleGroupSelected(group.id);
      if (e.shiftKey) return this.ws.selectGroupRange(group.id);
      this.ws.clearSelection();
      this.ws.toggleCollapsed(group.id);
    });
    header.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.startRename("group", group.id);
    });
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // Right-clicking inside a multi-selection acts on all of it.
      if (!this.ws.isGroupSelected(group.id)) this.ws.selectOnlyGroup(group.id);
      showMenu(e.clientX, e.clientY, this.groupMenu(group));
    });
    header.addEventListener("dragstart", (e) => {
      // Dragging a selected group drags every selected group.
      const ids = this.ws.isGroupSelected(group.id)
        ? this.ws.groups.filter((g) => this.ws.isGroupSelected(g.id)).map((g) => g.id)
        : [group.id];
      this.dragGroupIds = ids;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", `groups:${ids.join(",")}`);
      if (ids.length > 1) this.setCountDragImage(e, `${ids.length} groups`);
      for (const groupId of ids) this.root.querySelector(`.group[data-group-id="${groupId}"]`)?.classList.add("dragging");
    });
    header.addEventListener("dragend", () => {
      this.dragGroupIds = null;
      for (const node of this.root.querySelectorAll(".dragging")) node.classList.remove("dragging");
      this.clearDropMarkers();
    });
    header.addEventListener("dragover", (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      this.showSpot(this.headerSpot(group, header, e));
    });
    header.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.drop(this.headerSpot(group, header, e).loc);
    });

    block.append(header);
    if (!collapsed) {
      const body = el("div", "group-tabs");
      for (const id of group.tabIds) if (!shown || shown.has(id)) body.append(this.tabRow(id, order, hitId));
      block.append(body);
    }
    return block;
  }

  // ---- context menus ----

  private tabMenu(id: number): MenuItem[] {
    const ids = this.ws.isSelected(id) ? this.ws.selectedIds() : [id];
    const n = ids.length;
    const tabs = n > 1 ? `${n} Tabs` : "Tab";
    const loc = this.ws.locate(id);
    const groupIds = new Set(ids.map((tabId) => this.ws.groupOf(tabId)?.id ?? null));
    const sameGroup = groupIds.size === 1 ? [...groupIds][0] : undefined;
    const targets = this.ws.groups.filter((g) => g.id !== sameGroup);
    const split = (this.ws.tabs.get(id)?.sessions.length ?? 1) > 1;
    const single: MenuItem[] =
      n === 1
        ? [
            { label: "Rename Tab", shortcut: "renameTab" as const, action: () => this.startRename("tab", id) },
            { label: "New Tab Below", action: () => this.ws.newTab({ groupId: loc.groupId, index: loc.index + 1 }) },
            ...(split
              ? [
                  { label: "Unsplit into Tabs", shortcut: "unsplit" as const, action: () => this.ws.unsplit(id) },
                  { label: "Move Focused Pane to New Tab", action: () => this.ws.movePaneToNewTab(id) },
                ]
              : []),
            { separator: true },
          ]
        : [];
    const colors = new Set(ids.map((tabId) => this.ws.tabs.get(tabId)?.color));
    // Only ungrouped tabs pick their own color; grouped ones wear their group's.
    const color: MenuItem[] =
      sameGroup === null
        ? [
            {
              swatches: COLOR_NAMES.map((c) => ({
                color: GROUP_COLORS[c],
                selected: colors.size === 1 && colors.has(c),
                action: () => this.ws.setTabColor(ids, c),
              })),
            },
            ...(colors.size > 1 || !colors.has(undefined)
              ? [{ label: "Clear Color", action: () => this.ws.setTabColor(ids, undefined) }]
              : []),
            { separator: true },
          ]
        : [];
    return [
      ...single,
      ...color,
      { heading: `Move ${n > 1 ? `${n} tabs ` : ""}to group` },
      ...targets.map((g) => ({
        label: g.name,
        color: GROUP_COLORS[g.color],
        action: () => this.ws.moveTabs(ids, { groupId: g.id, index: g.tabIds.length }),
      })),
      {
        label: "New Group",
        shortcut: "groupSelected" as const,
        action: () => this.startRename("group", this.ws.createGroup(ids).id),
      },
      ...(sameGroup !== null
        ? [{ label: "Remove from Group", shortcut: "ungroupSelected" as const, action: () => this.ws.removeFromGroups(ids) }]
        : []),
      { separator: true },
      this.saveLoadoutItem(new Set(ids), new Set(this.ws.groupSelection)),
      { separator: true },
      { label: `Close ${tabs}`, shortcut: "closeTab" as const, danger: true, action: () => void this.ws.requestCloseTabs(ids) },
    ];
  }

  /** "Save as Loadout…" for the given tabs and groups, named by how much it saves. */
  private saveLoadoutItem(tabIds: Set<number>, groupIds: Set<number>): MenuItem {
    const loose = [...tabIds].filter((id) => !groupIds.has(this.ws.groupOf(id)?.id ?? -1)).length;
    const parts = [
      groupIds.size > 1 ? `${groupIds.size} Groups` : groupIds.size === 1 ? "Group" : "",
      loose > 1 ? `${loose} Tabs` : loose === 1 ? (groupIds.size > 0 ? "1 Tab" : "Tab") : "",
    ].filter(Boolean);
    return {
      label: `Save ${parts.join(" and ")} as Loadout…`,
      icon: Package,
      action: () => this.onSaveLoadout(tabIds, groupIds),
    };
  }

  private groupMenu(group: Group): MenuItem[] {
    const groupIds = new Set(this.ws.groupSelection);
    const tabIds = new Set(this.ws.selection);
    if (groupIds.size + tabIds.size > 1) {
      const n = groupIds.size;
      return [
        this.saveLoadoutItem(tabIds, groupIds),
        { separator: true },
        {
          label: n > 1 ? `Ungroup ${n} Groups` : "Ungroup",
          action: () => [...groupIds].forEach((id) => this.ws.ungroup(id)),
        },
        {
          label: n > 1 ? `Close ${n} Groups` : "Close Group",
          danger: true,
          action: () => void this.ws.requestCloseGroups([...groupIds]),
        },
      ];
    }
    return [
      { label: "Rename Group", action: () => this.startRename("group", group.id) },
      {
        swatches: COLOR_NAMES.map((c) => ({
          color: GROUP_COLORS[c],
          selected: group.color === c,
          action: () => this.ws.setGroupColor(group.id, c),
        })),
      },
      { separator: true },
      { label: "New Tab in Group", action: () => this.ws.newTab({ groupId: group.id, index: group.tabIds.length }) },
      { label: group.collapsed ? "Expand" : "Collapse", action: () => this.ws.toggleCollapsed(group.id) },
      { label: "Ungroup", action: () => this.ws.ungroup(group.id) },
      { separator: true },
      this.saveLoadoutItem(new Set(), new Set([group.id])),
      { separator: true },
      { label: "Close Group", danger: true, action: () => void this.ws.requestCloseGroups([group.id]) },
    ];
  }

  // ---- renaming ----

  startRename(kind: "tab" | "group", id: number) {
    this.renaming = null;
    this.render();
    const selector = kind === "tab" ? `.tab[data-tab-id="${id}"] .tab-title` : `.group[data-group-id="${id}"] .group-name`;
    const label = this.root.querySelector<HTMLElement>(selector);
    if (!label) return;

    const input = el("input", "rename");
    input.value = label.textContent ?? "";
    input.spellcheck = false;
    const row = label.parentElement!;
    row.draggable = false;
    label.replaceWith(input);
    input.focus();
    input.select();
    this.renaming = { kind, id };

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = null;
      if (commit) {
        if (kind === "tab") this.ws.renameTab(id, input.value);
        else this.ws.renameGroup(id, input.value);
      }
      this.render();
      this.ws.activeTab?.session.term.focus();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Enter" && e.key !== "Escape") return;
      // Without this, the keypress that follows lands in the refocused terminal.
      e.preventDefault();
      finish(e.key === "Enter");
    });
    input.addEventListener("blur", () => finish(true));
    for (const type of ["click", "dblclick", "mousedown"]) {
      input.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  // ---- drag & drop ----

  /** Where a drag over a tab row lands: beside the tab, or beside its whole group when moving groups. */
  private tabSpot(id: number, row: HTMLElement, e: DragEvent): Spot {
    const group = this.ws.groupOf(id);
    if (this.dragGroupIds && group) {
      const block = row.closest<HTMLElement>(".group")!;
      return this.besideGroup(group, block, this.isLowerHalf(block, e));
    }
    const loc = this.ws.locate(id);
    const after = this.isLowerHalf(row, e);
    return { loc: { groupId: loc.groupId, index: loc.index + (after ? 1 : 0) }, marker: row, cls: after ? "drop-after" : "drop-before" };
  }

  /**
   * Where a drag over a group header lands. Groups go before or after it.
   * Tabs go into it, unless near its top edge (or a collapsed one's bottom
   * edge), which puts them beside it, between top-level entries.
   */
  private headerSpot(group: Group, header: HTMLElement, e: DragEvent): Spot {
    const block = header.parentElement!;
    if (this.dragGroupIds) return this.besideGroup(group, block, this.isLowerHalf(block, e));
    const r = header.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (y < 0.3) return this.besideGroup(group, block, false);
    if (group.collapsed && y > 0.7) return this.besideGroup(group, block, true);
    return { loc: { groupId: group.id, index: group.tabIds.length }, marker: header, cls: "drop-into" };
  }

  private besideGroup(group: Group, block: HTMLElement, after: boolean): Spot {
    const index = this.ws.top.indexOf(group) + (after ? 1 : 0);
    return { loc: { groupId: null, index }, marker: block, cls: after ? "drop-after" : "drop-before" };
  }

  private showSpot(spot: Spot) {
    this.clearDropMarkers();
    // Groups can only sit at the top level.
    if (this.dragGroupIds && spot.loc.groupId != null) return;
    spot.marker.classList.add(spot.cls);
  }

  private drop(dest: Location) {
    const ids = this.dragTabIds;
    const groupIds = this.dragGroupIds;
    const pane = this.ws.paneDrag;
    this.dragTabIds = null;
    this.dragGroupIds = null;
    this.clearDropMarkers();
    if (groupIds) {
      if (dest.groupId == null) this.ws.moveGroups(groupIds, dest.index);
    } else if (ids) this.ws.moveTabs(ids, dest);
    // A pane dragged out of a split becomes its own tab here.
    else if (pane) this.ws.movePaneToSidebar(pane, dest);
  }

  private rowFor(tabId: number) {
    return this.root.querySelector<HTMLElement>(`.tab[data-tab-id="${tabId}"]`);
  }

  /** Replaces the drag ghost with a pill like "3 tabs". */
  private setCountDragImage(e: DragEvent, label: string) {
    const ghost = el("div", "drag-ghost", label);
    document.body.append(ghost);
    e.dataTransfer!.setDragImage(ghost, 12, 12);
    requestAnimationFrame(() => ghost.remove());
  }

  private isLowerHalf(row: HTMLElement, e: DragEvent) {
    const r = row.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  }

  private clearDropMarkers() {
    this.root.classList.remove("drop-end");
    for (const node of this.root.querySelectorAll(".drop-before, .drop-after, .drop-into")) {
      node.classList.remove("drop-before", "drop-after", "drop-into");
    }
  }
}
