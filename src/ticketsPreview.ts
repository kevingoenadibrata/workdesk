// Dev-only: the real Tickets page (and Settings → Integrations) fed mock
// tickets, for checking the design in a browser. Open /tickets-preview.html on
// the dev server. ?settings=1 shows Settings, ?empty=1 nothing connected,
// ?error=1 a rejected token.
import "./styles.css";
import { TicketsPage, ticketStore, type Ticket } from "./tickets";
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
