// Dev-only: the real Home page (backlog → with an agent → pull request) fed
// mock tickets, runs and agents. Open /home-preview.html on the dev server.
// ?scenario= picks a scenario, ?theme= a theme, ?filter=1 opens the filter menu.
import "./styles.css";
import { HomePage, type HomeSource } from "./home";
import { RunStore, runKey, type Run } from "./runs";
import { el } from "./page";
import { THEMES, currentTheme, loadTheme, setTheme, type GroupColor } from "./themes";
import type { Agent } from "./monitor";
import type { AgentStatus } from "./pty";
import type { PullRequest, Ticket } from "./tickets";
import type { Provider } from "./providerLogos";
import type { TermSession } from "./terminal";
import type { Server } from "./servers";

const MIN = 60_000;
/** Unix seconds, `min` minutes from now. */
const inSec = (min: number) => Math.round(Date.now() / 1000 + min * 60);
const iso = (agoMin: number) => new Date(Date.now() - agoMin * MIN).toISOString();

const T = (provider: Provider, id: string, title: string, project: string, status: string, color: string | null, ageMin: number, branch: string | null = null): Ticket => ({
  provider,
  id,
  title,
  url: `https://example.com/${encodeURIComponent(id)}`,
  project,
  status,
  color,
  updated: provider === "clickup" ? String(Date.now() - ageMin * MIN) : iso(ageMin),
  branch,
});

const BACKLOG: Ticket[] = [
  {
    ...T("linear", "ENG-430", "Add CSV export to the audit log", "Engineering", "Todo", "#e2e2e2", 50),
    body: [
      "Admins keep asking for a way to pull the audit log into a spreadsheet for their quarterly reviews.",
      "",
      "## What we need",
      "",
      "- An **Export CSV** button on `/settings/audit-log`, next to the date filter",
      "- The export respects the current filters (date range, actor, event type)",
      "- Columns: timestamp (UTC, ISO 8601), actor email, event, target, IP",
      "",
      "## Notes",
      "",
      "> Large orgs have millions of rows, so stream it rather than building it in memory.",
      "",
      "See the existing JSON export in `src/routes/audit.ts` and the design in [Figma](https://figma.com/file/abc123).",
      "",
      "```",
      "GET /api/audit-log/export?format=csv&from=2026-07-01&to=2026-09-30",
      "```",
    ].join("\n"),
  },
  T("github", "#149", "Teleport: rank folders by how often and how recently you open them", "kevingoenadibrata/workdesk", "Open", null, 3 * 60),
  T("linear", "ENG-377", "Flaky test: checkout flow times out on CI when the cart has more than fifty items", "Engineering", "Backlog", "#bec2c8", 20 * 1440),
  T("github", "#138", "Local Servers: Docker containers show as outside servers", "kevingoenadibrata/workdesk", "Open", null, 26 * 60),
  { ...T("clickup", "OPS-12", "Rotate staging database credentials", "Ops backlog", "to do", "#d3d3d3", 3 * 1440), body: "The staging DB password was shared in a Slack thread. Rotate it, update the secret in 1Password and the CI variables, and restart the staging API." },
  T("linear", "DES-91", "Dark mode pass on the billing emails", "Design", "Todo", "#e2e2e2", 4 * 1440),
  T("clickup", "86c1q2m", "Fix broken anchor links on /docs", "Website", "to do", "#d3d3d3", 6 * 1440),
  T("linear", "ENG-433", "Retry failed webhook deliveries with backoff", "Engineering", "Todo", "#e2e2e2", 7 * 1440),
  T("github", "#151", "Split view: remember pane sizes per tab", "kevingoenadibrata/workdesk", "Open", null, 8 * 1440),
  T("linear", "DES-93", "New icons for the integrations page", "Design", "Backlog", "#bec2c8", 9 * 1440),
  T("clickup", "86c1r7t", "Add the Q4 case studies to the customers page", "Website", "to do", "#d3d3d3", 11 * 1440),
  T("linear", "ENG-441", "Upgrade the API to Node 24", "Engineering", "Backlog", "#bec2c8", 13 * 1440),
  T("github", "#160", "File tree: show git-ignored files dimmed", "kevingoenadibrata/workdesk", "Open", null, 15 * 1440),
];

/** A ticket with a run: its agent (if one's in a pane) and pull request (if it has one). */
interface Working {
  ticket: Ticket;
  branch: string;
  agent?: { status: AgentStatus; color: GroupColor; log: string[]; age: number; from?: AgentStatus };
  pull?: Run["pull"];
  review?: PullRequest["review"];
  ageMin?: number;
}

