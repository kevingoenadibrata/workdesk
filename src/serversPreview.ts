// Dev-only: the real Local Servers page fed mock servers, for checking card
// designs in a browser. Open /servers-preview.html on the dev server.
import "./styles.css";
import { ServersPage, type Server } from "./servers";
import { THEMES, currentTheme, loadTheme, setTheme, type GroupColor } from "./themes";
import type { TermSession } from "./terminal";

/** A mock server: `age` is how long it's been up (or stopped), in ms. */
interface Mock {
  /** Its tab; none for a server started outside Workdesk. */
  tab?: string;
  host?: string;
  port: number;
  live?: boolean;
  name?: string;
  color?: GroupColor;
  https?: boolean;
  age?: number;
}

const SEC = 1000;
const MIN = 60 * SEC;

const SCENARIOS: Record<string, Mock[]> = {
  "Typical day": [
    { tab: "web", port: 5173, name: "vite", color: "blue", age: 42 * MIN },
    { tab: "api", host: "api.localhost", port: 3000, name: "tsx", color: "green", age: 3 * 60 * MIN + 12 * MIN },
    { tab: "docs", port: 4321, name: "astro", color: "purple", age: 8 * MIN },
    { tab: "storybook", port: 6006, live: false, name: "storybook", color: "orange", age: 6 * MIN },
    { port: 8742, name: "http", age: 2 * 60 * MIN },
    { port: 3010, name: "berapa-server", age: 25 * MIN },
  ],
  "Just one": [{ tab: "workdesk", port: 1420, name: "vite", color: "blue", age: 25 * SEC }],
  "Subdomains": [
    { tab: "platform", host: "app.localhost", port: 1355, name: "portless", color: "cyan", age: 15 * MIN },
    { tab: "platform", host: "admin.localhost", port: 1355, name: "portless", color: "cyan", age: 15 * MIN },
    { tab: "platform", host: "billing.staging.localhost", port: 1355, name: "portless", color: "cyan", age: 15 * MIN },
    { tab: "auth", host: "auth.localhost", port: 8443, https: true, name: "caddy", color: "pink", age: 2 * MIN },
  ],
  "Full panel (10)": Array.from({ length: 10 }, (_, i) => ({
    tab: ["web", "api", "worker", "docs", "admin", "ml", "proxy", "db-ui", "mail", "jobs"][i],
    port: [3000, 8080, 9229, 4321, 3001, 8000, 8888, 5555, 1080, 7000][i],
    name: ["next-server", "rails", "node", "astro", "vite", "uvicorn", "caddy", "prisma", "mailpit", "sidekiq"][i],
    color: (["blue", "green", "orange", "purple", "pink", "cyan", "yellow", "red", "grey", "blue"] as GroupColor[])[i],
    live: i < 9,
    age: (i + 1) * 7 * MIN,
  })),
  "All stopped": [
    { tab: "web", port: 5173, live: false, name: "vite", color: "blue", age: 2 * MIN },
    { tab: "a really really long tab name that should truncate", host: "something-very-long.preview.localhost", port: 65535, live: false, color: "red", age: 70 * MIN },
  ],
  Empty: [],
};

const sessions = new Map<string, TermSession>();
const sessionFor = (key: string) => {
  let s = sessions.get(key);
  if (!s) sessions.set(key, (s = { key } as unknown as TermSession));
  return s;
};

let dismissed = new Set<string>();

function servers(name: string): Server[] {
  const now = Date.now();
  return SCENARIOS[name]
    .map((m) => {
      const host = m.host ?? "localhost";
      const key = `${name}/${host}:${m.port}`;
      return {
        key,
        session: m.tab ? sessionFor(`${name}/${m.tab}`) : null,
        tabTitle: m.tab ?? null,
        color: m.tab ? (m.color ? `var(--group-${m.color})` : "var(--accent)") : null,
        scheme: m.https ? "https" : "http",
        host,
        port: m.port,
        live: m.live ?? true,
        name: m.name,
        since: now - (m.age ?? 20 * SEC),
      } satisfies Server;
    })
    .filter((s) => !dismissed.has(s.key));
}

loadTheme();
const host = document.getElementById("preview-host")!;
const page = new ServersPage(
  host,
  () => {},
  (key) => {
    dismissed.add(key);
    render();
  },
  (url) => console.log("open", url),
);
page.open();

const KEY = "workdesk.serversPreview";
let scenario = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in SCENARIOS) return saved;
  } catch {}
  return "Typical day";
})();
const asked = new URLSearchParams(location.search).get("scenario");
if (asked && asked in SCENARIOS) scenario = asked;

const render = () => page.update(servers(scenario));

const bar = document.getElementById("preview-scenarios")!;
for (const name of Object.keys(SCENARIOS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = name;
  b.addEventListener("click", () => {
    scenario = name;
    dismissed = new Set();
    try {
      localStorage.setItem(KEY, name);
    } catch {}
    sync();
    render();
  });
  bar.append(b);
}
const sync = () => {
  for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.textContent === scenario));
};

const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
for (const t of THEMES) themeSelect.add(new Option(t.name, t.name, false, t.name === currentTheme().name));
themeSelect.addEventListener("change", () => setTheme(THEMES.find((t) => t.name === themeSelect.value)!));
const themeAsked = new URLSearchParams(location.search).get("theme");
if (themeAsked) {
  const t = THEMES.find((t) => t.name === themeAsked);
  if (t) setTheme(t);
}

const width = document.getElementById("preview-width") as HTMLInputElement;
const body = () => host.querySelector<HTMLElement>(".page-body");
width.value = "1680";
width.addEventListener("input", () => {
  const n = parseInt(width.value, 10);
  if (n >= 320) body()?.style.setProperty("max-width", `${n}px`);
});

sync();
render();
setInterval(render, 1000);
