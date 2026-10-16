import { isConfirmOpen } from "./closeGuard";
const IS_MAC = navigator.platform.toLowerCase().includes("mac");

/** How the "mod" key is shown in the UI. */
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl+";

/** ⌘-click on macOS, Ctrl-click elsewhere. */
export function isModClick(e: MouseEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

export type Action =
  | "newTab"
  | "newTabIn"
  | "openHome"
  | "openSettings"
  | "openShortcuts"
  | "openMonitor"
  | "openServers"
  | "openTickets"
  | "searchTabs"
  | "closeTab"
  | "splitRight"
  | "splitDown"
  | "unsplit"
  | "focusPaneLeft"
  | "focusPaneRight"
  | "focusPaneUp"
  | "focusPaneDown"
  | "nextPane"
  | "prevPane"
  | "newGroup"
  | "groupSelected"
  | "ungroupSelected"
  | "nextTab"
  | "prevTab"
  | "renameTab"
  | "toggleSidebar"
  | "collapseSidebar"
  | "selectAll"
  | "clear"
  | "findInTerminal"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "maximizePane"
  | "arrangePanes"
  | "toggleFileTree"
  | `goToTab${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

/**
 * Key combo → action. "mod" is ⌘ on macOS and Ctrl elsewhere. Keys are
 * physical (US layout), so "mod+shift+]" works regardless of what Shift+]
 * types. Rebinding on the Shortcuts page layers overrides on top; see keymap().
 */
export const DEFAULT_KEYMAP: Record<string, Action> = {
  "mod+t": "newTab",
  "mod+shift+t": "newTabIn",
  "mod+shift+h": "openHome",
  "mod+,": "openSettings",
  "mod+/": "openShortcuts",
  "mod+shift+m": "openMonitor",
  "mod+shift+l": "openServers",
  "mod+shift+i": "openTickets",
  "mod+f": "searchTabs",
  "mod+w": "closeTab",
  "mod+d": "splitRight",
  "mod+shift+d": "splitDown",
  "mod+shift+u": "unsplit",
  "mod+shift+enter": "maximizePane",
  "mod+l": "arrangePanes",
  "mod+e": "toggleFileTree",
  "mod+alt+arrowleft": "focusPaneLeft",
  "mod+alt+arrowright": "focusPaneRight",
  "mod+alt+arrowup": "focusPaneUp",
  "mod+alt+arrowdown": "focusPaneDown",
  "mod+]": "nextPane",
  "mod+[": "prevPane",
  "mod+g": "groupSelected",
  "mod+shift+g": "ungroupSelected",
  "mod+shift+]": "nextTab",
  "mod+shift+[": "prevTab",
  "ctrl+tab": "nextTab",
  "ctrl+shift+tab": "prevTab",
  "mod+shift+r": "renameTab",
  "mod+b": "toggleSidebar",
  "mod+s": "collapseSidebar",
  "mod+a": "selectAll",
  "mod+k": "clear",
  "mod+shift+f": "findInTerminal",
  "mod+=": "zoomIn",
  "mod+shift+=": "zoomIn",
  "mod+-": "zoomOut",
  "mod+0": "resetZoom",
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`mod+${n}`, `goToTab${n}`])),
};

/** What each action does, grouped for the Shortcuts page. Order here is display order. */
export const SHORTCUT_SECTIONS: { title: string; actions: [Action, string][] }[] = [
  {
    title: "Tabs",
    actions: [
      ["newTab", "New tab in the current folder"],
      ["newTabIn", "Teleport to another folder"],
      ["closeTab", "Close pane or tab"],
      ["renameTab", "Rename tab"],
      ["searchTabs", "Search tabs"],
      ["nextTab", "Next tab"],
      ["prevTab", "Previous tab"],
      ["goToTab1", "Go to tab 1–8, or 9 for the last"],
    ],
  },
  {
    title: "Panes",
    actions: [
      ["splitRight", "Split right"],
      ["splitDown", "Split down"],
      ["unsplit", "Unsplit into tabs"],
      ["maximizePane", "Maximize or restore pane"],
      ["arrangePanes", "Change layout and rearrange panes"],
      ["toggleFileTree", "Show or hide the pane's file tree"],
      ["nextPane", "Next pane"],
      ["prevPane", "Previous pane"],
      ["focusPaneLeft", "Focus pane to the left"],
      ["focusPaneRight", "Focus pane to the right"],
      ["focusPaneUp", "Focus pane above"],
      ["focusPaneDown", "Focus pane below"],
    ],
  },
  {
    title: "Groups",
    actions: [
      ["groupSelected", "Group selected tabs"],
      ["ungroupSelected", "Ungroup selected tabs"],
    ],
  },
  {
    title: "Terminal",
    actions: [
      ["findInTerminal", "Find in terminal"],
      ["clear", "Clear"],
      ["selectAll", "Select all"],
      ["zoomIn", "Bigger text"],
      ["zoomOut", "Smaller text"],
      ["resetZoom", "Default text size"],
    ],
  },
  {
    title: "Window",
    actions: [
      ["toggleSidebar", "Show or hide sidebar"],
      ["collapseSidebar", "Collapse sidebar to icons"],
      ["openHome", "Open Home"],
      ["openMonitor", "Open Agent Monitor"],
      ["openServers", "Open Local Servers"],
      ["openTickets", "Open Tickets"],
      ["openShortcuts", "Shortcuts"],
      ["openSettings", "Settings"],
    ],
  },
];

const KEY_LABELS: Record<string, string> = IS_MAC
  ? { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" }
  : { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
const NAMED_KEYS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  tab: IS_MAC ? "⇥" : "Tab",
  enter: IS_MAC ? "↩" : "Enter",
  backspace: IS_MAC ? "⌫" : "Backspace",
  delete: IS_MAC ? "⌦" : "Delete",
  escape: "Esc",
  space: "Space",
};

/** A combo as the keys to press, e.g. "mod+shift+t" → ["⌘", "⇧", "T"]. */
export function comboKeys(combo: string): string[] {
  return normalize(combo)
    .split("+")
    .map((k) => KEY_LABELS[k] ?? NAMED_KEYS[k] ?? k.toUpperCase());
}

/** Every combo bound to `action`, in keymap order. */
export function combosFor(keymap: Record<string, Action>, action: Action): string[] {
  return Object.entries(keymap)
    .filter(([, a]) => a === action)
    .map(([combo]) => combo);
}

const MODIFIERS = ["ctrl", "mod", "alt", "shift"];

// ---- the live keymap: defaults plus what was rebound on the Shortcuts page ----

const KEYMAP_KEY = "workdesk.keymap";

/** Every action, from the default keymap (each has at least one default combo). */
const DEFAULT_ACTIONS = Object.fromEntries(Object.values(DEFAULT_KEYMAP).map((a) => [a, true]));

/** Actions rebound by the user, each to its full list of combos (empty means unbound). */
let overrides: Partial<Record<Action, string[]>> = loadOverrides();
let current: Record<string, Action> = build();
const keymapListeners = new Set<() => void>();
/** True while the Shortcuts page records a combo, so pressing it doesn't run anything. */
let suspended = false;

function loadOverrides(): Partial<Record<Action, string[]>> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEYMAP_KEY) ?? "{}");
    const out: Partial<Record<Action, string[]>> = {};
    for (const [action, combos] of Object.entries(raw ?? {})) {
      if (action in DEFAULT_ACTIONS && Array.isArray(combos)) {
        out[action as Action] = combos.filter((c): c is string => typeof c === "string").map(normalize);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function build(): Record<string, Action> {
  const map: Record<string, Action> = {};
  for (const [combo, action] of Object.entries(DEFAULT_KEYMAP)) if (!(action in overrides)) map[normalize(combo)] = action;
  for (const [action, combos] of Object.entries(overrides) as [Action, string[]][]) for (const c of combos) map[c] = action;
  return map;
}

function commit() {
  // Overrides that match the defaults again are dropped, so later default changes still reach them.
  for (const [action, combos] of Object.entries(overrides) as [Action, string[]][]) {
    if (sameCombos(combos, defaultCombos(action))) delete overrides[action];
  }
  try {
    localStorage.setItem(KEYMAP_KEY, JSON.stringify(overrides));
  } catch {
    // Applies for this session only.
  }
  current = build();
  for (const fn of keymapListeners) fn();
}

function defaultCombos(action: Action): string[] {
  return combosFor(DEFAULT_KEYMAP, action).map(normalize);
}

function sameCombos(a: string[], b: string[]) {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/** Combo → action as currently bound. Keys are normalized combos. */
export function keymap(): Record<string, Action> {
  return current;
}

export function onKeymapChange(fn: () => void) {
  keymapListeners.add(fn);
}

/** Whether `action` is bound differently from the default. */
export function isRebound(action: Action): boolean {
  return action in overrides;
}

/** Takes `combo` away from whichever action other than `keep` has it. */
function release(combo: string, keep: Action) {
  const holder = current[combo];
  if (holder && holder !== keep) overrides[holder] = combosFor(current, holder).filter((c) => c !== combo);
}

/** Makes `combo` the only binding of `action`; returns the action it was taken from, if any. */
export function rebind(action: Action, combo: string): Action | undefined {
  combo = normalize(combo);
  const holder = current[combo];
  release(combo, action);
  overrides[action] = [combo];
  commit();
  return holder !== action ? holder : undefined;
}

/** Leaves `action` with no key binding. */
export function unbind(action: Action) {
  overrides[action] = [];
  commit();
}

/** Puts `action` back on its default combos, taking them from any action that has them now. */
export function resetBinding(action: Action) {
  for (const combo of defaultCombos(action)) release(combo, action);
  delete overrides[action];
  commit();
}

export function resetAllBindings() {
  overrides = {};
  commit();
}

/** Turns shortcut handling off while a new combo is being recorded. */
export function suspendShortcuts(on: boolean) {
  suspended = on;
}

/** Combos the app menu or text editing needs; binding them would break copy, paste or quit. */
const RESERVED = new Set(["mod+c", "mod+v", "mod+x", "mod+q", "mod+h", "mod+alt+h", "mod+m", "mod+z", "mod+shift+z"].map(normalize));

/** Why `combo` can't be a shortcut, or null if it can. */
export function bindingProblem(combo: string): string | null {
  const parts = normalize(combo).split("+");
  const key = parts[parts.length - 1];
  if (RESERVED.has(normalize(combo))) return "That one is taken by the app menu or text editing.";
  const hasModifier = parts.some((p) => p === "mod" || p === "ctrl" || p === "alt");
  if (!hasModifier && !/^f\d{1,2}$/.test(key)) {
    return `Include ${IS_MAC ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"} so the shortcut doesn't get in the way of typing.`;
  }
  return null;
}

