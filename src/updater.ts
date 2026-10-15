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
  if (import.meta.env.DEV) {
    if (import.meta.env.VITE_MOCK_UPDATE) setTimeout(mockUpdate, 1500);
    return;
  }
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
}

/** `manual` is the menu item: it also reports "up to date" and errors. */
export async function checkForUpdates(manual: boolean) {
  if (busy) return;
  if (installed) return showInstalled(installed);
  busy = true;
  if (manual) note("Checking for updates…");
  try {
    const update = await check();
    if (!update) {
      if (manual) flash(`You're up to date on ${await getVersion()}.`);
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
  card({
    eyebrow: "Update available",
    version: update.version,
    meta: `You are on v${update.currentVersion}`,
    buttons: [
      { label: "Later", action: () => (dismissed.add(update.version), hide()) },
      { label: "Install", primary: true, action: () => void install(update) },
    ],
  });
}

/** Dev only (`VITE_MOCK_UPDATE=1`): walks the cards through a fake update. */
function mockUpdate() {
  const fake = {
    version: "9.9.9",
    currentVersion: "0.2.6",
    async downloadAndInstall(onEvent: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 120));
        onEvent({ event: "Progress", data: { chunkLength: 4 } });
      }
      onEvent({ event: "Finished" });
    },
  };
  offer(fake as unknown as Update);
}

async function install(update: Update) {
  busy = true;
  let total = 0;
  let got = 0;
  card({ eyebrow: "Downloading", version: update.version, meta: "Starting download…", progress: 0 });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        got += event.data.chunkLength;
        if (total) setProgress(got / total, `Downloading… ${Math.round((got / total) * 100)}%`);
      } else setProgress(1, "Installing…");
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
  card({
    eyebrow: "Installed",
    version,
    meta: "Restart Workdesk to start using it",
    buttons: [
      { label: "Later", action: hide },
      {
        label: "Restart",
        primary: true,
        action: async () => {
          hide();
          if (import.meta.env.DEV) return void setTimeout(mockUpdate, 1500);
          if (await restartGuard()) await relaunch();
        },
      },
    ],
  });
}

type Button = { label: string; primary?: boolean; action: () => void };
type Card = {
  eyebrow: string;
  version: string;
  meta: string;
  buttons?: Button[];
  /** 0–1; shows a progress bar in place of the buttons. */
  progress?: number;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Cards sit in the sidebar just above its footer (beside the rail when it's
 * collapsed), or in the window's corner when the sidebar is hidden.
 */
function mount(node: HTMLElement) {
  const sidebar = document.getElementById("sidebar");
  const footer = sidebar?.querySelector(".sidebar-footer");
  if (sidebar && footer && !document.body.classList.contains("sidebar-hidden")) footer.before(node);
  else {
    node.classList.add("floating");
    document.body.append(node);
  }
}

function card(c: Card) {
  hide();
  const root = el("div", "update-card");
  root.setAttribute("role", "status");
  const face = el("div", "update-face");
  const top = el("div", "update-eyebrow");
  top.append(el("span", "update-dot"), c.eyebrow);
  face.append(top, el("div", "update-version", `v${c.version}`), el("p", "update-meta", c.meta));
  if (c.progress !== undefined) {
    const bar = el("div", "update-progress");
    bar.append(el("div", "update-progress-fill"));
    face.append(bar);
  }
  if (c.buttons?.length) {
    const row = el("div", "update-buttons");
    for (const b of c.buttons) {
      const btn = el("button", "update-button" + (b.primary ? " primary" : ""), b.label);
      btn.addEventListener("click", b.action);
      row.append(btn);
    }
    face.append(row);
  }
  root.append(el("div", "update-glow"), face, el("div", "update-foil"), el("div", "update-glare"));
  tilt(root);
  toast = root;
  mount(root);
  if (c.progress !== undefined) setProgress(c.progress);
}

/** A plain one-line card, for checking and results. */
function note(text: string) {
  hide();
  const root = el("div", "update-card note");
  root.setAttribute("role", "status");
  const face = el("div", "update-face");
  face.append(el("p", "update-meta", text));
  root.append(face);
  toast = root;
  mount(root);
}

/** The card leans toward the pointer and its foil follows it. */
function tilt(root: HTMLElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.addEventListener("pointermove", (e) => {
    const r = root.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    root.classList.add("tilting");
    root.style.setProperty("--px", `${x * 100}%`);
    root.style.setProperty("--py", `${y * 100}%`);
    root.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
    root.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
  });
  root.addEventListener("pointerleave", () => {
    root.classList.remove("tilting");
    for (const k of ["--px", "--py", "--rx", "--ry"]) root.style.removeProperty(k);
  });
}

function setProgress(fraction: number, text?: string) {
  toast?.style.setProperty("--progress", String(Math.min(1, Math.max(0, fraction))));
  const meta = toast?.querySelector(".update-meta");
  if (meta && text) meta.textContent = text;
}

/** A message that dismisses itself. */
function flash(text: string) {
  note(text);
  const mine = toast;
  setTimeout(() => toast === mine && hide(), 4000);
}

function hide() {
  const old = toast;
  toast = null;
  if (!old) return;
  old.classList.add("leaving");
  old.addEventListener("animationend", () => old.remove(), { once: true });
  setTimeout(() => old.remove(), 300);
}
