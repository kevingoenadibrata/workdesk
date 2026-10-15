import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** How often to look for a new GitHub release while the app is open. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** Let startup settle before the first check. */
const FIRST_CHECK_MS = 5000;

let toast: HTMLElement | null = null;
let busy = false;
/** Versions the user said "Later" to; background checks don't bring them up again. */
const dismissed = new Set<string>();
/** Set once an update is installed; it takes effect on the next launch. */
let installed: string | null = null;
let restartGuard: () => Promise<boolean> = async () => true;

/**
 * Checks GitHub Releases for a newer Workdesk on launch and every few hours,
 * and offers to install it. Installing swaps the app bundle but never restarts
 * by itself: `confirmRestart` runs first, so running commands aren't lost.
 */
export function installUpdater(confirmRestart: () => Promise<boolean>) {
  restartGuard = confirmRestart;
  if (import.meta.env.DEV) return;
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
}

/** `manual` is the menu item: it also reports "up to date" and errors. */
export async function checkForUpdates(manual: boolean) {
  if (busy) return;
  if (installed) return showInstalled(installed);
  busy = true;
  if (manual) show("Checking for updates…", []);
  try {
    const update = await check();
    if (!update) {
      if (manual) flash(`You're up to date (${await getVersion()}).`);
    } else if (manual || !dismissed.has(update.version)) {
      offer(update);
    }
  } catch (e) {
    if (manual) flash(`Couldn't check for updates: ${e}`);
  } finally {
    busy = false;
  }
}

function offer(update: Update) {
  show(`Workdesk ${update.version} is available.`, [
    { label: "Later", action: () => (dismissed.add(update.version), hide()) },
    { label: "Install", primary: true, action: () => void install(update) },
  ]);
}

async function install(update: Update) {
  busy = true;
  let total = 0;
  let got = 0;
  show("Downloading update…", []);
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        got += event.data.chunkLength;
        if (total) setText(`Downloading update… ${Math.round((got / total) * 100)}%`);
      } else setText("Installing update…");
    });
    installed = update.version;
    showInstalled(update.version);
  } catch (e) {
    flash(`Update failed: ${e}`);
  } finally {
    busy = false;
  }
}

function showInstalled(version: string) {
  show(`Workdesk ${version} is installed. Restart to use it.`, [
    { label: "Later", action: hide },
    {
      label: "Restart",
      primary: true,
      action: async () => {
        hide();
        if (await restartGuard()) await relaunch();
      },
    },
  ]);
}

type Button = { label: string; primary?: boolean; action: () => void };

function show(text: string, buttons: Button[]) {
  hide();
  toast = document.createElement("div");
  toast.className = "update-toast";
  toast.setAttribute("role", "status");
  const p = Object.assign(document.createElement("p"), { className: "update-text", textContent: text });
  toast.append(p);
  if (buttons.length) {
    const row = Object.assign(document.createElement("div"), { className: "confirm-buttons" });
    for (const b of buttons) {
      const el = Object.assign(document.createElement("button"), {
        className: "confirm-button" + (b.primary ? " primary" : ""),
        textContent: b.label,
      });
      el.addEventListener("click", b.action);
      row.append(el);
    }
    toast.append(row);
  }
  document.body.append(toast);
}

function setText(text: string) {
  const p = toast?.querySelector(".update-text");
  if (p) p.textContent = text;
}

/** A message that dismisses itself. */
function flash(text: string) {
  show(text, []);
  const mine = toast;
  setTimeout(() => toast === mine && hide(), 4000);
}

function hide() {
  toast?.remove();
  toast = null;
}
