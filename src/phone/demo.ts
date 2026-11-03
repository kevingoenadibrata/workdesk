// Dev only (`/phone.html?demo`): made-up tabs and a terminal screen, to work on
// the phone app's look without a phone or Tailscale. Never loaded otherwise.
import { THEMES } from "../themes";
import type { PhonePane, PhoneState } from "../phoneFeed";

const MIN = 60_000;

export function demoState(): PhoneState {
  const t = THEMES.find((x) => new URLSearchParams(location.search).get("theme") === x.name) ?? THEMES[0];
  const g = t.groups;
  const now = Date.now();
  const agent = (status: NonNullable<PhonePane["agent"]>["status"], label: string, detail: string | null, ago: number, log: string[]) => ({
    harness: "Claude Code",
    status,
    label,
    detail,
    needsYou: status === "waiting" || status === "error",
    since: now - ago * MIN,
    lastLog: log,
  });
  const shell = (cwd: string, name = "zsh"): PhonePane => ({ pty: 9, kind: "shell", name, cwd, cols: 124, rows: 32, agent: null });
  return {
    focused: false,
    theme: { bg: t.bg, fg: t.fg, accent: t.accent, danger: t.danger, light: t.light, term: t.term, groups: g },
    tabs: [
      {
        id: 1,
        title: "WD-24",
        color: g.blue,
        group: null,
        active: true,
        columns: [1],
        panes: [
          {
            ...shell("~/.workdesk/worktrees/workdesk/wd-24"),
            pty: 1,
            agent: agent("waiting", "Waiting", "Allow Bash: tailscale serve --bg --https=8443 http://127.0.0.1:47390?", 2, [
              "Writing the research doc.",
              "Bash(tailscale serve status --json)",
              "Do you want to proceed?",
            ]),
          },
        ],
      },
      {
        id: 2,
        title: "api",
        color: g.purple,
        group: "Backend",
        active: false,
        columns: [1, 1],
        panes: [
          {
            ...shell("~/Projects/api"),
            pty: 2,
            agent: agent("working", "Working", "Fix the flaky retry test in billing", 6, ["Read src/billing/retry.ts", "Edit src/billing/retry.ts", "Bash(npm test -- retry)"]),
          },
          { ...shell("~/Projects/api", "node"), pty: 3 },
        ],
      },
      {
        id: 3,
        title: "worker",
        color: g.purple,
        group: "Backend",
        active: false,
        columns: [1],
        panes: [{ ...shell("~/Projects/worker"), pty: 4, agent: agent("idle", "Done", "Bump the queue client to v4", 14, ["All 212 tests pass.", "Opened #318."]) }],
      },
      { id: 4, title: "~", color: g.green, group: null, active: false, columns: [1], panes: [{ ...shell("~"), pty: 5 }] },
      {
        id: 5,
        title: "localhost:5173",
        color: g.green,
        group: null,
        active: false,
        columns: [1],
        panes: [{ pty: null, kind: "web", name: "http://localhost:5173/", cwd: "", cols: 0, rows: 0, agent: null }],
      },
    ],
  };
}

export function demoScreen(pane: PhonePane | null) {
  const lines = [
    "\x1b[38;5;208m✻\x1b[0m \x1b[1mWelcome to Claude Code\x1b[0m",
    "",
    "\x1b[2m> \x1b[0mWork on WD-24 and open a pull request.",
    "",
    "\x1b[32m●\x1b[0m Read \x1b[1msrc-tauri/src/pty.rs\x1b[0m",
    "\x1b[32m●\x1b[0m Write \x1b[1mdocs/research/phone-mirror.md\x1b[0m",
    "",
    "\x1b[33m╭────────────────────────────────────────────────────────────────────────────╮\x1b[0m",
    "\x1b[33m│\x1b[0m Bash command                                                               \x1b[33m│\x1b[0m",
    "\x1b[33m│\x1b[0m   tailscale serve --bg --https=8443 http://127.0.0.1:47390                 \x1b[33m│\x1b[0m",
    "\x1b[33m│\x1b[0m Do you want to proceed?                                                    \x1b[33m│\x1b[0m",
    "\x1b[33m│\x1b[0m \x1b[36m❯ 1. Yes\x1b[0m                                                                   \x1b[33m│\x1b[0m",
    "\x1b[33m│\x1b[0m   2. No, and tell Claude what to do differently                            \x1b[33m│\x1b[0m",
    "\x1b[33m╰────────────────────────────────────────────────────────────────────────────╯\x1b[0m",
  ];
  return { cols: pane?.cols || 100, rows: pane?.rows || 30, data: lines.join("\r\n") };
}