const WORKING: Working[] = [
  {
    ticket: T("github", "#142", "Diff sheet doesn't show untracked files", "kevingoenadibrata/workdesk", "Open", null, 30),
    branch: "142-diff-sheet-doesnt-show-untracked-files",
    agent: { status: "waiting", color: "blue", log: ["Update(src/diffview.ts)", "Bash(git clean -n -- src/)", "Do you want to proceed?"], age: 3 },
  },
  {
    ticket: T("linear", "ENG-421", "Rate-limit the public search endpoint", "Engineering", "In Progress", "#f2c94c", 120, "kevin/eng-421-rate-limit-the-public-search-endpoint"),
    branch: "kevin/eng-421-rate-limit-the-public-search-endpoint",
    agent: { status: "working", color: "purple", log: ["Read src/routes/search.ts (212 lines)", "Update(src/middleware/rateLimit.ts)", "Bash(npm test -- search)"], age: 6 },
  },
  {
    ticket: T("clickup", "86b2x7k", "Update pricing page copy for Q4", "Website", "in progress", "#4194f6", 300),
    branch: "cu-86b2x7k-update-pricing-page-copy-for-q4",
    agent: { status: "thinking", color: "green", log: ["Read content/pricing.mdx (140 lines)", 'Searched for "Enterprise" in content/', "✻ Pondering… (8s · ↓ 210 tokens)"], age: 1 },
  },
  {
    ticket: T("linear", "DES-90", "Tooltip arrows misalign in Safari", "Design", "In Progress", "#f2c94c", 600),
    branch: "kevin/des-90-tooltip-arrows-misalign",
    agent: { status: "idle", color: "orange", log: ["✻ Crunched for 2m 10s"], age: 14 },
  },
  {
    ticket: T("github", "#131", "Settings search doesn't match shortcut names", "kevingoenadibrata/workdesk", "Open", null, 3000),
    branch: "131-settings-search-doesnt-match-shortcut-names",
    ageMin: 26 * 60,
  },
  {
    ticket: T("linear", "ENG-409", "Migrate billing webhooks to the new queue", "Engineering", "In Review", "#5e6ad2", 30),
    branch: "kevin/eng-409-migrate-billing-webhooks",
    agent: { status: "idle", color: "yellow", log: ["https://github.com/acme/app/pull/212"], age: 22 },
    pull: { number: 212, url: "https://github.com/acme/app/pull/212", title: "Move billing webhooks to the queue", state: "OPEN", draft: false },
    review: "REVIEW_REQUIRED",
  },
  {
    ticket: T("linear", "DES-88", "Empty states for the onboarding checklist", "Design", "In Review", "#5e6ad2", 240),
    branch: "kevin/des-88-empty-states",
    pull: { number: 198, url: "https://github.com/acme/app/pull/198", title: "Onboarding checklist empty states", state: "OPEN", draft: false },
    review: "APPROVED",
  },
  {
    ticket: T("github", "#57", "Support Windows paths in file links", "acme/cli", "Open", null, 1440),
    branch: "57-support-windows-paths-in-file-links",
    pull: { number: 205, url: "https://github.com/acme/cli/pull/205", title: "Recognize Windows paths in file links", state: "MERGED", draft: false },
  },
];

const LOOSE: { tab: string; harness: Agent["harness"]; status: AgentStatus; color: GroupColor; prompt: string; age: number; log: string[] }[] = [
  { tab: "workdesk", harness: "claude", status: "working", color: "cyan", prompt: "ship this", age: 2, log: ["Bash(git checkout -b ship-flow)", "Bash(git push -u origin ship-flow)", "Bash(gh pr create --fill)"] },
  { tab: "api server", harness: "codex", status: "idle", color: "pink", prompt: "why is /v1/upload slow?", age: 25, log: ["• The upload handler reads the whole body into memory before streaming it to S3."] },
];

const SCENARIOS: Record<string, { backlog: Ticket[]; working: Working[]; loose: typeof LOOSE; connected?: boolean; error?: string }> = {
  "Typical day": { backlog: BACKLOG, working: WORKING, loose: LOOSE },
  "Nothing running": { backlog: BACKLOG, working: WORKING.slice(6, 7), loose: [] },
  "Backlog cleared": { backlog: [], working: WORKING.slice(1, 3).concat(WORKING.slice(5)), loose: LOOSE.slice(0, 1) },
  "Not connected": { backlog: [], working: [], loose: LOOSE, connected: false },
  "Token rejected": {
    backlog: BACKLOG.filter((t) => t.provider !== "linear"),
    working: WORKING.slice(0, 1),
    loose: [],
    error: "Linear rejected the token. Reconnect it in Settings → Integrations.",
  },
};

