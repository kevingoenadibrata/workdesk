import "./home.css";
import { el } from "./page";
import { markdown } from "./markdown";
import { providerLogo } from "./providerLogos";
import { ago, providerName, savedImageHook, updatedAt, type Ticket } from "./tickets";
import { ExternalLink, GitBranch, Send, Ticket as TicketIcon, Unlink, X, icon } from "./icons";

/** What the ticket panel shows, and what its buttons do. */
export interface TicketView {
  /** The ticket in full when the ticket list has it, else just what the session knows (no description or status). */
  ticket: Ticket;
  /** The session's branch. */
  branch: string;
  sendBrief(): void;
  /** Opens the ticket picker under `anchor` to swap the session's ticket. */
  change(anchor: HTMLElement): void;
  detach(): void;
  openUrl(url: string): void;
  /** Shows a file (a ticket's pasted image) in Finder. */
  revealFile(path: string): void;
}

const WIDTH_KEY = "workdesk.ticketPanel.width";
const MIN_SHARE = 0.2;
const MAX_SHARE = 0.75;

function loadShare(): number {
  try {
    const f = Number(localStorage.getItem(WIDTH_KEY));
    if (f >= MIN_SHARE && f <= MAX_SHARE) return f;
  } catch {
    // Default it is.
  }
  return 0.4;
}

/**
 * A session's ticket, docked in its pane right of the terminal, like the
 * Changes panel: opened from the header's ticket badge, resized from its left
 * edge, closed with Esc or ×.
 */
export class TicketSheet {
  private root: HTMLElement | null = null;
  /** Called after the panel closes, e.g. to put focus back in the terminal. */
  onClose = () => {};
  /** Called when the panel's width changes, so the terminal can refit. */
  onResize = () => {};

  /** `term` is the pane's terminal element; the panel goes right after it. */
  constructor(private term: HTMLElement) {}

  get isOpen() {
    return this.root != null;
  }

  /** Opens the panel on `view`, or redraws it in place if it's open. */
  show(view: TicketView) {
    const content = this.build(view);
    if (this.root) {
      this.root.replaceChildren(...content);
      return;
    }
    const sheet = el("aside", "ticket-sheet");
    sheet.tabIndex = -1;
    sheet.setAttribute("aria-label", "Ticket");
    sheet.style.width = `${loadShare() * 100}%`;
    sheet.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    sheet.append(...content);
    this.term.after(sheet);
    this.root = sheet;
    this.onResize();
    sheet.focus({ preventScroll: true });
  }

  close() {
    const root = this.root;
    if (!root) return;
    this.root = null;
    root.remove();
    this.onClose();
  }

  private build(view: TicketView): Node[] {
    const t = view.ticket;
    const native = t.provider === "workdesk";
    const resizer = el("div", "ticket-resizer");
    resizer.addEventListener("mousedown", (e) => this.startResize(e));

    const head = el("header", "ticket-sheet-head");
    const where = el("div", "ticket-sheet-where");
    const logo = el("span", "ticket-sheet-logo");
    logo.innerHTML = providerLogo(t.provider, 13);
    logo.title = providerName(t.provider);
    where.append(logo, el("span", "ticket-sheet-id", t.id));
    if (t.project) where.append(el("span", "ticket-sheet-dot", "·"), el("span", "ticket-sheet-project", t.project));
    const tools = el("div", "ticket-sheet-tools");
    const iconButton = (node: Parameters<typeof icon>[0], label: string, run: () => void) => {
      const b = el("button", "ticket-sheet-icon");
      b.title = label;
      b.setAttribute("aria-label", label);
      b.append(icon(node, 13));
      b.addEventListener("click", run);
      return b;
    };
    if (!native && t.url) tools.append(iconButton(ExternalLink, `Open in ${providerName(t.provider)}`, () => view.openUrl(t.url)));
    tools.append(iconButton(X, "Close", () => this.close()));
    head.append(where, tools);

    const scroll = el("div", "ticket-sheet-scroll");
    const title = el("h2", "ticket-sheet-title", t.title);
    const meta = el("div", "ticket-sheet-meta");
    if (t.status) {
      const pill = el("span", "home-pill", t.status);
      const color = t.provider === "github" ? "var(--pr)" : t.color;
      if (color) pill.style.setProperty("--status", color);
      meta.append(pill);
    }
    if (t.updated) {
      const when = el("span", "", `Updated ${ago(updatedAt(t))} ago`);
      when.title = new Date(updatedAt(t)).toLocaleString();
      meta.append(when);
    }
    const br = el("span", "ticket-sheet-branch");
    br.title = "The session's branch";
    br.append(icon(GitBranch, 12), el("span", "", view.branch));
    meta.append(br);
    const desc = el("div", "home-modal-desc ticket-sheet-desc");
    const body = t.body?.trim();
    if (body) desc.append(...markdown(body, view.openUrl, savedImageHook(view.revealFile)));
    else desc.append(el("p", "home-modal-none", t.status ? "No description." : "Not in your ticket list, so there's no description to show."));
    scroll.append(title, meta, desc);

    const foot = el("div", "ticket-sheet-foot");
    const button = (node: Parameters<typeof icon>[0], label: string, run: (b: HTMLButtonElement) => void, title?: string) => {
      const b = el("button", "ticket-sheet-button");
      b.append(icon(node, 13), el("span", "", label));
      if (title) b.title = title;
      b.addEventListener("click", () => run(b));
      return b;
    };
    foot.append(
      button(Send, "Send brief", () => view.sendBrief(), "Type the ticket into Claude's prompt"),
      button(TicketIcon, "Change…", (b) => view.change(b), "Attach a different ticket"),
      button(Unlink, "Detach", () => view.detach(), "Take the ticket off this session"),
    );
    return [resizer, head, scroll, foot];
  }

  private startResize(e: MouseEvent) {
    const sheet = this.root;
    const host = this.term.parentElement;
    if (!sheet || !host) return;
    e.preventDefault();
    const total = host.getBoundingClientRect().width;
    const startX = e.clientX;
    const startW = sheet.getBoundingClientRect().width;
    let share = startW / total;
    document.body.classList.add("resizing");
    const onMove = (m: MouseEvent) => {
      share = Math.max(MIN_SHARE, Math.min(MAX_SHARE, (startW - (m.clientX - startX)) / total));
      sheet.style.width = `${share * 100}%`;
      this.onResize();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing");
      try {
        localStorage.setItem(WIDTH_KEY, String(share));
      } catch {
        // Not remembered past this session.
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
}
