// Dev-only: the real Home page fed mock tabs, agents and tickets, for checking
// the design in a browser. Open /home-preview.html on the dev server.
import "./styles.css";
import { HomePage, type HomePulls, type HomeSource, type HomeTerminal, type HomeTickets } from "./home";
import type { Agent } from "./monitor";
import type { PullRequest, Ticket } from "./tickets";
import type { Server } from "./servers";
import type { TermSession } from "./terminal";
import type { GroupColor } from "./themes";
import { THEMES, currentTheme, loadTheme, setTheme } from "./themes";

const MIN = 60_000;
const H = 60 * MIN;
const color = (c: GroupColor) => `var(--group-${c})`;

const SCREENS = {
  claude: [
    "⏺ Update(src/home.ts)",
    "  ⎿  Updated src/home.ts with 42 additions and 3 removals",
    "⏺ Bash(npx tsc --noEmit -p .)",
    "  ⎿  TSC OK",
    "✻ Crunching… (38s · ↓ 1.2k tokens · esc to interrupt)",
    "❯ ",
    "⏵⏵ accept edits on (shift+tab to cycle)",
  ],
  vite: [
    "> workdesk@0.6.1 dev",
    "> vite",
    "",
    "  VITE v7.1.4  ready in 312 ms",
    "  ➜  Local:   http://localhost:1420/",
    "  ➜  Network: use --host to expose",
    "  ➜  press h + enter to show help",
  ],
  git: [
    "dcff64d Add a file tree to each pane and dock the diff inside it (#17)",
    "08cdea8 Release v0.6.1",
    "d062fab Split the Tickets page evenly and drop the Updated column (#16)",
    "44be9b5 Show your GitHub pull requests beside the tickets (#15)",
    "3e2eac4 Release v0.6.0",
    "kevingo@mbp workdesk % git status",
    "On branch main · nothing to commit, working tree clean",
  ],
  cargo: [
    "   Compiling tauri v2.8.5",
    "   Compiling workdesk v0.6.1 (/Users/kevingo/Projects/workdesk/src-tauri)",
    "warning: unused variable: `tails`",
    "  --> src/agents.rs:212:9",
    "    Finished `release` profile [optimized] target(s) in 1m 04s",
    "kevingo@mbp src-tauri % ",
  ],
  shell: ["Last login: Fri Oct 16 09:12:40 on ttys004", "kevingo@mbp ~ % "],
  codex: ["• Ran npm test", "  └ 128 passed, 0 failed", "• Edited api/limits.ts (+18 −4)", "▌ Allow command?", "▌   rm -rf .cache/rate-limits", "▌ (y/n)"],
};

const T = (id: number, title: string, c: GroupColor, cwd: string, lines: string[], extra: Partial<HomeTerminal> = {}): HomeTerminal => ({
  id,
  title,
  group: null,
  color: color(c),
  cwd,
  running: null,
  panes: 1,
  lines,
  ...extra,
});

const sessions = new Map<string, TermSession>();
const sessionFor = (key: string) => {
  let s = sessions.get(key);
  if (!s) sessions.set(key, (s = { key } as unknown as TermSession));
  return s;
};
const A = (tab: string, c: GroupColor, status: Agent["status"], prompt: string | null, age: number, harness: Agent["harness"] = "claude"): Agent => ({
  harness,
  status,
  prompt,
  detail: null,
  session: sessionFor(tab),
  tabTitle: tab,
  color: color(c),
  lastLog: [],
  since: Date.now() - age,
});

