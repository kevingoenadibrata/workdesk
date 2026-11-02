import { providerLogo } from "./providerLogos";
import { providerName, type Ticket as TicketData } from "./tickets";
import { SESSION_LABELS, type Session, type SessionState } from "./sessions";
import { TicketSheet, type TicketView } from "./ticketsheet";
import { closeMenu, showMenu, type MenuItem } from "./menu";
import { Copy, ExternalLink, FolderGit2, FolderOpen, GitMerge, GitPullRequest, GitPullRequestClosed, Send, Ticket, TicketPlus, Trash2, X, icon } from "./icons";
import type { TermSession } from "./terminal";

/** What the session bar's chips do. */
export interface SessionBarActions {
  reveal(session: Session): void;
  copyPath(session: Session): void;
  end(session: Session): void;
  /** Opens the ticket picker under `anchor` to attach (or swap) the session's ticket. */
  pickTicket(session: Session, anchor: HTMLElement): void;
  detachTicket(session: Session): void;
  sendBrief(session: Session): void;
  openUrl(url: string): void;
  /** Shows a file in Finder. */
  revealFile(path: string): void;
  /** The session's ticket in full (description, status) when the ticket list has it. */
  ticketDetails(session: Session): TicketData;
}

/** Each pane's ticket panel, once opened. */
const sheets = new WeakMap<TermSession, TicketSheet>();

function sheetFor(pane: TermSession): TicketSheet {
  let sheet = sheets.get(pane);
  if (!sheet) {
    sheet = new TicketSheet(pane.el);
    sheet.onResize = () => pane.fit();
    sheet.onClose = () => {
      pane.headerInfo.querySelector(".pane-chip.ticket")?.classList.remove("open");
      pane.fit();
      pane.focus();
    };
    sheets.set(pane, sheet);
  }
  return sheet;
}

function ticketView(pane: TermSession, session: Session, actions: SessionBarActions): TicketView {
  return {
    ticket: actions.ticketDetails(session),
    branch: session.branch,
    sendBrief: () => actions.sendBrief(session),
    change: (anchor) => actions.pickTicket(session, anchor),
    detach: () => {
      sheets.get(pane)?.close();
      actions.detachTicket(session);
    },
    openUrl: actions.openUrl,
    revealFile: actions.revealFile,
  };
}

/** Opens `pane`'s ticket panel on its session's ticket, or closes it. */
function toggleTicket(pane: TermSession, session: Session, actions: SessionBarActions, badge: HTMLElement) {
  const sheet = sheetFor(pane);
  if (sheet.isOpen) return sheet.close();
  sheet.show(ticketView(pane, session, actions));
  badge.classList.add("open");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A chip button in the header; clicks don't fall through to focusing or dragging the pane. */
function chip(className: string, title: string, onClick?: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", `pane-chip ${className}`);
  b.type = "button";
  b.title = title;
  b.draggable = false;
  b.addEventListener("mousedown", (e) => e.stopPropagation());
  if (onClick) {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(b);
    });
  } else {
    b.disabled = true;
  }
  return b;
}

function menuBelow(anchor: HTMLElement, items: MenuItem[]) {
  const r = anchor.getBoundingClientRect();
  closeMenu();
  showMenu(r.left, r.bottom + 4, items);
}

/** The bar's contents for `session`: its state, worktree, ticket and pull request. */
function build(pane: TermSession, session: Session, state: SessionState, actions: SessionBarActions): Node[] {
  const dot = el("span", "pane-session-state");
  dot.dataset.state = state;
  dot.title = SESSION_LABELS[state];

  const tree = chip("worktree", `${session.path}\nOn ${session.branch}`, (b) =>
    menuBelow(b, [
      { label: "Reveal in Finder", icon: FolderOpen, action: () => actions.reveal(session) },
      { label: "Copy Path", icon: Copy, action: () => actions.copyPath(session) },
      { separator: true },
      {
        label: "End Session…",
        icon: Trash2,
        danger: true,
        title: "Close the pane and remove the worktree",
        action: () => actions.end(session),
      },
    ]),
  );
  tree.append(icon(FolderGit2, 12), el("span", "pane-chip-main", session.repo), el("span", "pane-chip-sub", session.branch));

  const t = session.ticket;
  let ticket: HTMLButtonElement;
  if (t) {
    ticket = chip("ticket", `${t.id} · ${t.title}\n${providerName(t.provider)} · Click for details, right-click for more`, (b) =>
      toggleTicket(pane, session, actions, b),
    );
    ticket.classList.toggle("open", !!sheets.get(pane)?.isOpen);
    ticket.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menuBelow(ticket, [
        ...(t.url && t.provider !== "workdesk" ? [{ label: `Open in ${providerName(t.provider)}`, icon: ExternalLink, action: () => actions.openUrl(t.url) }] : []),
        { label: "Send Brief to Claude", icon: Send, title: "Type the ticket into Claude's prompt", action: () => actions.sendBrief(session) },
        { separator: true },
        { label: "Change Ticket…", icon: Ticket, action: () => actions.pickTicket(session, ticket) },
        { label: "Detach Ticket", icon: X, action: () => { sheets.get(pane)?.close(); actions.detachTicket(session); } },
      ]);
    });
    const logo = el("span", "pane-chip-logo");
    logo.innerHTML = providerLogo(t.provider, 11);
    ticket.append(logo, el("span", "pane-chip-main", t.id), el("span", "pane-chip-sub", t.title));
  } else {
    ticket = chip("ticket empty", "Attach a ticket to this session", (b) => actions.pickTicket(session, b));
    ticket.append(icon(TicketPlus, 12), el("span", "pane-chip-main", "Attach ticket"));
  }

  const p = session.pull;
  let pull: HTMLButtonElement;
  if (p) {
    pull = chip("pull", `#${p.number} · ${p.title}\nOpen in your browser`, () => actions.openUrl(p.url));
    pull.dataset.state = p.draft && p.state === "OPEN" ? "DRAFT" : p.state;
    const label = p.state === "MERGED" ? "Merged" : p.state === "CLOSED" ? "Closed" : p.draft ? "Draft" : "Open";
    pull.append(
      icon(p.state === "MERGED" ? GitMerge : p.state === "CLOSED" ? GitPullRequestClosed : GitPullRequest, 12),
      el("span", "pane-chip-main", `#${p.number}`),
      el("span", "pane-chip-sub", label),
    );
  } else {
    pull = chip("pull empty", `No pull request from ${session.branch} yet`);
    pull.append(icon(GitPullRequest, 12), el("span", "pane-chip-main", "No PR"));
  }

  return [dot, tree, ticket, pull];
}

/** What each pane's bar last showed, so polls that change nothing leave the DOM alone. */
const shown = new WeakMap<TermSession, string>();

/** Fills `pane`'s header with `session`'s bar, or puts its plain title back (`null`). */
export function renderSessionBar(pane: TermSession, session: Session | null, state: SessionState, actions: SessionBarActions) {
  const key = session ? JSON.stringify([state, session.repo, session.branch, session.path, session.ticket, session.pull]) : "";
  if (shown.get(pane) === key) return;
  shown.set(pane, key);
  pane.setHeaderInfo(session ? build(pane, session, state, actions) : null);
  // An open ticket panel follows the session: another ticket, or none.
  const sheet = sheets.get(pane);
  if (sheet?.isOpen) {
    if (session?.ticket) sheet.show(ticketView(pane, session, actions));
    else sheet.close();
  }
}
