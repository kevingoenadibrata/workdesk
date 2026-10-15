import { comboKeys, combosFor, keymap, onKeymapChange, type Action } from "./shortcuts";

/**
 * The one way shortcuts are shown in the UI: each key a small flat chip, keys
 * of a combo side by side (after shadcn's Kbd / KbdGroup).
 */
export function kbdKeys(keys: string[]): HTMLElement {
  const group = document.createElement("kbd");
  group.className = "kbd-group";
  for (const key of keys) {
    const chip = document.createElement("kbd");
    chip.className = "kbd";
    chip.textContent = key;
    group.append(chip);
  }
  return group;
}

/** A combo string such as "mod+shift+t". */
export function kbd(combo: string): HTMLElement {
  return kbdKeys(comboKeys(combo));
}

/**
 * The first key binding of `action`, so the UI always shows the real binding.
 * Stays current: rebinding the action redraws it wherever it's shown.
 */
export function kbdFor(action: Action): HTMLElement {
  const [combo] = combosFor(keymap(), action);
  const group = combo ? kbd(combo) : kbdKeys([]);
  group.dataset.action = action;
  return group;
}

onKeymapChange(() => {
  for (const group of document.querySelectorAll<HTMLElement>("kbd.kbd-group[data-action]")) {
    group.replaceWith(kbdFor(group.dataset.action as Action));
  }
});