const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const TICKETS: Ticket[] = [
  { provider: "linear", id: "ENG-421", title: "Rate-limit the public search endpoint", url: "#", project: "Engineering", status: "In Progress", color: "#f2c94c", updated: iso(0.3 * H), branch: null },
  { provider: "github", id: "#142", title: "Diff sheet doesn't show untracked files", url: "#", project: "kevingoenadibrata/workdesk", status: "Open", color: null, updated: iso(2 * H), branch: null },
  { provider: "clickup", id: "86b2x7k", title: "Update pricing page copy for Q4", url: "#", project: "Website", status: "in progress", color: "#4194f6", updated: String(Date.now() - 5 * H), branch: null },
  { provider: "linear", id: "DES-88", title: "Empty states for the onboarding checklist", url: "#", project: "Design", status: "In Review", color: "#5e6ad2", updated: iso(26 * H), branch: null },
  { provider: "linear", id: "ENG-377", title: "Flaky test: checkout flow times out on CI when the cart has more than fifty items", url: "#", project: "Engineering", status: "Backlog", color: "#bec2c8", updated: iso(4 * 24 * H), branch: null },
  { provider: "github", id: "#57", title: "Support Windows paths in file links", url: "#", project: "acme/cli", status: "Open", color: null, updated: iso(9 * 24 * H), branch: null },
];

const S = (port: number, name: string, tab: string | null, live = true, host = "localhost"): Server => ({
  key: `${host}:${port}`,
  session: tab ? sessionFor(`server/${tab}`) : null,
  tabTitle: tab,
  color: null,
  scheme: "http",
  host,
  port,
  live,
  name,
  since: Date.now() - 20 * MIN,
});
const SERVERS: Server[] = [
  S(1420, "node", "dev server"),
  S(5173, "vite", "api", true, "app.localhost"),
  S(8000, "python3.12", "api"),
  S(3000, "node", "docs", false),
  S(11434, "ollama", null),
];

const PULLS: PullRequest[] = [
  { kind: "review", id: "#5758", title: "Run H100 agent-simulation sandboxes on Daytona", url: "#", repo: "acme/api", author: "albertp", draft: false, review: "REVIEW_REQUIRED", branch: "h100-daytona", updated: iso(3 * H) },
  { kind: "authored", id: "#18", title: "Add a Home page with a glimpse of everything", url: "#", repo: "kevingoenadibrata/workdesk", author: "kevingoenadibrata", draft: false, review: "APPROVED", branch: "home-page", updated: iso(0.2 * H) },
  { kind: "authored", id: "#295", title: "Multi-page custom report templates", url: "#", repo: "acme/reports", author: "kevingoenadibrata", draft: false, review: "CHANGES_REQUESTED", branch: "feat/custom-report-multi-page", updated: iso(6 * H) },
  { kind: "review", id: "#5741", title: "Cache the pricing table between requests", url: "#", repo: "acme/api", author: "mira", draft: false, review: "REVIEW_REQUIRED", branch: "mira/pricing-cache", updated: iso(28 * H) },
  { kind: "authored", id: "#14", title: "Add a Tickets page for GitHub, Linear and ClickUp", url: "#", repo: "kevingoenadibrata/workdesk", author: "kevingoenadibrata", draft: true, review: null, branch: "tickets-page", updated: iso(50 * H) },
  { kind: "authored", id: "#3", title: "Bump tauri to 2.9", url: "#", repo: "kevingoenadibrata/workdesk", author: "kevingoenadibrata", draft: false, review: "REVIEW_REQUIRED", branch: "bump-tauri", updated: iso(80 * H) },
];

interface Scenario {
  pulls: HomePulls;
  terminals: HomeTerminal[];
  agents: Agent[];
  tickets: HomeTickets;
  servers: Server[];
}

const typical: Scenario = {
  terminals: [
    T(1, "workdesk", "blue", "~/Projects/workdesk", SCREENS.claude, { running: "Claude Code", panes: 2 }),
    T(2, "dev server", "green", "~/Projects/workdesk", SCREENS.vite, { running: "node" }),
    T(3, "api", "purple", "~/Projects/acme/api", SCREENS.codex, { running: "Codex", group: "Acme" }),
    T(4, "src-tauri", "orange", "~/Projects/workdesk/src-tauri", SCREENS.cargo),
    T(5, "workdesk", "cyan", "~/Projects/workdesk", SCREENS.git),
    T(6, "~", "grey", "~", SCREENS.shell),
  ],
  agents: [
    A("workdesk", "blue", "thinking", "i want a main home page. it gives you a glimpse of everything", 38_000),
    A("api", "purple", "waiting", "add rate limiting to /v1/upload", 40_000, "codex"),
    A("docs", "cyan", "idle", "fix the broken links in README", 25 * MIN, "opencode"),
    A("Testing Bot", "orange", "idle", null, 3 * MIN),
  ],
  tickets: { connected: true, loading: false, tickets: TICKETS },
  servers: SERVERS.slice(0, 4),
  pulls: { available: true, loaded: true, pulls: PULLS.slice(0, 4) },
};

