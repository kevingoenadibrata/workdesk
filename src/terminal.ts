import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fileLinkProvider } from "./filelinks";
import { spawnPty, type PtyHandle } from "./pty";
import { homeDir } from "./recents";
import { ArrowDown, ArrowUp, CaseSensitive, Maximize2, Minimize2, Search, X, icon } from "./icons";
import { currentTheme, onThemeChange, type Theme } from "./themes";
import { currentFont, fontStack, onFontChange } from "./fonts";

/** Live sessions, so a theme or font change repaints every terminal. */
const sessions = new Set<TermSession>();
onThemeChange((theme) => {
  for (const s of sessions) {
    s.term.options.theme = theme.term;
    s.refreshFind();
  }
});
onFontChange((font) => {
  for (const s of sessions) {
    s.term.options.fontFamily = fontStack(font);
    s.term.options.fontSize = font.size;
    s.term.options.lineHeight = font.lineHeight;
    s.fit();
  }
});

/** `a` blended over `b` (both #rrggbb), as #rrggbb: search highlights can't take alpha. */
function blend(a: string, b: string, amount: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * amount + ch(b, i) * (1 - amount)).toString(16).padStart(2, "0")).join("");
}

function searchDecorations(t: Theme): ISearchOptions["decorations"] {
  const yellow = t.ansi[3];
  return {
    matchBackground: blend(yellow, t.bg, 0.3),
    matchOverviewRuler: yellow,
    activeMatchBackground: blend(t.accent, t.bg, 0.5),
    activeMatchBorder: t.accent,
    activeMatchColorOverviewRuler: t.accent,
  };
}

/** One xterm.js instance wired to one shell process. */
export class TermSession {
  /** The pane: a header (shown only in split tabs) above the terminal. */
  readonly pane: HTMLDivElement;
  /** Draggable strip naming the pane; drag it to rearrange the split or out to the sidebar. */
  readonly header: HTMLDivElement;
  private headerTitle: HTMLSpanElement;
  readonly el: HTMLDivElement;
  readonly term: Terminal;
  private fitAddon = new FitAddon();
  private searchAddon = new SearchAddon();
  private find?: { bar: HTMLDivElement; input: HTMLInputElement; count: HTMLSpanElement; caseButton: HTMLButtonElement };
  private caseSensitive = false;
  private maximizeButton: HTMLButtonElement;
  private pty?: PtyHandle;
  private disposed = false;

  /** Foreground process name, polled from the backend. */
  procName = "";
  /** Foreground process's working directory, polled from the backend. */
  cwd = "";
  /** The directory the shell was started in, until polling reports where it is. */
  startCwd = "";
  /** The macro the shell was started with, if any, so a loadout saved from this pane runs it again. */
  macro?: string;
  /** Share of the tab's width its column gets (kept the same on every pane in the column). */
  colWeight = 1;
  /** Share of its column's height. */
  rowWeight = 1;

  /** Set by the owning tab, and replaced when the pane moves to another tab. */
  hooks = { onExit() {}, onFocus() {}, onClose() {}, onMaximize() {}, onDragStart() {}, onDragEnd() {} };