// ---- the mock source ----


let ptyId = 1;
const session = (cwd: string) => ({ ptyId: ptyId++, cwd, startCwd: cwd }) as unknown as TermSession;
const SERVERS: Server[] = [
  { key: "http://localhost:1420", session: session("/Users/me/Projects/workdesk"), tabTitle: "workdesk", color: "var(--group-cyan)", scheme: "http", host: "localhost", port: 1420, live: true, name: "vite", since: Date.now() - 40 * MIN },
  { key: "http://api.localhost:3000", session: session("/Users/me/Projects/api"), tabTitle: "api server", color: "var(--group-pink)", scheme: "http", host: "api.localhost", port: 3000, live: true, name: "node", since: Date.now() - 2 * 60 * MIN },
  { key: "http://localhost:5432", session: null, tabTitle: null, color: null, scheme: "http", host: "localhost", port: 5432, live: true, name: "postgres", since: Date.now() - 26 * 60 * MIN },
  { key: "http://localhost:6006", session: session("/Users/me/Projects/app"), tabTitle: "ENG-421", color: "var(--group-purple)", scheme: "http", host: "localhost", port: 6006, live: false, name: "storybook", since: Date.now() - 12 * MIN },
];

const color = (c: GroupColor) => `var(--group-${c})`;

function agent(tab: string, harness: Agent["harness"], status: AgentStatus, c: GroupColor, cwd: string, ageMin: number, log: string[], prompt: string | null, from?: AgentStatus): Agent {
  return { harness, status, prompt, detail: null, session: session(cwd), tabTitle: tab, color: color(c), lastLog: log, since: Date.now() - ageMin * MIN, from };
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
let runs = new RunStore(() => {}, false);
let agents: Agent[] = [];
let state = SCENARIOS["Typical day"];
let tickets: Ticket[] = [];
let pulls: PullRequest[] = [];
let refreshing = false;

function load(name: string) {
  state = SCENARIOS[name];
  runs = new RunStore(() => {}, false);
  runs.onChange(emit);
  tickets = [...state.backlog];
  agents = [];
  pulls = [];
  for (const w of state.working) {
    const path = `/Users/me/.workdesk/worktrees/app/${w.branch.replace(/\//g, "-")}`;
    runs.add({
      key: runKey(w.ticket),
      ticket: { provider: w.ticket.provider, id: w.ticket.id, title: w.ticket.title, url: w.ticket.url },
      path,
      root: "/Users/me/app",
      repo: w.pull?.url.split("/")[4] ?? "app",
      branch: w.branch,
      promptFile: "",
      sessionId: "",
      startedAt: Date.now() - (w.ageMin ?? 60) * MIN,
      pull: w.pull ?? null,
    });
    if (w.agent) agents.push(agent(w.ticket.id, "claude", w.agent.status, w.agent.color, path, w.agent.age, w.agent.log, null, w.agent.from));
    if (w.pull?.state === "OPEN")
      pulls.push({ kind: "authored", id: `#${w.pull.number}`, title: w.pull.title, url: w.pull.url, repo: "acme/app", author: "me", draft: false, review: w.review ?? null, branch: w.branch, updated: iso(10) });
    // A ticket with a run is still assigned to you, so the ticket list has it too.
    tickets.push(w.ticket);
  }
  for (const l of state.loose) agents.push(agent(l.tab, l.harness, l.status, l.color, `/Users/me/Projects/${l.tab.replace(/ /g, "-")}`, l.age, l.log, l.prompt));
  runs.setAgents(agents);
}

const source: HomeSource = {
  tickets: () => {
    const connected = state.connected !== false;
    return { connected, loading: false, refreshing, tickets: connected ? tickets : [], errors: state.error ? [{ provider: "linear", error: state.error }] : [] };
  },
  runs: () => runs.all,
  runState: (run) => runs.state(run),
  agentFor: (run) => runs.agentFor(run),
  agents: () => agents,
  pullFor: (branch) => pulls.find((p) => p.branch === branch),
  usage: {
    status: async () => ({
      claude: { windows: [{ minutes: 300, usedPercent: 22, resetsAt: inSec(192) }, { minutes: 10080, usedPercent: 34, resetsAt: inSec(3 * 1440) }], updatedAt: Date.now() },
      codex: { windows: [{ minutes: 300, usedPercent: 11, resetsAt: inSec(232) }, { minutes: 10080, usedPercent: 11, resetsAt: inSec(2 * 1440 + 540) }], updatedAt: Date.now() - 14 * MIN },
      claudeSessionOpen: true,
    }),
    pingClaude: () => Promise.reject("Not in the preview"),
  },
  onChange: (fn) => void listeners.add(fn),
  // A second's spin, like a real read.
  refresh: (force) => {
    if (!force) return;
    refreshing = true;
    emit();
    setTimeout(() => {
      refreshing = false;
      emit();
    }, 1000);
  },
  // Hands over after a beat, like making a worktree does.
  handOver: async (t, branch) => {
    await new Promise((r) => setTimeout(r, 400));
    const path = `/Users/me/.workdesk/worktrees/app/${branch.replace(/\//g, "-")}`;
    runs.add({ key: runKey(t), ticket: { provider: t.provider, id: t.id, title: t.title, url: t.url }, path, root: "/Users/me/app", repo: "app", branch, promptFile: "", sessionId: "", startedAt: Date.now(), pull: null });
    const colors: GroupColor[] = ["blue", "purple", "green", "orange", "pink", "cyan"];
    agents = [agent(t.id, "claude", "thinking", colors[agents.length % colors.length], path, 0, ["Made a worktree from origin/main", "Copied .env", "✻ Reading the ticket…"], null), ...agents];
    runs.setAgents(agents);
    return `Made a worktree for ${branch} in app (from origin/main; copied .env)`;
  },
  startBranch: async (_t, branch) => `Created ${branch} in app`,
  openRun: (run) => console.log("open run", run.key),
  cleanup: async (run) => {
    await new Promise((r) => setTimeout(r, 300));
    tickets = tickets.filter((t) => runKey(t) !== run.key);
    runs.delete(run.key);
    return run.pull?.state === "MERGED" ? `Removed the worktree and ${run.branch}` : `Removed the worktree; kept ${run.branch}, which isn't merged`;
  },
  jumpTo: (a) => console.log("jump to", a.tabTitle),
  openUrl: (url) => console.log("open", url),
  openSettings: () => console.log("settings"),
  servers: () => SERVERS,
  openServer: (server) => console.log("open", server.port),
  jumpToServer: () => console.log("jump to server's pane"),
  dismissServer: (key) => console.log("dismiss", key),
};

// ---- the page and the preview's own controls ----

loadTheme();
const params = new URLSearchParams(location.search);
const page = new HomePage(document.getElementById("preview-host")!, source);
const scenarios = document.getElementById("preview-scenarios")!;
let scenario = params.get("scenario") && SCENARIOS[params.get("scenario")!] ? params.get("scenario")! : "Typical day";
const drawButtons = () =>
  scenarios.replaceChildren(
    ...Object.keys(SCENARIOS).map((name) => {
      const b = el("button", "", name);
      b.setAttribute("aria-pressed", String(name === scenario));
      b.addEventListener("click", () => {
        scenario = name;
        drawButtons();
        page.close();
        load(name);
        page.open();
      });
      return b;
    }),
  );
drawButtons();
load(scenario);
page.open();

const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
for (const t of THEMES) themeSelect.add(new Option(t.name, t.name, false, t.name === currentTheme().name));
const wanted = params.get("theme");
const theme = wanted && THEMES.find((x) => x.name.toLowerCase() === wanted.toLowerCase());
if (theme) {
  setTheme(theme);
  themeSelect.value = theme.name;
}
themeSelect.addEventListener("change", () => setTheme(THEMES.find((t) => t.name === themeSelect.value)!));

// ?filter=1 opens the filter menu with Linear picked, for screenshots.
if (params.get("filter")) {
  document.querySelector<HTMLElement>(".home-filter")?.click();
  [...document.querySelectorAll<HTMLElement>(".home-option")].find((b) => b.textContent?.startsWith("Linear"))?.click();
}

// ?ticket=1 opens the first backlog ticket's details, for screenshots.
if (params.get("ticket")) document.querySelector<HTMLElement>(".home-card.backlog")?.click();

// ?servers=1 opens the Local servers drawer, for screenshots.
if (params.get("servers")) document.querySelector<HTMLElement>(".home-servers")?.click();