/** The combo a key press makes, or null for a press of a modifier on its own. */
export function comboIfComplete(e: KeyboardEvent): string | null {
  return ["Meta", "Control", "Alt", "Shift"].includes(e.key) ? null : comboFromEvent(e);
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Backslash: "\\",
};

function keyFromCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return CODE_KEYS[code] ?? code.toLowerCase();
}

export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  // On macOS ⌘ is "mod" and Ctrl stays Ctrl; elsewhere Ctrl is "mod".
  if (e.ctrlKey) parts.push(IS_MAC ? "ctrl" : "mod");
  if (e.metaKey && IS_MAC) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(keyFromCode(e.code));
  return parts.join("+");
}

function normalize(combo: string): string {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  return [...MODIFIERS.filter((m) => parts.includes(m)), key].join("+");
}

/** Combos text fields need for editing, so they never trigger app shortcuts there. */
const TEXT_EDITING = new Set(
  ["mod+c", "mod+v", "mod+x", "mod+z", "mod+shift+z", "mod+backspace", "alt+backspace"]
    .concat(["arrowleft", "arrowright", "arrowup", "arrowdown"].flatMap((k) => [`mod+${k}`, `mod+shift+${k}`, `alt+${k}`, `alt+shift+${k}`]))
    .map(normalize),
);

