import { emitTo, listen } from "@tauri-apps/api/event";
import { BADGE_LABELS, HARNESS_NAMES, faceOf, needsYou, type AgentMonitor } from "./monitor";
import type { AgentStatus } from "./pty";
import type { BotFace } from "./bot";

/** One agent as the notch shows it: just what it draws, nothing that can't cross windows. */
export interface NotchAgent {
  /** The pane's PTY id, sent back when the agent is clicked. */
  id: number;
  title: string;
  harness: string;
  status: AgentStatus;
  label: string;
  detail: string | null;
  color: string;
  face: BotFace;
  needsYou: boolean;
}

/** What the main window does when something in the notch is clicked. Workdesk is already in front. */
export interface NotchActions {
  /** An agent's row: show its pane. */
  jump(ptyId: number): void;
  newTicket(): void;
  teleport(): void;
}

/**
 * Sends the monitor's agents to the notch window (src-tauri/src/notch.rs) after
 * every poll, and again when it opens, and carries out what's clicked there.
 */
export function feedNotch(monitor: AgentMonitor, actions: NotchActions) {
  const send = () => {
    const now = Date.now();
    const agents: NotchAgent[] = monitor.current
      .filter((a) => a.session.ptyId != null)
      .map((a) => ({
        id: a.session.ptyId!,
        title: a.tabTitle,
        harness: HARNESS_NAMES[a.harness],
        status: a.status,
        label: BADGE_LABELS[a.status],
        detail: a.detail ?? a.prompt,
        color: a.color,
        face: faceOf(a, now),
        needsYou: needsYou(a),
      }));
    void emitTo("notch", "notch-agents", agents).catch(() => {});
  };
  monitor.onChange(send);
  void listen("notch-ready", send);
  void listen<number>("notch-jump", ({ payload }) => actions.jump(payload));
  void listen<string>("notch-action", ({ payload }) => {
    if (payload === "ticket") actions.newTicket();
    else if (payload === "teleport") actions.teleport();
  });
}
