/** How many screen lines each Monitor card shows in its log box. */
export const DEFAULT_LOG_LINES = 3;
export const MIN_LOG_LINES = 1;
export const MAX_LOG_LINES = 10;
const KEY = "workdesk.monitorLogLines";

export function logLines(): number {
  try {
    const n = parseInt(localStorage.getItem(KEY) ?? "", 10);
    if (n >= MIN_LOG_LINES && n <= MAX_LOG_LINES) return n;
  } catch {}
  return DEFAULT_LOG_LINES;
}

export function setLogLines(n: number) {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {}
}
