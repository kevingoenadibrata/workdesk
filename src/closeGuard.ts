import { busyProcesses } from "./pty";
import type { TermSession } from "./terminal";

let open = false;

/** Whether the confirm modal is up; app shortcuts stand down meanwhile. */
export function isConfirmOpen() {
  return open;
}

/**
 * Resolves true if none of `sessions` is running a command, or if the user
 * confirms closing anyway. `what` names what's closing ("this tab", "Workdesk").
 */
export async function confirmClose(sessions: TermSession[], what: string, action = "Close"): Promise<boolean> {
  if (open) return false;
  const ids = sessions.map((s) => s.ptyId).filter((id): id is number => id != null);
  if (ids.length === 0) return true;
  const busy = await busyProcesses(ids).catch(() => ({}) as Record<string, string>);
  const running = sessions.filter((s) => s.ptyId != null && busy[s.ptyId]).map((s) => ({ title: s.title, proc: busy[s.ptyId!] }));
  if (running.length === 0) return true;
  return showModal(what, action, running);
}

function showModal(what: string, action: string, running: { title: string; proc: string }[]): Promise<boolean> {
  open = true;
  const returnFocus = document.activeElement as HTMLElement | null;
  const backdrop = document.createElement("div");
  backdrop.className = "confirm-backdrop";
  const card = document.createElement("div");
  card.className = "confirm";
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "confirm-title");

  const title = document.createElement("h2");
  title.id = "confirm-title";
  title.className = "confirm-title";
  title.textContent = `${action} ${what}?`;
  const text = document.createElement("p");
  text.className = "confirm-text";
  text.textContent =
    running.length === 1 ? "A command is still running. Closing will stop it." : `${running.length} commands are still running. Closing will stop them.`;
  const list = document.createElement("ul");
  list.className = "confirm-list";
  for (const r of running) {
    const li = document.createElement("li");
    const proc = document.createElement("span");
    proc.className = "confirm-proc";
    proc.textContent = r.proc;
    const where = document.createElement("span");
    where.className = "confirm-where";
    where.textContent = r.title;
    li.append(proc, where);
    list.append(li);
  }

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";
  const cancel = document.createElement("button");
  cancel.className = "confirm-button";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "confirm-button danger";
  ok.textContent = action;
  buttons.append(cancel, ok);
  card.append(title, text, list, buttons);
  backdrop.append(card);
  document.body.append(backdrop);
  ok.focus();

  return new Promise((resolve) => {
    const done = (result: boolean) => {
      open = false;
      backdrop.remove();
      // Closing moves focus itself; cancelling goes back to where we were.
      if (!result) returnFocus?.focus();
      resolve(result);
    };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) done(false);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(false);
      } else if (e.key === "Tab") {
        // Keep focus between the two buttons.
        e.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      }
    });
  });
}
