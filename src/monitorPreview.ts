// Dev-only: the real Monitor page fed mock agents, for checking card designs
// in a browser without running agents. Open /monitor-preview.html on the dev server.
import "./styles.css";
import { FADED_LINES, MonitorPage, lastLog, type Agent } from "./monitor";
import { logLines, setLogLines, MIN_LOG_LINES, MAX_LOG_LINES } from "./monitorSettings";
import { THEMES, currentTheme, loadTheme, setTheme } from "./themes";
import type { AgentStatus, AgentInfo } from "./pty";
import type { TermSession } from "./terminal";
import type { GroupColor } from "./themes";

/** A mock agent: `age` is how long it's been in its status, in ms. */
interface Mock {
  tab: string;
  harness?: AgentInfo["harness"];
  status: AgentStatus;
  from?: AgentStatus;
  color?: GroupColor;
  prompt?: string | null;
  log?: string[];
  age?: number;
}

const SEC = 1000;
const MIN = 60 * SEC;

const LOG = {
  thinking: ["Read src/styles.css (3400 lines)", "Read src/pty.ts (88 lines)", "Read src/monitor.ts (412 lines)", "Searched for \"agent-badge\" in src/", "✻ Marinating… (12s · ↓ 312 tokens)"],
  working: ["Read src/styles.css (3400 lines)", "Searched for \".agent-badge\" in src/styles.css", "Update(src/styles.css)", "  ⎿  Updated src/styles.css with 14 additions and 9 removals", "Bash(npm run build)", "  ⎿  Running…"],
  waiting: ["Bash command", "  rm -rf src-tauri/target/release/bundle", "Do you want to proceed?", "❯ 1. Yes", "  2. No, and tell Claude what to do differently (esc)"],
  question: ["What's your budget?", "❯ 1. Under $500", "  2. $500–$1,000", "  3. No limit", "  4. Type something"],
  idle: ["Bash(npx tsc --noEmit -p .)", "TSC OK", "Opus 5.5 · Claude Pro", "/Users/kevingo/Projects/workdesk", "✻ Crunched for 40s · done 10:42 AM"],
  error: ["Compiling workdesk v0.1.1", "warning: unused variable `tails`", "Bash(cargo build --release)", "  ⎿  error[E0425]: cannot find value `tails` in this scope", "API Error: 529 Overloaded. Retrying in 8s…"],
  codexError: ["• Ran npm test", "■ stream disconnected before completion: error sending request"],
  long: [
    "Bash(rg --files-with-matches 'harnessLogo|agent-badge|agent-avatar|BADGE_LABELS' src/ --type ts --glob '!**/node_modules/**')",
    "  ⎿  src/monitor.ts src/harnessLogos.ts src/styles.css src/settings.ts src/monitorSettings.ts src/monitorPreview.ts",
    "A very long line that keeps going well past the edge of the card so we can see how ellipsis truncation behaves on narrow widths",
  ],
};

