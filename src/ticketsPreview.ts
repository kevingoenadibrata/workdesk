// Dev-only: the real Tickets page (and Settings → Integrations) fed mock
// tickets, for checking the design in a browser. Open /tickets-preview.html on
// the dev server. ?settings=1 shows Settings, ?empty=1 nothing connected,
// ?error=1 a rejected token.
import "./styles.css";
import { TicketsPage, ticketStore, type PullRequest, type Ticket } from "./tickets";
import { RunStore, type Run } from "./runs";
import type { Agent } from "./monitor";
import { Settings } from "./settings";
import { THEMES, currentTheme, loadTheme, setTheme } from "./themes";

const params = new URLSearchParams(location.search);
const H = 3600_000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

const TICKETS: Record<string, Ticket[]> = {
  github: [
    { provider: "github", id: "#142", title: "Diff sheet doesn't show untracked files", url: "https://github.com/kevingoenadibrata/workdesk/issues/142", project: "kevingoenadibrata/workdesk", status: "Open", color: null, updated: iso(0.4 * H), branch: null },
    { provider: "github", id: "#138", title: "Local Servers: Docker containers show as outside servers", url: "https://github.com/kevingoenadibrata/workdesk/issues/138", project: "kevingoenadibrata/workdesk", status: "Open", color: null, updated: iso(26 * H), branch: null },
    { provider: "github", id: "#57", title: "Support Windows paths in file links", url: "https://github.com/acme/cli/issues/57", project: "acme/cli", status: "Open", color: null, updated: iso(9 * 24 * H), branch: null },
  ],
  linear: [
    { provider: "linear", id: "ENG-421", title: "Rate-limit the public search endpoint", url: "https://linear.app/acme/issue/ENG-421", project: "Engineering", status: "In Progress", color: "#f2c94c", updated: iso(2 * H), branch: "kevin/eng-421-rate-limit-the-public-search-endpoint" },
    { provider: "linear", id: "ENG-409", title: "Migrate billing webhooks to the new queue", url: "https://linear.app/acme/issue/ENG-409", project: "Engineering", status: "Todo", color: "#e2e2e2", updated: iso(30 * H), branch: "kevin/eng-409-migrate-billing-webhooks" },
    { provider: "linear", id: "DES-88", title: "Empty states for the onboarding checklist", url: "https://linear.app/acme/issue/DES-88", project: "Design", status: "In Review", color: "#5e6ad2", updated: iso(4 * 24 * H), branch: "kevin/des-88-empty-states" },
    { provider: "linear", id: "ENG-377", title: "Flaky test: checkout flow times out on CI when the cart has more than fifty items", url: "https://linear.app/acme/issue/ENG-377", project: "Engineering", status: "Backlog", color: "#bec2c8", updated: iso(20 * 24 * H), branch: null },
  ],
  clickup: [
    { provider: "clickup", id: "86b2x7k", title: "Update pricing page copy for Q4", url: "https://app.clickup.com/t/86b2x7k", project: "Website", status: "in progress", color: "#4194f6", updated: String(Date.now() - 5 * H), branch: null },
    { provider: "clickup", id: "OPS-12", title: "Rotate staging database credentials", url: "https://app.clickup.com/t/OPS-12", project: "Ops backlog", status: "to do", color: "#d3d3d3", updated: String(Date.now() - 3 * 24 * H), branch: null },
  ],
};

const PULLS: PullRequest[] = [
  { kind: "review", id: "#5758", title: "Run H100 agent-simulation sandboxes on Daytona", url: "https://github.com/acme/api/pull/5758", repo: "acme/api", author: "albertp", draft: false, review: "APPROVED", branch: "cursor/h100-daytona", updated: iso(3 * H) },
  { kind: "review", id: "#5741", title: "Cache the pricing table between requests", url: "https://github.com/acme/api/pull/5741", repo: "acme/api", author: "mira", draft: false, review: "REVIEW_REQUIRED", branch: "mira/pricing-cache", updated: iso(28 * H) },
  { kind: "authored", id: "#5930", title: "Dismiss ready suggestions and clear rejected actions", url: "https://github.com/acme/api/pull/5930", repo: "acme/api", author: "kevingoenadibrata", draft: false, review: "REVIEW_REQUIRED", branch: "kevin/dismiss-suggestions", updated: iso(0.5 * H) },
  { kind: "authored", id: "#295", title: "Multi-page custom report templates", url: "https://github.com/acme/reports/pull/295", repo: "acme/reports", author: "kevingoenadibrata", draft: false, review: "CHANGES_REQUESTED", branch: "feat/custom-report-multi-page", updated: iso(6 * H) },
  { kind: "authored", id: "#14", title: "Add a Tickets page for GitHub, Linear and ClickUp", url: "https://github.com/kevingoenadibrata/workdesk/pull/14", repo: "kevingoenadibrata/workdesk", author: "kevingoenadibrata", draft: true, review: null, branch: "tickets-page", updated: iso(50 * H) },
];

