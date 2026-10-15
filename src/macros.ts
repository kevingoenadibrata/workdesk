const KEY = "workdesk.macros";

/** Commands typed into a new shell after Teleport opens it, one line each. */
export interface Macro {
  name: string;
  commands: string[];
}

const DEFAULTS: Macro[] = [{ name: "claude", commands: ["claude"] }];

/** Macro names are what follows "@", so they can't contain spaces or the "@" itself. */
export function cleanName(name: string): string {
  return name.replace(/[\s@]+/g, "").toLowerCase();
}

export function loadMacros(): Macro[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return DEFAULTS.map((m) => ({ ...m, commands: [...m.commands] }));
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((m) => m && typeof m.name === "string" && Array.isArray(m.commands))
      .map((m) => ({ name: m.name, commands: m.commands.filter((c: unknown) => typeof c === "string") }));
  } catch {
    return [];
  }
}

export function saveMacros(list: Macro[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable; macros just won't persist.
  }
}

/** The named macro, skipping half-written ones (no name or no commands). */
export function findMacro(name: string): Macro | undefined {
  const key = cleanName(name);
  // First one wins, matching what Settings flags as a duplicate.
  const macro = loadMacros().find((m) => m.name === key);
  return macro && runnable(macro).length > 0 ? macro : undefined;
}

/** Non-blank command lines. */
export function runnable(macro: Macro): string[] {
  return macro.commands.map((c) => c.trim()).filter(Boolean);
}
