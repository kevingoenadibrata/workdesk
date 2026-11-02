import { Check, CircleAlert, X, icon } from "./icons";

export type ToastAction = { label: string; run: () => void };

let current: { el: HTMLElement; timer?: number } | null = null;

function dismiss(t: { el: HTMLElement; timer?: number }) {
  clearTimeout(t.timer);
  if (current === t) current = null;
  const el = t.el;
  el.classList.add("leaving");
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

/**
 * A short note floating in the window's bottom-right corner, like "Copied ENG-42", with optional
 * buttons such as Undo. Replaces any showing. An error stays, with a dismiss button, until one
 * of its buttons is clicked or it's dismissed.
 */
export function showToast(message: string, ms = 1800, actions?: ToastAction | ToastAction[], opts: { error?: boolean } = {}) {
  if (current) {
    clearTimeout(current.timer);
    current.el.remove();
    current = null;
  }
  const error = !!opts.error;
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.setAttribute("role", error ? "alert" : "status");
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.append(icon(error ? CircleAlert : Check, 13, "toast-icon"), text);
  const mine: { el: HTMLElement; timer?: number } = { el };
  const list = actions ? (Array.isArray(actions) ? actions : [actions]) : [];
  if (list.length || error) {
    const row = document.createElement("span");
    row.className = "toast-actions";
    for (const action of list) {
      const b = document.createElement("button");
      b.className = "toast-action";
      b.textContent = action.label;
      b.addEventListener("click", () => {
        dismiss(mine);
        action.run();
      });
      row.append(b);
    }
    if (error) {
      const x = document.createElement("button");
      x.className = "toast-x";
      x.title = "Dismiss";
      x.setAttribute("aria-label", "Dismiss");
      x.append(icon(X, 13));
      x.addEventListener("click", () => dismiss(mine));
      row.append(x);
    }
    el.append(row);
  }
  document.body.append(el);
  if (!error) mine.timer = window.setTimeout(() => dismiss(mine), ms);
  current = mine;
}