const HOLD_DELAY_MS = 500;

/**
 * Holding the mod key on its own (⌘ on macOS) for a moment adds `show-hints`
 * to <body>, revealing shortcut hints that are otherwise hidden. Pressing any
 * other key first means a shortcut is being typed, so nothing shows.
 */
export function installHoldHints() {
  const modKey = IS_MAC ? "Meta" : "Control";
  let timer: number | undefined;
  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    document.body.classList.remove("show-hints");
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === modKey && !e.repeat && !e.shiftKey && !e.altKey) {
        clearTimeout(timer);
        timer = window.setTimeout(() => document.body.classList.add("show-hints"), HOLD_DELAY_MS);
      } else if (e.key !== modKey) {
        // A shortcut in progress: cancel a pending reveal, keep hints already showing.
        clearTimeout(timer);
        timer = undefined;
      }
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key === modKey) hide();
    },
    true,
  );
  window.addEventListener("blur", hide);
}

export function installShortcuts(handlers: Record<Action, () => void>) {
  // Capture phase on window runs before xterm sees the key, so bound combos
  // never reach the shell.
  window.addEventListener(
    "keydown",
    (e) => {
      if (suspended || isConfirmOpen()) return;
      const combo = comboFromEvent(e);
      // xterm takes keys through a hidden textarea; only real text fields count.
      const field =
        e.target instanceof HTMLInputElement ||
        (e.target instanceof HTMLTextAreaElement && !e.target.classList.contains("xterm-helper-textarea"));
      if (field) {
        // The native menu has no Select All (it would fight xterm's), so text
        // fields don't get ⌘A for free.
        if (combo === "mod+a") {
          e.preventDefault();
          (e.target as HTMLInputElement | HTMLTextAreaElement).select();
          return;
        }
        // Fields on Settings/Shortcuts keep app shortcuts (⌘1, ⌘/…) but not
        // the keys that edit text. Teleport and rename inputs keep everything.
        const onPage = (e.target as Element).closest(".page") != null;
        if (!onPage || TEXT_EDITING.has(combo)) return;
      }
      const action = current[combo];
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      handlers[action]();
    },
    true,
  );
}
