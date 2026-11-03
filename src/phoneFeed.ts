import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BADGE_LABELS, HARNESS_NAMES, agentTask, needsYou, type AgentMonitor } from "./monitor";
import { currentTheme, onThemeChange } from "./themes";
import { tildePath } from "./favorites";
import { showToast } from "./toast";
import type { Workspace } from "./workspace";
import type { AgentStatus } from "./pty";
import type { ITheme } from "@xterm/xterm";

/** One pane as the phone shows it. Terminal panes can be opened there; browser panes only name their page. */
export interface PhonePane {
  pty: number | null;
  kind: "shell" | "web";
  /** The foreground program, or the page's URL. */
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  agent: {
    harness: string;
    status: AgentStatus;
    label: string;
    detail: string | null;
    needsYou: boolean;
    since: number;
    lastLog: string[];
  } | null;
}

export interface PhoneTab {
  id: number;
  title: string;
  color: string;
  group: string | null;
  active: boolean;
  /** Panes per column, left to right, to draw the tab's layout like the sidebar does. */
  columns: number[];
  panes: PhonePane[];
}

/** Everything the phone mirror (src-tauri/src/phone.rs) sends the phone. */
export interface PhoneState {
  /** Workdesk is in front, so notifications wait. */
  focused: boolean;
  theme: { bg: string; fg: string; accent: string; danger: string; light: boolean; term: ITheme; groups: Record<string, string> };
  tabs: PhoneTab[];
}

/**
 * Keeps the phone mirror's copy of the tab list current, answers its requests
 * for a terminal's screen, and says when a phone starts watching. The mirror
 * itself starts on its own once Tailscale is up (src-tauri/src/phone.rs).
 */
export function feedPhone(ws: Workspace, monitor: AgentMonitor) {
  const build = (): PhoneState => {
    const agents = new Map(monitor.current.map((a) => [a.session, a]));
    const styles = getComputedStyle(document.documentElement);
    const t = currentTheme();
    const tabs = ws.orderedTabIds().map((id): PhoneTab => {
      const tab = ws.tabs.get(id)!;
      const group = ws.groupOf(id);
      const c = group?.color ?? tab.color;
      return {
        id,
        title: ws.title(tab),
        color: (c ? styles.getPropertyValue(`--group-${c}`) : "").trim() || t.accent,
        group: group?.name ?? null,
        active: ws.activeTab === tab,
        columns: tab.columns.map((c) => c.length),
        panes: tab.sessions.map((s): PhonePane => {
          const a = agents.get(s);
          const url = (s as { url?: string }).url;
          return {
            pty: s.ptyId ?? null,
            kind: s.kind,
            name: s.kind === "web" ? url || "Browser" : s.procName || "shell",
            cwd: s.cwd ? tildePath(s.cwd) : "",
            cols: s.term.cols,
            rows: s.term.rows,
            agent: a
              ? {
                  harness: HARNESS_NAMES[a.harness],
                  status: a.status,
                  label: BADGE_LABELS[a.status],
                  detail: a.detail ?? agentTask(a),
                  needsYou: needsYou(a),
                  since: a.since,
                  lastLog: a.lastLog.slice(-6),
                }
              : null,
          };
        }),
      };
    });
    return {
      focused: document.hasFocus(),
      theme: { bg: t.bg, fg: t.fg, accent: t.accent, danger: t.danger, light: t.light, term: t.term, groups: t.groups },
      tabs,
    };
  };

  let timer = 0;
  const send = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void invoke("phone_state", { state: build() }).catch(() => {}), 150);
  };
  monitor.onChange(send);
  ws.onChange(send);
  onThemeChange(send);
  window.addEventListener("focus", send);
  window.addEventListener("blur", send);

  void listen<{ req: number; pty: number }>("phone-snapshot", async ({ payload }) => {
    const session = [...ws.tabs.values()].flatMap((t) => t.sessions).find((s) => s.ptyId === payload.pty);
    if (!session) return;
    const snapshot = await session.snapshot();
    void invoke("phone_snapshot", { req: payload.req, snapshot }).catch(() => {});
  });

  let watching: string[] = [];
  void listen<string[]>("phone-viewers", ({ payload }) => {
    const joined = payload.filter((n) => !watching.includes(n));
    watching = payload;
    if (joined.length) showToast(`${joined.join(", ")} opened the phone mirror`, 4000);
  });

  send();
}
