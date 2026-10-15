import { invoke } from "@tauri-apps/api/core";

/** The Dock icon variants, in the order Settings shows them. Rendered by `branding/build.mjs`. */
export const APP_ICONS = [
  ["classic", "Classic"],
  ["light", "Light"],
  ["copper", "Copper"],
  ["ember", "Ember"],
  ["midnight", "Midnight"],
  ["forest", "Forest"],
  ["ocean", "Ocean"],
  ["sunset", "Sunset"],
  ["graphite", "Graphite"],
  ["phosphor", "Phosphor"],
] as const;
export type AppIcon = (typeof APP_ICONS)[number][0];
const KEY = "workdesk.appIcon";

export function currentAppIcon(): AppIcon {
  try {
    const id = localStorage.getItem(KEY);
    if (APP_ICONS.some(([other]) => other === id)) return id as AppIcon;
  } catch {}
  return "classic";
}

/** A variant's preview image, served from `public/app-icons`. */
export function appIconUrl(id: AppIcon) {
  return `/app-icons/${id}.png`;
}

/** Shows `id` in the Dock and remembers it for the next launch. */
export function setAppIcon(id: AppIcon) {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  void invoke("set_app_icon", { id }).catch(() => {});
}

/** macOS puts the bundle's icon back each launch, so swap in the picked one. */
export function applyAppIcon() {
  const id = currentAppIcon();
  if (id !== "classic") void invoke("set_app_icon", { id }).catch(() => {});
}
