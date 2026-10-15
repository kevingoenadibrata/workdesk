import { homeDir } from "./recents";

const KEY = "workdesk.favoriteDirs";

/** Absolute, without a trailing slash; "~" expands to home. */
export function normalizePath(path: string): string {
  let p = path.trim();
  const home = homeDir();
  if (home && (p === "~" || p.startsWith("~/"))) p = home + p.slice(1);
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Favorite destinations, in the order Teleport lists them. May hold blanks while being edited in Settings. */
export function loadFavorites(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveFavorites(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable; favorites just won't persist.
  }
}

/** Usable favorites: non-blank and deduplicated, first one wins. */
export function favoriteDirs(): string[] {
  const paths = loadFavorites().map(normalizePath).filter(Boolean);
  return paths.filter((p, i) => paths.indexOf(p) === i);
}

/** Adds `dir` to the end of the favorites, or removes it. Returns whether it's now a favorite. */
export function toggleFavorite(dir: string): boolean {
  const path = normalizePath(dir);
  const list = loadFavorites();
  const kept = list.filter((p) => normalizePath(p) !== path);
  const added = kept.length === list.length;
  saveFavorites(added ? [...list, path] : kept);
  return added;
}

/** `path` with home shown as "~". */
export function tildePath(path: string): string {
  const home = homeDir();
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}
