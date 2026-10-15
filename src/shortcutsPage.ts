import { Page, el } from "./page";
import {
  SHORTCUT_SECTIONS,
  bindingProblem,
  comboIfComplete,
  comboKeys,
  combosFor,
  isRebound,
  keymap,
  onKeymapChange,
  rebind,
  resetAllBindings,
  resetBinding,
  suspendShortcuts,
  unbind,
  type Action,
} from "./shortcuts";
import { kbd, kbdKeys } from "./kbd";
import { RotateCcw, icon } from "./icons";

const LABELS = new Map(SHORTCUT_SECTIONS.flatMap((s) => s.actions));

/** How an action is named on this page; the ⌘1–9 row covers nine actions. */
function labelOf(action: Action): string {
  const n = /^goToTab(\d)$/.exec(action)?.[1];
  return n ? `Go to tab ${n}` : (LABELS.get(action) ?? action);
}

/**
 * ⌘/ reference of every key binding, read from the live keymap so it can't
 * drift. Clicking a binding records a new one in its place.
 */
export class ShortcutsPage extends Page {
  readonly title = "Shortcuts";
  private body!: HTMLElement;
  /** The action whose new combo is being recorded, if any. */
  private recording: Action | null = null;
  /** What the last change did, or why a combo was refused; shown on the row. */
  private note: { action: Action; text: string; error: boolean } | null = null;
  /** Set while rows are being replaced, when the focused one blurring means nothing. */
  private rendering = false;

  constructor(host: HTMLElement) {
    super(host);
    onKeymapChange(() => {
      if (this.isOpen) this.render();
    });
  }

  protected build(body: HTMLElement) {
    this.body = body;
    this.note = null;
    this.render();
    return null;
  }

  close() {
    this.stopRecording();
    super.close();
  }

  /** Redraws everything below the title, keeping focus on the row it was on. */
  private render() {
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-row]")?.dataset.row;
    this.rendering = true;
    for (const node of [...this.body.children]) if (!node.classList.contains("page-title")) node.remove();

    const intro = el("p", "page-intro");
    intro.append("Click a shortcut to change it, then press the new keys. While recording, ", kbdKeys([comboKeys("backspace")[0]]), " removes it and ", kbdKeys(["Esc"]), " cancels.");

    const grid = el("div", "shortcut-sections");
    for (const { title, actions } of SHORTCUT_SECTIONS) {
      const section = el("section", "shortcut-section");
      section.append(el("h2", "page-section-title", title));
      const list = el("dl", "shortcut-list");
      for (const [action, label] of actions) list.append(this.row(action, label));
      section.append(list);
      grid.append(section);
    }

    const footer = el("div", "page-footnote shortcut-footer");
    const tip = el("p", "");
    tip.append("Hold ", kbdKeys([comboKeys("mod+x")[0]]), " for a moment to see tab and page shortcuts in the sidebar.");
    footer.append(tip);
    if (SHORTCUT_SECTIONS.some((s) => s.actions.some(([a]) => isRebound(a)))) {
      const reset = el("button", "macro-add shortcut-reset-all");
      reset.append(icon(RotateCcw, 13), "Reset all shortcuts");
      reset.addEventListener("click", () => {
        this.note = null;
        resetAllBindings();
      });
      footer.append(reset);
    }
    this.body.append(intro, grid, footer);
    if (focused) this.body.querySelector<HTMLElement>(`[data-row="${focused}"] .shortcut-keys`)?.focus();
    this.rendering = false;
  }

  private row(action: Action, label: string) {
    const row = el("div", "shortcut");
    row.dataset.row = action;
    const keys = el("button", "shortcut-keys");
    keys.type = "button";
    const combos = combosFor(keymap(), action);

    if (action === "goToTab1") {
      // One row stands in for ⌘1 through ⌘9; those are fixed.
      const shown = el("dd", "shortcut-keys fixed");
      shown.append(kbdKeys([...comboKeys(combos[0] ?? "mod+1").slice(0, -1), "1–9"]));
      row.append(el("dt", "shortcut-label", label), shown);
      return row;
    }

    if (this.recording === action) {
      keys.classList.add("recording");
      keys.append(el("span", "shortcut-recording", "Press keys…"));
    } else if (combos.length === 0) {
      keys.append(el("span", "shortcut-none", "None"));
    } else {
      combos.forEach((combo, i) => {
        if (i > 0) keys.append(el("span", "shortcut-or", "or"));
        keys.append(kbd(combo));
      });
    }
    keys.setAttribute("aria-label", `${label}: ${combos.length ? combos.map((c) => comboKeys(c).join("")).join(" or ") : "no shortcut"}. Press to change.`);
    keys.addEventListener("click", () => (this.recording === action ? this.stopRecording(true) : this.startRecording(action)));
    keys.addEventListener("blur", () => {
      if (this.recording === action && !this.rendering) this.stopRecording(true);
    });

    const dd = el("dd", "shortcut-actions");
    if (isRebound(action)) {
      const reset = el("button", "shortcut-reset");
      reset.type = "button";
      reset.title = "Reset to default";
      reset.setAttribute("aria-label", `Reset ${label} to default`);
      reset.append(icon(RotateCcw, 12));
      reset.addEventListener("click", () => {
        this.note = null;
        resetBinding(action);
      });
      dd.append(reset);
    }
    dd.append(keys);

    const dt = el("dt", "shortcut-label", label);
    row.append(dt, dd);
    if (this.note?.action === action) {
      row.classList.add("has-note");
      row.append(el("p", this.note.error ? "shortcut-note error" : "shortcut-note", this.note.text));
    }
    return row;
  }

  private startRecording(action: Action) {
    this.stopRecording();
    this.recording = action;
    this.note = null;
    suspendShortcuts(true);
    window.addEventListener("keydown", this.onRecordKey, true);
    this.render();
  }

  /** Ends recording; `redraw` puts the row back to showing its keys. */
  private stopRecording(redraw = false) {
    if (!this.recording) return;
    this.recording = null;
    suspendShortcuts(false);
    window.removeEventListener("keydown", this.onRecordKey, true);
    if (redraw) this.render();
  }

  private onRecordKey = (e: KeyboardEvent) => {
    const action = this.recording;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (plain && e.key === "Escape") return this.stopRecording(true);
    if (plain && (e.key === "Backspace" || e.key === "Delete")) {
      this.stopRecording();
      unbind(action);
      return;
    }
    const combo = comboIfComplete(e);
    if (!combo) return;
    const problem = bindingProblem(combo);
    if (problem) {
      this.note = { action, text: problem, error: true };
      this.render();
      return;
    }
    this.stopRecording();
    const taken = rebind(action, combo);
    if (taken) {
      const left = combosFor(keymap(), taken).length === 0 ? `, which now has no shortcut` : "";
      this.note = { action, text: `Taken from “${labelOf(taken)}”${left}.`, error: false };
    }
    this.render();
  };
}
