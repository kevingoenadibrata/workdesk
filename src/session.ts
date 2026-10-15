import type { SavedGroup, SavedSession, SavedTab, Workspace } from "./workspace";

const KEY = "workdesk.session";
const SAVE_DELAY_MS = 500;

function validTab(t: unknown): t is SavedTab {
  const tab = t as SavedTab;
  return (
    !!tab &&
    Array.isArray(tab.columns) &&
    tab.columns.every((c) => Array.isArray(c) && c.every((d) => typeof d === "string")) &&
    Array.isArray(tab.focus)
  );
}

/** The session saved when the app last ran, or null if there's none (or it can't be read). */
export function loadSession(): SavedSession | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw) return null;
    // Sessions saved before groups could sit between tabs listed ungrouped tabs, then groups.
    const list: unknown[] = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.ungrouped) && Array.isArray(raw.groups)
        ? [...raw.ungrouped, ...raw.groups]
        : [];
    const items = list.flatMap((item): (SavedTab | SavedGroup)[] => {
      const g = item as SavedGroup;
      if (g && Array.isArray(g.tabs)) return [{ ...g, tabs: g.tabs.filter(validTab) }];
      return validTab(item) ? [item] : [];
    });
    return { items, active: Number(raw.active) || 0 };
  } catch {
    return null;
  }
}

/**
 * Saves the workspace's tabs, splits and groups whenever they change (a shell
 * changing folder counts), so the next launch reopens them.
 */
export function keepSessionSaved(ws: Workspace) {
  let timer: number | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      localStorage.setItem(KEY, JSON.stringify(ws.snapshot()));
    } catch {
      // Next launch starts with a fresh tab.
    }
  };
  ws.onChange(() => {
    // Closing the last tab quits, so save that right away rather than after the delay.
    if (ws.tabs.size === 0) return save();
    clearTimeout(timer);
    timer = window.setTimeout(save, SAVE_DELAY_MS);
  });
  window.addEventListener("beforeunload", () => {
    if (timer !== undefined) save();
  });
}
