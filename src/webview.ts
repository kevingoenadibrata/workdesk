import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Native webviews for browser panes, kept over their placeholders.
 *
 * A browser pane's page is a real webview of its own (Tauri multiwebview),
 * not an iframe: iframes can't show most sites (X-Frame-Options / CSP
 * frame-ancestors) and can't see where a page navigates. The catch is that a
 * native view always draws over Workdesk's DOM, so it has to follow its
 * placeholder around and get out of the way of anything drawn on top: pages
 * (Home, Settings), pickers, menus, modals, drags and divider resizes. Rather
 * than have every overlay know about browsers, each placeholder is
 * hit-tested: if any of a grid of points over it lands on something else, the
 * webview hides until it's clear again.
 */

export type BrowserEvent =
  | { kind: "load"; label: string; url: string; loading: boolean }
  | { kind: "url"; label: string; url: string }
  | { kind: "title"; label: string; title: string }
  | { kind: "focus"; label: string }
  | { kind: "key"; label: string; combo: string };

export interface NativeViewHooks {
  onEvent(e: BrowserEvent): void;
}

let nextId = 1;
const views = new Map<string, NativeView>();
/** The view whose page has keyboard focus, if a page has it rather than Workdesk. */
let pageFocus: NativeView | null = null;
let dragging = false;
let keyHandler: (combo: string) => void = () => {};

/** One pane's webview, created on its first navigation. */
export class NativeView {
  readonly label = `browser-${nextId++}`;
  private created: Promise<void> | null = null;
  /** The bounds and visibility last sent, so unchanged frames send nothing. */
  private placed = "";
  private closed = false;
  private resize = new ResizeObserver(() => scheduleSync());

  constructor(
    /** The element the page sits over. */
    readonly placeholder: HTMLElement,
    private hooks: NativeViewHooks,
  ) {
    views.set(this.label, this);
    this.resize.observe(placeholder);
  }

  get isOpen(): boolean {
    return this.created != null;
  }

  /** Whether the page is on screen (open, and nothing over it). */
  get shown(): boolean {
    return this.placed !== "" && this.placed !== "hidden";
  }

  navigate(url: string): Promise<void> {
    if (this.created) return this.created.then(() => invoke("browser_navigate", { label: this.label, url }));
    const { rect, visible } = this.measure();
    this.placed = key(rect, visible);
    this.created = invoke<void>("browser_open", { label: this.label, url, ...rect, visible }).catch((e) => {
      this.created = null;
      this.placed = "";
      throw e;
    });
    return this.created;
  }

  go(delta: number) {
    if (this.created) void this.created.then(() => invoke("browser_go", { label: this.label, delta })).catch(() => {});
  }

  reload() {
    if (this.created) void this.created.then(() => invoke("browser_reload", { label: this.label })).catch(() => {});
  }

  /** Gives the page keyboard focus. */
  focus() {
    if (!this.created) return;
    pageFocus = this;
    void this.created.then(() => invoke("browser_focus", { label: this.label })).catch(() => {});
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    views.delete(this.label);
    this.resize.disconnect();
    if (pageFocus === this) pageFocus = null;
    if (this.created) void this.created.then(() => invoke("browser_close", { label: this.label })).catch(() => {});
  }

  /** Where the placeholder is, and whether the page may show there. */
  private measure(): { rect: { x: number; y: number; width: number; height: number }; visible: boolean } {
    const r = this.placeholder.getBoundingClientRect();
    const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    const visible = rect.width > 8 && rect.height > 8 && !blocked() && uncovered(this.placeholder, r);
    return { rect, visible };
  }

  sync() {
    if (!this.created || this.closed) return;
    const { rect, visible } = this.measure();
    const k = key(rect, visible);
    if (k === this.placed) return;
    this.placed = k;
    // A covered page can't keep the keyboard: whatever covers it should get the keys.
    if (!visible && pageFocus === this) reclaimFocus();
    void this.created.then(() => invoke("browser_place", { label: this.label, ...rect, visible })).catch(() => {});
  }

  /** Called with what the page reports. */
  handle(e: BrowserEvent) {
    if (e.kind === "focus") pageFocus = this;
    if (e.kind === "key") keyHandler(e.combo);
    else this.hooks.onEvent(e);
  }
}

const key = (r: { x: number; y: number; width: number; height: number }, visible: boolean) =>
  visible ? `${r.x},${r.y},${r.width},${r.height}` : "hidden";

/** Divider resizes and drags need the mouse to reach Workdesk, so pages stand aside meanwhile. */
function blocked(): boolean {
  const body = document.body.classList;
  return dragging || body.contains("resizing") || body.contains("resizing-rows");
}

/** Whether nothing is drawn over `el`: a 3×3 grid of points across it all hit it. */
function uncovered(el: HTMLElement, r: DOMRect): boolean {
  const inset = 4;
  const xs = [r.left + inset, r.left + r.width / 2, r.right - inset];
  const ys = [r.top + inset, r.top + r.height / 2, r.bottom - inset];
  for (const x of xs) {
    for (const y of ys) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) return false;
    }
  }
  return true;
}

let syncQueued = false;
function scheduleSync() {
  if (syncQueued || views.size === 0) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    for (const v of views.values()) v.sync();
  });
}

/**
 * Takes keyboard focus back from a page, so keys reach Workdesk again. Focusing
 * a DOM element isn't enough: the page's webview stays first responder.
 */
export function reclaimFocus() {
  if (!pageFocus) return;
  pageFocus = null;
  void invoke("browser_focus_main").catch(() => {});
}

/** Runs Workdesk shortcuts pressed inside a page. */
export function onPageShortcut(fn: (combo: string) => void) {
  keyHandler = fn;
}

/** Tells pages which combos are Workdesk's, so they pass those on instead of acting on them. */
export function setPageShortcuts(combos: string[]) {
  void invoke("browser_set_keys", { keys: combos }).catch(() => {});
}

// Anything that changes what's on screen might uncover or cover a page.
new MutationObserver(scheduleSync).observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["class", "hidden", "style", "open"],
});
window.addEventListener("resize", scheduleSync);
for (const type of ["dragstart", "dragend", "drop"]) {
  document.addEventListener(
    type,
    () => {
      dragging = type === "dragstart";
      scheduleSync();
    },
    true,
  );
}
// A drag whose source vanished never sends dragend; the next mouse move means it's over.
document.addEventListener("mousemove", () => {
  if (!dragging) return;
  dragging = false;
  scheduleSync();
});
// Clicking back into Workdesk makes its own webview first responder again.
window.addEventListener("focus", () => {
  pageFocus = null;
});
void listen<BrowserEvent>("browser", ({ payload }) => views.get(payload.label)?.handle(payload));
