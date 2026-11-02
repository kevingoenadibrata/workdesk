import { providerLogo } from "./providerLogos";
import type { Ticket } from "./tickets";

let current: { root: HTMLElement; close: () => void } | null = null;

export function closeTicketPicker() {
  current?.close();
}

/**
 * A searchable list of `tickets` opening below `anchor` (matching id, title or
 * project). `taken` names tickets another session already has, which are
 * listed but can't be picked.
 */
export function openTicketPicker(
  anchor: HTMLElement,
  tickets: Ticket[],
  taken: (t: Ticket) => string | undefined,
  onPick: (ticket: Ticket) => void,
  empty = "No tickets assigned to you",
) {
  closeTicketPicker();
  const root = document.createElement("div");
  root.className = "menu branch-picker ticket-picker";
  const input = document.createElement("input");
  input.className = "branch-search";
  input.type = "text";
  input.placeholder = "Search tickets…";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search tickets");
  const list = document.createElement("div");
  list.className = "branch-list";
  root.append(input, list);

  let choices: Ticket[] = [];
  let active = 0;

  const highlight = (i: number) => {
    active = i;
    list.querySelectorAll(".menu-item").forEach((el, j) => el.classList.toggle("active", j === i));
    list.children[i]?.scrollIntoView({ block: "nearest" });
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    choices = q ? tickets.filter((t) => `${t.id} ${t.title} ${t.project}`.toLowerCase().includes(q)) : tickets;
    list.replaceChildren(
      ...choices.map((t, i) => {
        const b = document.createElement("button");
        b.className = "menu-item ticket-picker-item";
        const holder = taken(t);
        if (holder) {
          b.disabled = true;
          b.title = `Already in the session ${holder}`;
        }
        const logo = document.createElement("span");
        logo.className = "menu-icon ticket-picker-logo";
        logo.innerHTML = providerLogo(t.provider, 12);
        const id = document.createElement("span");
        id.className = "ticket-picker-id";
        id.textContent = t.id;
        const label = document.createElement("span");
        label.className = "menu-label";
        label.textContent = t.title;
        b.append(logo, id, label);
        b.addEventListener("mousemove", () => active !== i && highlight(i));
        b.addEventListener("click", () => pick(i));
        return b;
      }),
    );
    if (choices.length === 0) {
      const none = document.createElement("div");
      none.className = "menu-heading";
      none.textContent = q ? "No matching tickets" : empty;
      list.append(none);
    }
    highlight(0);
  };

  const pick = (i: number) => {
    const t = choices[i];
    if (!t || taken(t)) return;
    close();
    onPick(t);
  };

  const onOutside = (e: MouseEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  const close = () => {
    if (current?.root !== root) return;
    current = null;
    window.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("blur", close);
    root.remove();
  };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (choices.length) highlight((active + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault());

  render();
  document.body.append(root);
  const a = anchor.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  root.style.left = `${Math.max(4, Math.min(a.left, innerWidth - r.width - 4))}px`;
  root.style.top = `${Math.min(a.bottom + 4, innerHeight - r.height - 4)}px`;
  current = { root, close };
  window.addEventListener("mousedown", onOutside, true);
  window.addEventListener("blur", close);
  input.focus();
}