// ?many=1 adds enough tickets to page through.
if (params.get("many")) {
  const statuses: [string, string][] = [["Todo", "#e2e2e2"], ["In Progress", "#f2c94c"], ["In Review", "#5e6ad2"], ["Backlog", "#bec2c8"]];
  const verbs = ["Fix", "Add", "Refactor", "Document", "Speed up", "Remove"];
  const things = ["the login redirect", "webhook retries", "the settings form", "CSV export", "dark mode tokens", "search indexing", "rate limits"];
  for (let i = 0; i < 64; i++) {
    const [status, color] = statuses[i % statuses.length];
    TICKETS.linear.push({ provider: "linear", id: `ENG-${300 + i}`, title: `${verbs[i % verbs.length]} ${things[i % things.length]}`, url: `https://linear.app/acme/issue/ENG-${300 + i}`, project: i % 3 ? "Engineering" : "Platform", status, color, updated: iso((i * 7 + 3) * H), branch: null });
  }
}

const connected = params.get("empty") ? [] : ["github", "linear", "clickup"];
// Stands in for Tauri.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async (cmd: string, args: { provider?: string }) => {
    await new Promise((r) => setTimeout(r, 150));
    if (cmd === "tickets_accounts") return ["github", "clickup", "linear"].map((p) => ({ provider: p, source: connected.includes(p) ? (p === "github" ? "gh" : "keychain") : null }));
    if (cmd === "tickets_list") {
      if (params.get("error") && args.provider === "clickup") throw "ClickUp rejected the token. Reconnect it in Settings → Integrations.";
      return TICKETS[args.provider!] ?? [];
    }
    if (cmd === "tickets_pulls") return PULLS;
    if (cmd === "tickets_whoami") return { github: "kevingoenadibrata", linear: "Kevin G", clickup: "kevin" }[args.provider!];
    if (cmd === "tickets_connect") throw "Linear rejected the token. Reconnect it in Settings → Integrations.";
    return null;
  },
};

// ?view={...} starts with those filters; ?click=selector clicks something once loaded.
const view = params.get("view");
if (view) {
  try {
    localStorage.setItem("workdesk.ticketsView", view);
  } catch {}
}
const click = params.get("click");
if (click) setTimeout(() => document.querySelectorAll<HTMLElement>(click)[Number(params.get("nth") ?? 0)]?.click(), 700);

loadTheme();
// Tickets Claude is working on: ?runs=0 hides them.
const runs = new RunStore(() => {}, false);
if (params.get("runs") !== "0") {
  const run = (provider: Ticket["provider"], id: string, pull: Run["pull"] = null): Run => ({
    key: `${provider}:${id}`,
    ticket: { provider, id, title: "", url: "" },
    path: `/Users/me/.workdesk/worktrees/app/${id}`,
    root: "/Users/me/app",
    repo: "app",
    branch: id.toLowerCase(),
    promptFile: "",
    sessionId: "",
    startedAt: Date.now(),
    pull,
  });
  const mocks = [
    run("linear", "ENG-421"),
    run("github", "#142"),
    run("linear", "ENG-409", { number: 212, url: "https://github.com/acme/app/pull/212", title: "Move billing webhooks to the queue", state: "OPEN", draft: false }),
    run("linear", "DES-88", { number: 198, url: "https://github.com/acme/app/pull/198", title: "Onboarding empty states", state: "MERGED", draft: false }),
    run("github", "#57"),
  ];
  for (const r of mocks) runs.add(r);
  const agent = (r: Run, status: Agent["status"]) => ({ harness: "claude", status, session: { cwd: r.path, startCwd: r.path } }) as unknown as Agent;
  runs.setAgents([agent(mocks[0], "working"), agent(mocks[1], "waiting")]);
}

const host = document.getElementById("preview-host")!;
if (params.get("settings")) {
  try {
    localStorage.setItem("workdesk.settingsPage", "integrations");
  } catch {}
  new Settings(host).open();
} else {
  new TicketsPage(
    host,
    ticketStore,
    async (_t, branch) => `Created ${branch} in workdesk`,
    () => console.log("settings"),
    (url) => console.log("open", url),
    {
      store: runs,
      start: async (t, branch) => `Made a worktree for ${branch} in workdesk (from origin/main) for ${t.id}`,
      open: (run) => console.log("open run", run.key),
      cleanup: async (run) => `Removed the worktree and ${run.branch}`,
    },
  ).open();
}
void ticketStore.refresh();

const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
for (const t of THEMES) themeSelect.add(new Option(t.name, t.name, false, t.name === currentTheme().name));
themeSelect.addEventListener("change", () => setTheme(THEMES.find((t) => t.name === themeSelect.value)!));
const themeAsked = params.get("theme");
if (themeAsked) {
  const t = THEMES.find((t) => t.name === themeAsked);
  if (t) setTheme(t);
}
// ?toast=text shows a toast, for checking its look (headless browsers never finish copying).
const toastText = params.get("toast");
if (toastText) void import("./toast").then(({ showToast }) => setTimeout(() => showToast(toastText, 60_000), 600));
