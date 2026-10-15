export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * A full page shown in place of the terminals (Settings, Shortcuts). Only one
 * is open at a time; while one is, no tab is active in the sidebar. Esc goes
 * back to the terminals.
 */
export abstract class Page {
  private static open_: Page | null = null;
  private static listeners = new Set<() => void>();
  private root: HTMLElement | null = null;

  constructor(private host: HTMLElement) {}

  /** The open page, if any. */
  static get current(): Page | null {
    return Page.open_;
  }

  /** Called whenever a page opens or closes. */
  static onChange(fn: () => void) {
    Page.listeners.add(fn);
  }

  /** Goes back to the terminals. */
  static closeAll() {
    Page.open_?.close();
  }

  private static set(page: Page | null) {
    Page.open_ = page;
    for (const fn of Page.listeners) fn();
  }

  /** Shown as the page heading and in the title bar. */
  abstract readonly title: string;

  /** Fills the page; returns the element to focus first, or null to focus the page itself. */
  protected abstract build(body: HTMLElement): HTMLElement | null;

  get isOpen() {
    return this.root != null;
  }

  toggle() {
    if (this.root) this.close();
    else this.open();
  }

  open() {
    if (this.root) return;
    Page.open_?.remove();

    const root = el("div", "page");
    // Focusable so Esc works on pages with nothing to type into.
    root.tabIndex = -1;
    const body = el("div", "page-body");
    body.append(el("h1", "page-title", this.title));
    root.append(body);
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      this.close();
    });
    this.host.append(root);
    this.root = root;
    Page.set(this);
    (this.build(body) ?? root).focus();
  }

  close() {
    if (!this.remove()) return;
    Page.set(null);
  }

  /** Takes the page out of the DOM; false if it wasn't open. */
  private remove() {
    if (!this.root) return false;
    this.root.remove();
    this.root = null;
    return true;
  }
}
