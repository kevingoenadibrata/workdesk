import "./styles.css";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadTheme, onThemeChange } from "./themes";
import { Onboarding } from "./onboarding";

declare global {
  interface Window {
    /** How far the menu bar and Dock reach in from each edge, in px; set by the window's opener. */
    __SAFE_AREA?: { top: number; right: number; bottom: number; left: number };
  }
}

// The tour's own window (see src-tauri/src/onboarding.rs), laid over the whole
// display. A theme picked here repaints the app underneath as well.
loadTheme();
for (const [edge, px] of Object.entries(window.__SAFE_AREA ?? {})) {
  document.documentElement.style.setProperty(`--safe-${edge}`, `${Math.max(0, px)}px`);
}
onThemeChange((theme) => void emitTo("main", "theme-changed", theme.name));

new Onboarding(() => {
  void emitTo("main", "onboarding-closed").finally(() => void getCurrentWindow().close());
}).open();