  constructor(host: HTMLElement) {
    this.pane = document.createElement("div");
    this.pane.className = "pane";
    this.header = document.createElement("div");
    this.header.className = "pane-header";
    this.header.draggable = true;
    this.headerTitle = document.createElement("span");
    this.headerTitle.className = "pane-title";
    const close = document.createElement("button");
    close.className = "pane-close";
    close.title = "Close pane";
    close.append(icon(X, 12));
    this.maximizeButton = document.createElement("button");
    this.maximizeButton.className = "pane-maximize";
    this.setMaximized(false);
    this.header.append(this.headerTitle, this.maximizeButton, close);
    this.el = document.createElement("div");
    this.el.className = "term";
    this.pane.append(this.header, this.el);
    host.appendChild(this.pane);

    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onClose();
    });
    close.addEventListener("mousedown", (e) => e.stopPropagation());
    this.maximizeButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onMaximize();
    });
    this.maximizeButton.addEventListener("mousedown", (e) => e.stopPropagation());
    this.header.addEventListener("click", () => this.focus());
    this.header.addEventListener("dragstart", (e) => {
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", this.title);
      this.hooks.onDragStart();
    });
    this.header.addEventListener("dragend", () => this.hooks.onDragEnd());

    const font = currentFont();
    this.term = new Terminal({
      fontFamily: fontStack(font),
      fontSize: font.size,
      lineHeight: font.lineHeight,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: currentTheme().term,
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
    this.term.registerLinkProvider(fileLinkProvider(this.term, () => this.cwd || this.startCwd));
    this.term.loadAddon(this.searchAddon);
    this.term.open(this.el);
    try {
      const webgl = new WebglAddon();
      // WebKit caps live WebGL contexts; fall back to the DOM renderer if ours is evicted.
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
    } catch {
      // DOM renderer it is.
    }

    // Clicking into a split pane makes it the tab's focused pane.
    this.el.addEventListener("focusin", () => this.hooks.onFocus());
    this.term.onData((data) => this.pty?.write(data));
    this.term.attachCustomKeyEventHandler((e) => {
      // xterm.js sends a bare \r for Shift+Enter, indistinguishable from Enter. Send
      // ESC+CR (what Option+Enter sends) so TUIs like Claude Code insert a newline.
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.type === "keydown") this.pty?.write("\x1b\r");
        return false;
      }
      // xterm.js sends nothing for ⌘←/⌘→/⌘⌫. Send the readline line-editing keys
      // (Ctrl+A / Ctrl+E / Ctrl+U), as Terminal.app and iTerm2 do.
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const seq = { ArrowLeft: "\x01", ArrowRight: "\x05", Backspace: "\x15" }[e.key];
        if (seq) {
          if (e.type === "keydown") this.pty?.write(seq);
          return false;
        }
      }
      return true;
    });
    this.term.onResize(({ cols, rows }) => this.pty?.resize(cols, rows));
    sessions.add(this);
  }

  /** Name of the current folder ("~" for home), else the running program. */
  get title(): string {
    if (this.cwd) {
      const home = homeDir();
      if (this.cwd === home) return "~";
      return this.cwd === "/" ? "/" : this.cwd.slice(this.cwd.lastIndexOf("/") + 1);
    }
    return this.procName || "shell";
  }

  /** Refreshes the header's label from the current title. */
  updateHeader() {
    const title = this.title;
    if (this.headerTitle.textContent !== title) this.headerTitle.textContent = title;
  }

  /** Shows whether this pane fills its tab, on the header's toggle. */
  setMaximized(on: boolean) {
    const name = on ? "Restore pane" : "Maximize pane";
    this.maximizeButton.title = name;
    this.maximizeButton.setAttribute("aria-label", name);
    this.maximizeButton.replaceChildren(icon(on ? Minimize2 : Maximize2, 11));
  }

  // ---- find ----

  /** Opens the find bar over this terminal (prefilled with a one-line selection), or refocuses it. */
  openFind() {
    const find = this.find ?? this.buildFind();
    const selection = this.term.getSelection();
    if (selection && !selection.includes("\n")) find.input.value = selection;
    find.bar.hidden = false;
    find.input.focus();
    find.input.select();
    if (find.input.value) this.findStep(1, true);
  }

  closeFind() {
    if (!this.find || this.find.bar.hidden) return;
    this.find.bar.hidden = true;
    this.searchAddon.clearDecorations();
    this.term.clearSelection();
    this.focus();
  }

  /** Repaints the highlights in the current theme's colors. */
  refreshFind() {
    if (this.find && !this.find.bar.hidden && this.find.input.value) this.findStep(1, true);
  }

  /** Moves to the next (1) or previous (-1) match; `incremental` keeps the current match if it still fits. */
  private findStep(dir: 1 | -1, incremental = false) {
    const query = this.find?.input.value ?? "";
    if (!query) {
      this.searchAddon.clearDecorations();
      this.term.clearSelection();
      this.find!.count.textContent = "";
      return;
    }
    const options: ISearchOptions = {
      caseSensitive: this.caseSensitive,
      incremental: incremental && dir === 1,
      decorations: searchDecorations(currentTheme()),
    };
    if (dir === 1) this.searchAddon.findNext(query, options);
    else this.searchAddon.findPrevious(query, options);
  }

  private buildFind() {
    const bar = document.createElement("div");
    bar.className = "find-bar";
    bar.hidden = true;
    const input = document.createElement("input");
    input.className = "find-input";
    input.type = "text";
    input.placeholder = "Find";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Find in terminal");
    const count = document.createElement("span");
    count.className = "find-count";
    count.setAttribute("aria-live", "polite");
    const button = (node: Parameters<typeof icon>[0], name: string, run: () => void) => {
      const b = document.createElement("button");
      b.className = "find-button";
      b.title = name;
      b.setAttribute("aria-label", name);
      b.append(icon(node, 14));
      // Keep focus in the box while clicking around it.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", run);
      return b;
    };
    const caseButton = button(CaseSensitive, "Match case", () => {
      this.caseSensitive = !this.caseSensitive;
      caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
      this.findStep(1, true);
    });
    caseButton.setAttribute("aria-pressed", "false");
    bar.append(
      icon(Search, 13, "find-icon"),
      input,
      count,
      caseButton,
      button(ArrowUp, "Previous match (⇧↩)", () => this.findStep(-1)),
      button(ArrowDown, "Next match (↩)", () => this.findStep(1)),
      button(X, "Close (Esc)", () => this.closeFind()),
    );
    input.addEventListener("input", () => this.findStep(1, true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.findStep(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closeFind();
      }
    });
    this.searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      if (!input.value) count.textContent = "";
      else if (resultCount === 0) count.textContent = "No results";
      else if (resultIndex < 0) count.textContent = `${resultCount}+ matches`;
      else count.textContent = `${resultIndex + 1} of ${resultCount}`;
      bar.classList.toggle("no-results", !!input.value && resultCount === 0);
    });
    this.el.append(bar);
    this.find = { bar, input, count, caseButton };
    return this.find;
  }

  /** The last `n` non-blank lines up to the bottom of the screen, oldest first. */
  screenLines(n: number): string[] {
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = buf.baseY + this.term.rows - 1; y >= 0 && lines.length < n; y--) {
      const text = buf.getLine(y)?.translateToString(true).trim();
      if (text) lines.unshift(text);
    }
    return lines;
  }

  get ptyId(): number | undefined {
    return this.pty?.id;
  }

  /**
   * Spawns the shell in `cwd`, then types each of `commands` into it as if
   * entered at the prompt. `macro` names the macro they came from.
   */
  async start(cwd?: string, commands: string[] = [], macro?: string) {
    this.startCwd = cwd ?? "";
    this.macro = macro;
    this.fit();
    try {
      const pty = await spawnPty({
        cols: this.term.cols,
        rows: this.term.rows,
        cwd,
        onData: (bytes) => this.term.write(bytes),
        onExit: () => this.hooks.onExit(),
      });
      if (this.disposed) return pty.kill();
      this.pty = pty;
      // The view may have been resized while the shell was starting.
      pty.resize(this.term.cols, this.term.rows);
      // The tty buffers these until the shell reads its first line, so
      // there's no need to wait for a prompt.
      if (commands.length > 0) pty.write(commands.map((c) => c + "\r").join(""));
    } catch (e) {
      this.term.write(`\r\n\x1b[31mFailed to start shell: ${e}\x1b[0m\r\n`);
    }
  }

  fit() {
    if (this.disposed) return;
    try {
      this.fitAddon.fit();
    } catch {
      // Not laid out yet.
    }
  }

  focus() {
    this.term.focus();
  }

  dispose() {
    this.disposed = true;
    sessions.delete(this);
    this.pty?.kill();
    this.term.dispose();
    this.pane.remove();
  }
}
