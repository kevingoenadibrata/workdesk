import { providerLogo } from "./providerLogos";
import { providerName } from "./tickets";
import { SESSION_LABELS, type Session, type SessionState } from "./sessions";
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
function build(session: Session, state: SessionState, actions: SessionBarActions): Node[] {
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
    ticket = chip("ticket", `${t.id} · ${t.title}\n${providerName(t.provider)}`, (b) =>
      menuBelow(b, [
        ...(t.url ? [{ label: `Open in ${providerName(t.provider)}`, icon: ExternalLink, action: () => actions.openUrl(t.url) }] : []),
        { label: "Send Brief to Claude", icon: Send, title: "Type the ticket into Claude's prompt", action: () => actions.sendBrief(session) },
        { separator: true },
        { label: "Change Ticket…", icon: Ticket, action: () => actions.pickTicket(session, b) },
        { label: "Detach Ticket", icon: X, action: () => actions.detachTicket(session) },
      ]),
    );
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
  pane.setHeaderInfo(session ? build(session, state, actions) : null);
}
