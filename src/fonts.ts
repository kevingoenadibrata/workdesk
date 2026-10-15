const KEY = "workdesk.font";

/** How the terminals draw text. */
export interface FontSettings {
  /** A CSS font family; falls back to the platform monospace fonts. */
  family: string;
  size: number;
  lineHeight: number;
}

export const DEFAULT_FONT: FontSettings = { family: "JetBrains Mono", size: 13, lineHeight: 1.2 };
export const MIN_SIZE = 8;
export const MAX_SIZE = 32;
export const MIN_LINE_HEIGHT = 1;
export const MAX_LINE_HEIGHT = 2;

/** Offered in Settings; any installed font can still be typed in. */
export const SUGGESTED_FAMILIES = [
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "SF Mono",
  "Menlo",
  "Monaco",
  "IBM Plex Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "Hack",
  "Iosevka",
  "Courier New",
];

// Symbols Nerd Font supplies prompt icons (folders, git, …) that the chosen font lacks.
const FALLBACK = '"SF Mono", Menlo, Consolas, "Symbols Nerd Font Mono", monospace';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

let current = load();
const listeners = new Set<(f: FontSettings) => void>();

function load(): FontSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return { ...DEFAULT_FONT };
    return clean({ ...DEFAULT_FONT, ...raw });
  } catch {
    return { ...DEFAULT_FONT };
  }
}

function clean(f: FontSettings): FontSettings {
  const size = Number(f.size);
  const lineHeight = Number(f.lineHeight);
  return {
    family: typeof f.family === "string" ? f.family.trim() : DEFAULT_FONT.family,
    size: Number.isFinite(size) ? clamp(Math.round(size), MIN_SIZE, MAX_SIZE) : DEFAULT_FONT.size,
    lineHeight: Number.isFinite(lineHeight) ? clamp(Math.round(lineHeight * 20) / 20, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT) : DEFAULT_FONT.lineHeight,
  };
}

export function currentFont(): FontSettings {
  return current;
}

/** The family as xterm wants it: the chosen font first, then the platform's monospace fonts. */
export function fontStack(f: FontSettings = current): string {
  const name = f.family.replace(/["\\]/g, "");
  return name ? `"${name}", ${FALLBACK}` : FALLBACK;
}

/** Called with the new settings whenever they change. */
export function onFontChange(fn: (f: FontSettings) => void) {
  listeners.add(fn);
}

/** Applies and remembers a change to some of the font settings. */
export function setFont(change: Partial<FontSettings>) {
  const next = clean({ ...current, ...change });
  if (next.family === current.family && next.size === current.size && next.lineHeight === current.lineHeight) return;
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Applied, just not remembered.
  }
  for (const fn of listeners) fn(current);
}

/** ⌘+ / ⌘−: steps the text size by `delta` points. */
export function zoom(delta: number) {
  setFont({ size: current.size + delta });
}

export function resetZoom() {
  setFont({ size: DEFAULT_FONT.size });
}
