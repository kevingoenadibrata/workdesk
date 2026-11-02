import { botSvg } from "./bot";

/** What the setup overlay says under its title. */
export interface SetupInfo {
  /** The ticket being handed over, like "WD-2", if there is one. */
  ticket?: string;
  /** The branch the session's worktree is on. */
  branch: string;
}

/** Not shown at all if setup is quicker than this, so a reused worktree doesn't flash it. */
const SHOW_AFTER = 120;
/** Once shown, it stays at least this long, so it reads as a step and not a glitch. */
const MIN_SHOWN = 550;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Covers the window with "Setting up your session…" while `work` runs
 * (fetching, making the worktree, starting Claude), so the wait has a face
 * instead of a frozen screen. Resolves or rejects with `work`.
 */
export async function withSetupOverlay<T>(info: SetupInfo, work: () => Promise<T>): Promise<T> {
  let shownAt = 0;
  let overlay: HTMLElement | null = null;
  const prevFocus = document.activeElement as HTMLElement | null;
  const show = () => {
    overlay = build(info);
    document.body.append(overlay);
    overlay.focus();
    shownAt = performance.now();
  };
  const timer = window.setTimeout(show, SHOW_AFTER);
  try {
    return await work();
  } finally {
    clearTimeout(timer);
    if (overlay) {
      const left = MIN_SHOWN - (performance.now() - shownAt);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      dismiss(overlay, prevFocus);
    }
  }
}

function build(info: SetupInfo): HTMLElement {
  const backdrop = el("div", "setup-backdrop");
  backdrop.tabIndex = -1;
  // Swallow keys and clicks: nothing behind should run while the session's set up.
  backdrop.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const card = el("div", "setup-card");
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-busy", "true");
  card.setAttribute("aria-labelledby", "setup-title");

  const avatar = el("div", "setup-avatar");
  avatar.innerHTML = botSvg("think");
  avatar.prepend(el("span", "setup-ring"), el("span", "setup-ring setup-ring-2"));

  const title = el("h2", "setup-title", "Setting up your session…");
  title.id = "setup-title";

  const meta = el("div", "setup-meta");
  if (info.ticket) meta.append(el("code", "setup-chip", info.ticket));
  meta.append(el("code", "setup-chip setup-branch", info.branch));

  const detail = el("p", "setup-detail", "Fetching the latest from origin and making a worktree, then starting Claude.");

  const bar = el("div", "setup-bar");
  bar.append(el("span", "setup-bar-fill"));

  card.append(avatar, title, meta, detail, bar);
  backdrop.append(card);
  return backdrop;
}

function dismiss(overlay: HTMLElement, prevFocus: HTMLElement | null) {
  overlay.classList.add("leaving");
  const gone = () => overlay.remove();
  overlay.addEventListener("animationend", gone, { once: true });
  setTimeout(gone, 300);
  // Only hand focus back if nothing new (like the session's terminal) took it.
  if (document.activeElement === overlay && prevFocus?.isConnected) prevFocus.focus();
}