const SCENARIOS: Record<string, Scenario> = {
  "Typical day": typical,
  "Lots open": {
    terminals: [
      ...typical.terminals,
      T(7, "notes", "pink", "~/notes", SCREENS.shell),
      T(8, "infra", "red", "~/Projects/infra", SCREENS.shell),
    ],
    agents: [
      ...typical.agents,
      A("Release", "red", "error", "build the release", 2 * MIN),
      A("Split", "pink", "working", "make the log card configurable", 12_000),
      A("infra", "yellow", "working", "bump terraform providers", 4 * MIN, "codex"),
    ],
    tickets: typical.tickets,
    servers: [...SERVERS, S(4000, "ruby", "infra"), S(9229, "node", "notes")],
    pulls: { available: true, loaded: true, pulls: PULLS },
  },
  "Just started": {
    terminals: [T(1, "~", "blue", "~", SCREENS.shell)],
    agents: [],
    tickets: { connected: false, loading: false, tickets: [] },
    servers: [],
    pulls: { available: false, loaded: false, pulls: [] },
  },
  "Inbox zero": {
    terminals: typical.terminals.slice(0, 2),
    agents: typical.agents.slice(2),
    tickets: { connected: true, loading: false, tickets: [] },
    servers: SERVERS.slice(0, 1),
    pulls: { available: true, loaded: true, pulls: [] },
  },
};

loadTheme();
{
  const asked = THEMES.find((t) => t.name === new URLSearchParams(location.search).get("theme"));
  if (asked) setTheme(asked);
}
const KEY = "workdesk.homePreview";
let scenario = (() => {
  const asked = new URLSearchParams(location.search).get("scenario");
  if (asked && asked in SCENARIOS) return asked;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in SCENARIOS) return saved;
  } catch {}
  return "Typical day";
})();
const listeners = new Set<() => void>();
const source: HomeSource = {
  terminals: () => SCENARIOS[scenario].terminals,
  agents: () => SCENARIOS[scenario].agents,
  tickets: () => SCENARIOS[scenario].tickets,
  servers: () => SCENARIOS[scenario].servers,
  pulls: () => SCENARIOS[scenario].pulls,
  onChange: (fn) => listeners.add(fn),
  openTab: (id) => console.log("open tab", id),
  jumpToAgent: (s) => console.log("jump to agent", s),
  openTicket: (t) => console.log("open ticket", t.id),
  openServer: (s) => console.log("open server", s.port),
  openPull: (p) => console.log("open pull", p.id),
  teleport: () => console.log("teleport"),
  open: (p) => console.log("open", p),
};

const page = new HomePage(document.getElementById("preview-host")!, source);
page.open();

const bar = document.getElementById("preview-scenarios")!;
const sync = () => {
  for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.textContent === scenario));
};
for (const name of Object.keys(SCENARIOS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = name;
  b.addEventListener("click", () => {
    scenario = name;
    try {
      localStorage.setItem(KEY, name);
    } catch {}
    sync();
    page.refresh();
  });
  bar.append(b);
}
sync();

const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
for (const t of THEMES) themeSelect.add(new Option(t.name, t.name, false, t.name === currentTheme().name));
themeSelect.addEventListener("change", () => setTheme(THEMES.find((t) => t.name === themeSelect.value)!));

// Like the app's agent polling, so faces and "since" times move.
setInterval(() => listeners.forEach((fn) => fn()), 1500);
