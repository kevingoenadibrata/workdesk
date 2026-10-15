const KEY = "workdesk.recentDirs";
const MAX = 50;

let home = "";

/** Home is always offered on its own, so it's never stored as a recent. */
export function setHome(dir: string) {
  home = dir;
}

export function homeDir() {
  return home;
}

function load(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage unavailable; recents just won't persist.
  }
}

/** Recently used directories, most recent first. */
export function recentDirs(): string[] {
  return load();
}

/** Moves `dir` to the front of the recents. */
export function touchRecent(dir: string) {
  const path = dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
  if (!path || path === home) return;
  const list = load();
  if (list[0] === path) return;
  save([path, ...list.filter((p) => p !== path)]);
}

/** Drops recents that no longer exist on disk. */
export function pruneRecents(existing: string[]) {
  const keep = new Set(existing);
  save(load().filter((p) => keep.has(p)));
}
