import { openUrl } from "@tauri-apps/plugin-opener";
import { TermSession } from "./terminal";
import { NativeView, reclaimFocus, type BrowserEvent } from "./webview";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw, icon } from "./icons";

/**
 * What was typed in the address bar as a URL: a bare port ("3000", ":3000")
 * or a localhost address is a local server over http, something with a dot
 * and no spaces is a site over https, and anything else is a search.
 */
export function toUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const port = /^:?(\d{2,5})(\/.*)?$/.exec(text);
  if (port) return `http://localhost:${port[1]}${port[2] ?? ""}`;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?([/?#].*)?$/i.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/**
 * A pane showing a web page: an address bar over a native webview. It splits,
 * moves, maximizes and saves like a shell pane, so a dev server's UI can sit
 * right beside the shell running it.
 */
export class BrowserPane extends TermSession {
  /** The page's address, saved with the layout. Empty until something's opened. */
  url: string;
  private pageTitle = "";
  private loading = false;
  private readonly view: NativeView;
  private readonly address: HTMLInputElement;
  private readonly reloadButton: HTMLButtonElement;
  private readonly empty: HTMLDivElement;

  constructor(host: HTMLElement, url = "") {
    super(host, "web");
    this.url = url;
    this.pane.classList.add("browser-pane");

    const bar = document.createElement("div");
    bar.className = "browser-bar";
    const button = (node: Parameters<typeof icon>[0], name: string, run: () => void) => {
      const b = document.createElement("button");
      b.className = "browser-button";
      b.type = "button";
      b.title = name;
      b.setAttribute("aria-label", name);
      b.append(icon(node, 14));
      b.addEventListener("click", run);
      return b;
    };
    this.address = document.createElement("input");
    this.address.className = "browser-address";
    this.address.type = "text";
    this.address.spellcheck = false;
    this.address.autocomplete = "off";
    this.address.placeholder = "Search or type a URL, or a port like 3000";
    this.address.setAttribute("aria-label", "Address");
    this.address.value = url;
    this.reloadButton = button(RefreshCw, "Reload (⌘R)", () => this.view.reload());
    bar.append(
      button(ArrowLeft, "Back", () => this.view.go(-1)),
      button(ArrowRight, "Forward", () => this.view.go(1)),
      this.reloadButton,
      this.address,
      button(ExternalLink, "Open in your browser", () => this.url && void openUrl(this.url)),
    );

    const stage = document.createElement("div");
    stage.className = "browser-stage";
    this.empty = document.createElement("div");
    this.empty.className = "browser-empty";
    const hint = document.createElement("p");
    hint.textContent = "Type a URL, a search, or the port of a local server.";
    this.empty.append(icon(Globe, 28), hint);
    stage.append(this.empty);
    this.body.replaceChildren(stage);
    this.pane.insertBefore(bar, this.body);
    this.view = new NativeView(stage, { onEvent: (e) => this.onPage(e) });

    this.pane.addEventListener("focusin", () => this.hooks.onFocus());
    this.address.addEventListener("focus", () => {
      reclaimFocus();
      this.address.select();
    });
    this.address.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const url = toUrl(this.address.value);
        if (url) void this.open(url, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.address.value = this.url;
        this.focus();
      }
    });
  }

  get title(): string {
    if (this.pageTitle) return this.pageTitle;
    try {
      return new URL(this.url).host || "Browser";
    } catch {
      return "Browser";
    }
  }

  /** Opens the saved page, or waits for an address. */
  async start() {
    if (this.url) await this.open(this.url, false);
  }

  /** Loads `url`; with `focus`, the page takes the keyboard once it's up. */
  async open(url: string, focus: boolean) {
    this.url = url;
    this.address.value = url;
    this.pageTitle = "";
    this.empty.hidden = true;
    this.hooks.onTitle();
    try {
      await this.view.navigate(url);
      if (focus) this.view.focus();
    } catch (e) {
      this.empty.hidden = false;
      this.empty.querySelector("p")!.textContent = String(e);
    }
  }

  private onPage(e: BrowserEvent) {
    switch (e.kind) {
      case "focus":
        this.hooks.onFocus();
        return;
      case "load":
        this.loading = e.loading;
        this.reloadButton.classList.toggle("loading", this.loading);
        this.setUrl(e.url);
        return;
      case "url":
        this.setUrl(e.url);
        return;
      case "title":
        this.pageTitle = e.title;
        this.hooks.onTitle();
        return;
    }
  }

  private setUrl(url: string) {
    if (!url || url === "about:blank") return;
    this.url = url;
    // Don't yank what's being typed.
    if (document.activeElement !== this.address) this.address.value = url;
    this.hooks.onTitle();
  }

  /** The page takes the keyboard if it's showing; else the address bar does. */
  focus() {
    if (this.view.shown) this.view.focus();
    else if (!this.view.isOpen) this.address.focus();
    else reclaimFocus();
  }

  reload() {
    this.view.reload();
  }

  dispose() {
    this.view.close();
    super.dispose();
  }
}