const SCENARIOS: Record<string, Mock[]> = {
  "Typical day": [
    { tab: "workdesk", status: "waiting", color: "blue", prompt: "ship this", log: LOG.waiting, age: 40 * SEC },
    { tab: "Split", status: "thinking", color: "purple", prompt: "make user prompt in a terminal box, make log card X lines long, configurable in settings", log: LOG.thinking, age: 12 * SEC },
    { tab: "api server", harness: "codex", status: "working", color: "green", prompt: "add rate limiting to /v1/upload", log: LOG.working, age: 2 * MIN },
    { tab: "Testing Bot", status: "idle", color: "orange", prompt: null, log: LOG.idle, age: 3 * MIN },
    { tab: "docs", harness: "opencode", status: "idle", color: "cyan", prompt: "fix the broken links in README", log: ["Done. Fixed 4 links."], age: 25 * MIN },
  ],
  "Every status": [
    { tab: "Thinking", status: "thinking", color: "purple", prompt: "why is the dmg step slow?", log: LOG.thinking },
    { tab: "Working", status: "working", color: "blue", prompt: "run the build and fix any type errors", log: LOG.working },
    { tab: "Waiting · permission", status: "waiting", color: "yellow", prompt: "clean up old bundles", log: LOG.waiting },
    { tab: "Waiting · question", status: "waiting", color: "pink", prompt: "i want to buy a new ipad, what do you recommend, but before you decide, ask me questions first", log: LOG.question },
    { tab: "Error", status: "error", color: "red", prompt: "build the release", log: LOG.error },
    { tab: "Idle · just finished (happy)", status: "idle", from: "working", color: "green", prompt: "rename the setting", log: LOG.idle, age: 2 * SEC },
    { tab: "Idle", status: "idle", color: "cyan", prompt: "rename the setting", log: LOG.idle, age: 2 * MIN },
    { tab: "Idle · 10 min+ (sleep)", status: "idle", color: "grey", prompt: "rename the setting", log: LOG.idle, age: 15 * MIN },
    { tab: "Unknown (no session file)", status: "unknown", color: "orange", prompt: null, log: [] },
  ],
  "Every harness": [
    { tab: "Claude Code", harness: "claude", status: "working", color: "orange", prompt: "add a badge below the avatar", log: LOG.working },
    { tab: "Codex", harness: "codex", status: "working", color: "green", prompt: "add a badge below the avatar", log: LOG.working },
    { tab: "opencode", harness: "opencode", status: "working", color: "blue", prompt: "add a badge below the avatar", log: LOG.working },
    { tab: "Codex · approval", harness: "codex", status: "waiting", color: "yellow", prompt: "delete the cache dir", log: ["Allow command?", "  rm -rf ~/.cache/workdesk", "(y/n)"] },
    { tab: "Codex · error", harness: "codex", status: "error", color: "red", prompt: "run the tests", log: LOG.codexError },
    { tab: "opencode · idle", harness: "opencode", status: "idle", color: "cyan", prompt: "summarize the diff", log: ["Summary written to CHANGES.md"], age: 3 * MIN },
  ],
  "Edge cases": [
    { tab: "No prompt yet", status: "idle", color: "blue", prompt: null, log: LOG.idle, age: 1 * MIN },
    { tab: "No log", status: "thinking", color: "purple", prompt: "hello", log: [] },
    { tab: "One log line", status: "working", color: "green", prompt: "hello", log: ["Bash(ls)"] },
    {
      tab: "Very long prompt",
      status: "thinking",
      color: "pink",
      prompt:
        "somehow nerdfonts are not installed on my machine, it only works for workdesk, why can't it work for warp or regular terminal? I tried brew install font-jetbrains-mono-nerd-font and restarting, and also checked Font Book, but the glyphs still show as boxes in Terminal.app and in Warp they render as question marks",
      log: LOG.thinking,
    },
    { tab: "Long log lines", status: "working", color: "cyan", prompt: "find every place the badge is used", log: LOG.long },
    {
      tab: "A really really long tab name that should truncate before it hits the badge",
      status: "waiting",
      color: "yellow",
      prompt: "ok?",
      log: ["Do you want to proceed?"],
    },
  ],
  "Tab colors": (["blue", "purple", "green", "orange", "pink", "cyan", "yellow", "red", "grey"] as GroupColor[]).map((color, i) => ({
    tab: color,
    status: (["thinking", "working", "idle"] as AgentStatus[])[i % 3],
    color,
    prompt: `a ${color} tab`,
    log: LOG.idle.slice(-1),
    age: 2 * MIN,
  })),
  Empty: [],
};

// Stable fake sessions, so cards are reused across ticks like in the app.
const sessions = new Map<string, TermSession>();
const sessionFor = (key: string) => {
  let s = sessions.get(key);
  if (!s) sessions.set(key, (s = { key } as unknown as TermSession));
  return s;
};

function agents(name: string): Agent[] {
  const now = Date.now();
  return SCENARIOS[name].map((m) => ({
    harness: m.harness ?? "claude",
    status: m.status,
    prompt: m.prompt === undefined ? "do the thing" : m.prompt,
    detail: null,
    session: sessionFor(`${name}/${m.tab}`),
    tabTitle: m.tab,
    color: m.color ? `var(--group-${m.color})` : "var(--accent)",
    // Through the app's own screen filter, as if these were the pane's last rows.
    lastLog: lastLog(m.log ?? [], logLines() + FADED_LINES),
    since: now - (m.age ?? 20 * SEC),
    from: m.from,
  }));
}

loadTheme();
const host = document.getElementById("preview-host")!;
const page = new MonitorPage(host, () => {});
page.open();

const KEY = "workdesk.monitorPreview";
let scenario = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in SCENARIOS) return saved;
  } catch {}
  return "Typical day";
})();

const render = () => page.update(agents(scenario));

// Scenario buttons
const bar = document.getElementById("preview-scenarios")!;
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
    render();
  });
  bar.append(b);
}
const sync = () => {
  for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.textContent === scenario));
};

// Theme
const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
for (const t of THEMES) themeSelect.add(new Option(t.name, t.name, false, t.name === currentTheme().name));
themeSelect.addEventListener("change", () => setTheme(THEMES.find((t) => t.name === themeSelect.value)!));

// Log lines (the same setting the app uses)
const lines = document.getElementById("preview-lines") as HTMLInputElement;
lines.value = String(logLines());
lines.addEventListener("input", () => {
  const n = parseInt(lines.value, 10);
  if (n >= MIN_LOG_LINES && n <= MAX_LOG_LINES) {
    setLogLines(n);
    render();
  }
});

// Page width, to check narrow cards
const width = document.getElementById("preview-width") as HTMLInputElement;
const body = () => host.querySelector<HTMLElement>(".page-body");
width.value = "680";
width.addEventListener("input", () => {
  const n = parseInt(width.value, 10);
  if (n >= 320) body()?.style.setProperty("max-width", `${n}px`);
});

sync();
render();
// Like the app's polling, so faces and blinks keep moving.
setInterval(render, 1000);
