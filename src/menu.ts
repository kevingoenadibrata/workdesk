import { kbdFor } from "./kbd";
import { icon as iconSvg } from "./icons";
import type { IconNode } from "lucide";
import type { Action } from "./shortcuts";

export type MenuItem =
  | { label: string; shortcut?: Action; color?: string; icon?: IconNode; title?: string; danger?: boolean; action: () => void }
  | { heading: string }
  | { separator: true }
  | { swatches: { color: string; selected: boolean; action: () => void }[] };

let current: HTMLElement | null = null;

export function closeMenu() {
  current?.remove();
  current = null;
}

export function isMenuOpen() {
  return current != null;
}

export function showMenu(x: number, y: number, items: MenuItem[]): HTMLElement {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu";

  for (const item of items) {
    if ("separator" in item) {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-sep" }));
    } else if ("heading" in item) {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-heading", textContent: item.heading }));
    } else if ("swatches" in item) {
      const row = document.createElement("div");
      row.className = "menu-swatches";
      for (const s of item.swatches) {
        const b = document.createElement("button");
        b.className = "swatch" + (s.selected ? " selected" : "");
        b.style.setProperty("--swatch", s.color);
        b.addEventListener("click", () => {
          closeMenu();
          s.action();
        });
        row.append(b);
      }
      menu.append(row);
    } else {
      const b = document.createElement("button");
      b.className = "menu-item" + (item.danger ? " danger" : "");
      if (item.color) {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = item.color;
        b.append(dot);
      }
      if (item.icon) b.append(iconSvg(item.icon, 14, "menu-icon"));
      if (item.title) b.title = item.title;
      b.append(Object.assign(document.createElement("span"), { className: "menu-label", textContent: item.label }));
      if (item.shortcut) b.append(kbdFor(item.shortcut));
      b.addEventListener("click", () => {
        closeMenu();
        item.action();
      });
      menu.append(b);
    }
  }

  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  current = menu;
  return menu;
}

window.addEventListener(
  "mousedown",
  (e) => {
    if (current && !current.contains(e.target as Node)) closeMenu();
  },
  true,
);
window.addEventListener(
  "keydown",
  (e) => {
    if (current && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeMenu();
    }
  },
  true,
);
window.addEventListener("blur", closeMenu);
