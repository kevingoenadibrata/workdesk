import { Check, icon } from "./icons";

let current: { el: HTMLElement; timer: number } | null = null;

/** A short note at the bottom of the window, like "Copied ENG-42". Replaces any showing. */
export function showToast(message: string, ms = 1800) {
  if (current) {
    clearTimeout(current.timer);
    current.el.remove();
  }
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.append(icon(Check, 13, "toast-icon"), text);
  document.body.append(el);
  const mine = {
    el,
    timer: window.setTimeout(() => {
      el.classList.add("leaving");
      el.addEventListener("animationend", () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);
      if (current === mine) current = null;
    }, ms),
  };
  current = mine;
}
