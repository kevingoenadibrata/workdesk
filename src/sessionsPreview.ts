// Dev-only: real panes with mock sessions in their headers (?theme=), and
// Teleport listing them. Open /sessions-preview.html on the dev server.
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { TermSession } from "./terminal";
import { renderSessionBar, type SessionBarActions } from "./sessionbar";
import { SESSION_LABELS, sessionLabel, type Session, type SessionState } from "./sessions";
import { DirPicker } from "./dirpicker";
import { THEMES, loadTheme, setTheme } from "./themes";

loadTheme();
const params = new URLSearchParams(location.search);
const theme = THEMES.find((t) => t.name === params.get("theme"));
if (theme) setTheme(theme);

const session = (name: string, patch: Partial<Session> = {}): Session => ({
  id: name,
  name,
  ticket: null,
  path: `/Users/me/.workdesk/worktrees/workdesk/${name}`,
  root: "/Users/me/Projects/workdesk",
  repo: "workdesk",
  branch: name,
  promptFile: "",
  startedAt: Date.now(),
  pull: null,
  ...patch,
});

const SESSIONS: [Session, SessionState][] = [
  [
    session("eng-421", {
      ticket: { provider: "linear", id: "ENG-421", title: "Rate-limit the public search endpoint", url: "" },
      branch: "kevin/eng-421-rate-limit-the-public-search-endpoint",
    }),
    "working",
  ],
  [
    session("142", {
      ticket: { provider: "github", id: "#142", title: "Diff sheet doesn't show untracked files", url: "" },
      branch: "142-diff-sheet-untracked",
      pull: { number: 212, url: "", title: "Show untracked files in the diff sheet", state: "OPEN", draft: false },
    }),
    "waiting",
  ],
  [session("spike-sessions"), "idle"],
  [
    session("des-88", {
      ticket: { provider: "clickup", id: "86b2x7k", title: "Update pricing page copy for Q4", url: "" },
      pull: { number: 198, url: "", title: "Pricing copy", state: "MERGED", draft: false },
    }),
    "merged",
  ],
];

const log = (what: string) => (s: Session) => console.log(what, s.id);
const actions: SessionBarActions = {
  reveal: log("reveal"),
  copyPath: log("copy"),
  end: log("end"),
  pickTicket: log("pick ticket"),
  detachTicket: log("detach"),
  sendBrief: log("brief"),
  openUrl: (url) => console.log("open", url),
  revealFile: (path) => console.log("reveal file", path),
  ticketDetails: (s) => ({
    ...s.ticket!,
    project: "workdesk",
    status: "In Progress",
    color: "#f2c66d",
    updated: new Date(Date.now() - 3 * 3600_000).toISOString(),
    branch: null,
    body: "Searches from logged-out users hit the database directly.\n\n## Plan\n\n- Add a token bucket per IP\n- Return `429` with `Retry-After`\n\nSee https://example.com/spec for details.",
  }),
};

/** A row of panes: one per session given, plus a plain shell when `shell`. */
function row(list: [Session, SessionState][], shell = false) {
  const host = document.createElement("div");
  host.className = "preview-row";
  const panes = document.createElement("div");
  panes.className = `panes${list.length + (shell ? 1 : 0) > 1 ? " split" : ""}`;
  host.append(panes);
  document.body.append(host);
  const make = () => {
    const col = document.createElement("div");
    col.className = "pane-col";
    panes.append(col);
    return new TermSession(col);
  };
  list.forEach(([s, state], i) => {
    const pane = make();
    pane.sessionId = s.id;
    pane.sessionName = sessionLabel(s);
    if (i === 0) pane.pane.classList.add("focused");
    renderSessionBar(pane, s, state, actions);
    pane.term.write(`\x1b[2m╭─ Claude Code ─ ${sessionLabel(s)}\x1b[0m\r\n> ${SESSION_LABELS[state]}…\r\n`);
  });
  if (shell) {
    const pane = make();
    pane.cwd = "/Users/me/Projects/workdesk";
    pane.updateHeader();
    pane.term.write("~/Projects/workdesk $ ");
  }
}

row([SESSIONS[0]]);
row([SESSIONS[1]], true);
row([SESSIONS[2], SESSIONS[3]]);

const teleport = document.createElement("div");
teleport.className = "preview-row teleport";
document.body.append(teleport);
const picker = new DirPicker(teleport);
picker.sessions = {
  list: () =>
    SESSIONS.map(([s, state], i) => ({
      id: s.id,
      label: sessionLabel(s),
      detail: [s.ticket?.title, `${s.repo} · ${s.branch}`].filter(Boolean).join(" · "),
      status: SESSION_LABELS[state] + (s.pull ? ` #${s.pull.number}` : ""),
      open: i === 0,
    })),
  recall: (id) => console.log("recall", id),
  end: async (id) => `Ended ${id}`,
};
void picker.open(
  () => {},
  () => {},
  undefined,
  { cwd: "/Users/me/Projects/workdesk" },
);

// ?ticket opens the first pane's ticket panel.
if (params.has("ticket")) document.querySelector<HTMLElement>(".pane-chip.ticket")?.click();
