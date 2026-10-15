import { GROUP_COLOR_NAMES, type GroupColor } from "./themes";

const KEY = "workdesk.loadouts";

/** One pane: the folder its shell starts in, and the macro (by name) typed into it. */
export interface LoadoutPane {
  dir: string;
  macro?: string;
}

/** A tab as a grid of panes, by column, like a saved session's tab. */
export interface LoadoutTab {
  title?: string;
  color?: GroupColor;
  columns: LoadoutPane[][];
}

export interface LoadoutGroup {
  name: string;
  color: GroupColor;
  collapsed?: boolean;
  tabs: LoadoutTab[];
}

/** A top-level entry: an ungrouped tab, or a group of tabs. */
export type LoadoutItem = LoadoutTab | LoadoutGroup;

export const isLoadoutGroup = (item: LoadoutItem): item is LoadoutGroup => "tabs" in item;

/**
 * A named set of tabs and groups that opens in one go ("#name" in Teleport,
 * or the Loadouts menu), always after whatever is already open.
 */
export interface Loadout {
  name: string;
  /** Ungrouped tabs and groups, in sidebar order. */
  items: LoadoutItem[];
}

/** Loadout names are what follows "#", so they can't contain spaces, "#" or "@". */
export function cleanLoadoutName(name: string): string {
  return name.replace(/[\s#@]+/g, "").toLowerCase();
}

const color = (c: unknown): GroupColor | undefined =>
  GROUP_COLOR_NAMES.includes(c as GroupColor) ? (c as GroupColor) : undefined;

function readTab(t: any): LoadoutTab | null {
  if (!t || !Array.isArray(t.columns)) return null;
  const columns = t.columns
    .filter(Array.isArray)
    .map((c: any[]) =>
      c
        .filter((p) => p && typeof p.dir === "string")
        .map((p): LoadoutPane => ({ dir: p.dir, macro: typeof p.macro === "string" && p.macro ? p.macro : undefined })),
    )
    .filter((c: LoadoutPane[]) => c.length > 0);
  if (columns.length === 0) return null;
  return { title: typeof t.title === "string" && t.title ? t.title : undefined, color: color(t.color), columns };
}

const readTabs = (list: unknown): LoadoutTab[] =>
  Array.isArray(list) ? list.map(readTab).filter((t): t is LoadoutTab => t != null) : [];

function readGroup(g: any): LoadoutGroup | null {
  if (!g || typeof g.name !== "string" || !Array.isArray(g.tabs)) return null;
  return { name: g.name, color: color(g.color) ?? GROUP_COLOR_NAMES[0], collapsed: !!g.collapsed, tabs: readTabs(g.tabs) };
}

function readItems(l: any): LoadoutItem[] {
  // Loadouts saved before groups could sit between tabs listed ungrouped tabs, then groups.
  const raw: any[] = Array.isArray(l.items) ? l.items : [...(l.ungrouped ?? []), ...(l.groups ?? [])];
  return raw
    .map((item) => (item && Array.isArray(item.tabs) ? readGroup(item) : readTab(item)))
    .filter((item): item is LoadoutItem => item != null);
}

/** All loadouts, in the order Settings lists them. May hold half-edited ones (no name). */
export function loadLoadouts(): Loadout[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((l) => l && typeof l.name === "string")
      .map((l) => ({ name: l.name, items: readItems(l) }));
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

/** Called whenever the saved loadouts change. */
export function onLoadoutsChange(fn: () => void) {
  listeners.add(fn);
}

export function saveLoadouts(list: Loadout[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable; loadouts just won't persist.
  }
  for (const fn of listeners) fn();
}

/** Every tab a loadout opens, grouped or not, in order. */
export function allTabs(loadout: Loadout): LoadoutTab[] {
  return loadout.items.flatMap((item) => (isLoadoutGroup(item) ? item.tabs : [item]));
}

/** Number of tabs a loadout opens. */
export function tabCount(loadout: Loadout): number {
  return allTabs(loadout).length;
}

/** Loadouts that can be opened: named, with at least one tab, first of each name wins. */
export function usableLoadouts(): Loadout[] {
  const seen = new Set<string>();
  return loadLoadouts().filter((l) => {
    if (!l.name || seen.has(l.name) || tabCount(l) === 0) return false;
    seen.add(l.name);
    return true;
  });
}

export function findLoadout(name: string): Loadout | undefined {
  const key = cleanLoadoutName(name);
  return usableLoadouts().find((l) => l.name === key);
}

/** "2 groups · 5 tabs" */
export function describeLoadout(loadout: Loadout): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const tabs = plural(tabCount(loadout), "tab");
  const groups = loadout.items.filter(isLoadoutGroup).length;
  return groups > 0 ? `${plural(groups, "group")} · ${tabs}` : tabs;
}

/** Adds `loadout` under a name no other loadout has (suffixing "-2", "-3"…); returns that name. */
export function addLoadout(loadout: Loadout): string {
  const list = loadLoadouts();
  const taken = new Set(list.map((l) => l.name));
  const base = cleanLoadoutName(loadout.name) || "loadout";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  saveLoadouts([...list, { ...loadout, name }]);
  return name;
}
