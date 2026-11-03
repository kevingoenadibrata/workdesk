// The phone mirror's web app (WD-24). Served by Workdesk itself
// (src-tauri/src/phone.rs) over Tailscale, it lists the Mac's tabs and agents
// and shows any terminal live. It can only look: nothing typed here reaches
// the Mac. It's drawn like the Mac app: the sidebar's tab rows, the pane
// header and status bar's chips, Home's status badges.

import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./phone.css";
import { Bell, ChevronLeft, ChevronRight, Folder, Globe, SquareTerminal, icon } from "../icons";
import type { PhonePane, PhoneState, PhoneTab } from "../phoneFeed";

const $ = <T extends HTMLElement>(tag: string, className = "", text?: string): T => {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** Dev only: `?demo` shows made-up tabs, to work on the look without a phone. */
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");

// ---- page ----

const bar = $("header", "bar");
const brand = $("div", "brand", "Workdesk");
const live = $("span", "live");
const bell = $<HTMLButtonElement>("button", "icon-button bell");
bell.setAttribute("aria-label", "Notifications");
bell.append(icon(Bell, 17));
bar.append(brand, live, bell);

const banner = $("div", "banner");
banner.hidden = true;
const list = $("main", "list");

const termView = $("section", "term-view");
termView.hidden = true;
const termBar = $("header", "bar term-bar");
const back = $<HTMLButtonElement>("button", "icon-button back");
back.setAttribute("aria-label", "Back to tabs");
back.append(icon(ChevronLeft, 20));
const termTitle = $("div", "term-title");
const zoom = $<HTMLButtonElement>("button", "chip zoom", "Zoom");
termBar.append(back, termTitle, zoom);
const termBox = $("div", "term-box");
const termHost = $("div", "term-host");
termBox.append(termHost);
const termStatus = $("footer", "term-status");
termView.append(termBar, termBox, termStatus);

const sheet = $("div", "sheet");
sheet.hidden = true;

document.body.append(bar, banner, list, termView, sheet);

// ---- theme: the same variables the Mac app paints (src/themes.ts) ----

function paint(t: PhoneState["theme"]) {
  const mix = (pct: number, base = t.bg) => `color-mix(in srgb, ${t.fg} ${pct}%, ${base})`;
  const vars: Record<string, string> = {
    "--bg": t.bg,
    "--text": t.fg,
    "--sidebar": mix(t.light ? 4 : 3.5),
    "--raised": t.light ? mix(1.5) : mix(7),
    "--sunken": t.light ? mix(3.5) : `color-mix(in srgb, ${t.bg} 70%, #000)`,
    "--muted": mix(58),
    "--faint": mix(38),
    "--accent": t.accent,
    "--danger": t.danger,
  };
  for (const [name, hex] of Object.entries(t.groups ?? {})) vars[`--group-${name}`] = hex;
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  document.documentElement.style.colorScheme = t.light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", vars["--sidebar"]);
  if (term) term.options.theme = t.term;
}

// ---- the tab list ----

let state: PhoneState | null = null;
let openPty: number | null = null;

function since(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

/** The sidebar's miniature of a tab's pane grid. */
function layoutGlyph(tab: PhoneTab) {
  const glyph = $("span", "tab-layout");
  for (const rows of tab.columns.length ? tab.columns : [1]) {
    const col = $("span", "tab-layout-col");
    for (let i = 0; i < rows; i++) col.append($("span", "tab-layout-pane"));
    glyph.append(col);
  }
  return glyph;
}

function badge(a: NonNullable<PhonePane["agent"]>, withTime = true) {
  const b = $("span", "badge", withTime ? `${a.label} · ${since(a.since)}` : a.label);
  b.dataset.status = a.status;
  return b;
}

/** What a pane is: its program (or agent) and folder, as the pane's chips show them. */
function paneMeta(pane: PhonePane) {
  const meta = $("div", "pane-meta");
  const what = $("span", "meta-item");
  what.append(icon(pane.kind === "web" ? Globe : SquareTerminal, 12), pane.agent?.harness ?? pane.name);
  meta.append(what);
  if (pane.cwd) {
    const where = $("span", "meta-item cwd");
    where.append(icon(Folder, 12), pane.cwd);
    meta.append(where);
  }
  return meta;
}

/** One pane: its agent's detail and latest lines, if it runs one (and isn't already shown under "Needs you"). */
function paneBody(row: HTMLElement, pane: PhonePane, brief = false) {
  row.append(paneMeta(pane));
  const a = pane.agent;
  if (!a || brief) return;
  if (a.detail) row.append($("div", "pane-detail", a.detail));
  if (a.lastLog.length) {
    const log = $("div", "pane-log");
    for (const line of a.lastLog.slice(-3)) log.append($("div", "", line));
    row.append(log);
  }
}

function canOpen(pane: PhonePane) {
  return pane.pty != null && pane.kind !== "web";
}

/** A tab as the sidebar draws it; one with a single pane opens straight to its terminal. */
function tabRow(tab: PhoneTab) {
  const single = tab.panes.length === 1 ? tab.panes[0] : null;
  const row = $<HTMLButtonElement>("button", "row tab");
  row.style.setProperty("--group-color", tab.color);
  row.classList.toggle("active", tab.active);
  const head = $("div", "row-head");
  head.append(layoutGlyph(tab), $("span", "tab-title", tab.title));
  if (single?.agent) head.append(badge(single.agent));
  const go = single && canOpen(single);
  if (go) head.append(icon(ChevronRight, 16, "row-chevron"));
  row.append(head);
  if (single) {
    paneBody(row, single, !!single.agent?.needsYou);
    if (go) row.addEventListener("click", () => openTerminal(single.pty!));
    else row.disabled = true;
    return [row];
  }
  row.disabled = true;
  const panes = tab.panes.map((pane) => {
    const sub = $<HTMLButtonElement>("button", "row pane");
    sub.style.setProperty("--group-color", tab.color);
    const subHead = $("div", "row-head");
    subHead.append($("span", "pane-dot"), $("span", "pane-name", pane.agent?.harness ?? pane.name));
    if (pane.agent) subHead.append(badge(pane.agent));
    if (canOpen(pane)) subHead.append(icon(ChevronRight, 16, "row-chevron"));
    sub.append(subHead);
    paneBody(sub, pane, !!pane.agent?.needsYou);
    sub.querySelector(".pane-meta .meta-item:not(.cwd)")?.remove();
    if (canOpen(pane)) sub.addEventListener("click", () => openTerminal(pane.pty!));
    else sub.disabled = true;
    return sub;
  });
  return [row, ...panes];
}

function renderList() {
  if (!state) return;
  const nodes: HTMLElement[] = [];
  const needs = state.tabs.flatMap((t) => t.panes.filter((p) => p.agent?.needsYou).map((p) => ({ t, p })));
  if (needs.length) {
    nodes.push($("div", "section-label needs-label", "Needs you"));
    for (const { t, p } of needs) {
      const row = $<HTMLButtonElement>("button", "row needs");
      row.style.setProperty("--group-color", t.color);
      const head = $("div", "row-head");
      head.append(layoutGlyph(t), $("span", "tab-title", t.title), badge(p.agent!));
      if (canOpen(p)) head.append(icon(ChevronRight, 16, "row-chevron"));
      row.append(head);
      paneBody(row, p);
      if (canOpen(p)) row.addEventListener("click", () => openTerminal(p.pty!));
      nodes.push(row);
    }
    nodes.push($("div", "section-label", "Tabs"));
  }
  let group: string | null = null;
  for (const tab of state.tabs) {
    if (tab.group !== group) {
      group = tab.group;
      if (group) {
        const header = $("div", "group-header", group);
        header.style.setProperty("--group-color", tab.color);
        nodes.push(header);
      }
    }
    const rows = tabRow(tab);
    if (tab.group) for (const r of rows) r.classList.add("in-group");
    nodes.push(...rows);
  }
  if (!state.tabs.length) nodes.push($("p", "empty", "No tabs open in Workdesk."));
  list.replaceChildren(...nodes);
  if (openPty != null) {
    const found = findPane(openPty);
    if (found) termStatusFor(found.tab, found.pane);
  }
}

function findPane(pty: number) {
  for (const tab of state?.tabs ?? []) for (const pane of tab.panes) if (pane.pty === pty) return { tab, pane };
  return null;
}

// ---- connection ----

function setLive(kind: "live" | "connecting" | "down", text: string) {
  live.className = `live is-${kind}`;
  live.textContent = text;
}

/** Why the server turned us away, in its words, or a guess. */
async function whyDown(): Promise<string> {
  try {
    const res = await fetch("/api/push/key", { cache: "no-store" });
    if (res.ok) return "";
    if (res.status === 502 || res.status === 503 || res.status === 504) return "Workdesk isn't running on your Mac.";
    return (await res.text()) || `The Mac answered ${res.status}.`;
  } catch {
    return "Can't reach your Mac. Is Tailscale on, on this phone?";
  }
}

let stateSource: EventSource | null = null;

function showState(next: PhoneState) {
  state = next;
  paint(next.theme);
  banner.hidden = true;
  setLive("live", "Live");
  renderList();
}

function connectState() {
  if (demo) {
    void import("./demo").then((d) => showState(d.demoState()));
    return;
  }
  stateSource?.close();
  setLive("connecting", "Connecting");
  const src = new EventSource("/api/state");
  stateSource = src;
  src.addEventListener("state", (e) => {
    const next = JSON.parse((e as MessageEvent).data) as PhoneState;
    if (next.tabs) showState(next);
  });
  src.onerror = async () => {
    setLive("connecting", "Reconnecting");
    if (src.readyState !== EventSource.CLOSED) return;
    const why = await whyDown();
    if (why) {
      banner.textContent = why;
      banner.hidden = false;
      setLive("down", "Offline");
    }
    setTimeout(() => stateSource === src && connectState(), 4000);
  };
}

// ---- a terminal ----

let term: Terminal | null = null;
let termSource: EventSource | null = null;
let size = { cols: 80, rows: 24 };
/** Fit the whole width on screen, or show it larger and scroll sideways. */
let fit = true;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Width of one cell per pixel of font size, measured once in the terminal's font. */
let cellRatio = 0;
function measureCell(family: string) {
  const probe = $("span", "", "M".repeat(50));
  probe.style.cssText = `position:absolute;visibility:hidden;font-size:100px;font-family:${family};white-space:pre`;
  document.body.append(probe);
  cellRatio = probe.getBoundingClientRect().width / 50 / 100 || 0.6;
  probe.remove();
}

function layoutTerm() {
  if (!term) return;
  const width = termBox.clientWidth;
  const fitted = Math.max(3, Math.min(14, Math.floor((width / (size.cols * cellRatio)) * 10) / 10));
  term.options.fontSize = fit ? fitted : Math.max(fitted, 11);
  zoom.textContent = fit ? "Zoom" : "Fit";
  termBox.classList.toggle("scroll-x", !fit);
}

function termStatusFor(tab: PhoneTab, pane: PhonePane) {
  termTitle.replaceChildren(layoutGlyph(tab), $("span", "tab-title", tab.title));
  termTitle.style.setProperty("--group-color", tab.color);
  const meta = paneMeta(pane);
  meta.querySelectorAll(".meta-item").forEach((m) => m.classList.add("chip"));
  if (pane.agent) meta.prepend(badge(pane.agent, false));
  termStatus.replaceChildren(meta);
  if (pane.agent?.detail) termStatus.append($("div", "term-detail", pane.agent.detail));
}

function openTerminal(pty: number) {
  closeTerminal(false);
  openPty = pty;
  const found = findPane(pty);
  if (found) termStatusFor(found.tab, found.pane);
  list.hidden = true;
  bar.hidden = true;
  banner.hidden = true;
  termView.hidden = false;
  if (location.hash !== `#pty=${pty}`) history.pushState(null, "", `${location.search}#pty=${pty}`);

  const family = getComputedStyle(document.documentElement).getPropertyValue("--code").trim();
  if (!cellRatio) measureCell(family);
  term = new Terminal({
    disableStdin: true,
    cursorBlink: false,
    scrollback: 3000,
    fontFamily: family,
    theme: state?.theme.term,
  });
  term.open(termHost);
  // Scrolling and selecting still work; keystrokes go nowhere.
  term.textarea?.setAttribute("readonly", "");
  term.textarea?.setAttribute("inputmode", "none");

  const showSnapshot = (snap: { cols: number; rows: number; data: string }) => {
    size = { cols: snap.cols, rows: snap.rows };
    term!.reset();
    term!.resize(snap.cols, snap.rows);
    layoutTerm();
    term!.write(snap.data);
  };
  if (demo) {
    void import("./demo").then((d) => showSnapshot(d.demoScreen(found?.pane ?? null)));
    return;
  }
  const src = new EventSource(`/api/pty/${pty}`);
  termSource = src;
  src.addEventListener("snapshot", (e) => showSnapshot(JSON.parse((e as MessageEvent).data)));
  src.addEventListener("data", (e) => term?.write(decode((e as MessageEvent).data)));
  src.addEventListener("resize", (e) => {
    size = JSON.parse((e as MessageEvent).data);
    term?.resize(size.cols, size.rows);
    layoutTerm();
  });
  src.addEventListener("exit", () => {
    termStatus.replaceChildren($("div", "term-detail", "This terminal closed."));
    src.close();
  });
}

function closeTerminal(navigate = true) {
  termSource?.close();
  termSource = null;
  term?.dispose();
  term = null;
  openPty = null;
  termView.hidden = true;
  list.hidden = false;
  bar.hidden = false;
  if (navigate && location.hash) history.pushState(null, "", location.pathname + location.search);
}

back.addEventListener("click", () => closeTerminal());
zoom.addEventListener("click", () => {
  fit = !fit;
  layoutTerm();
});
window.addEventListener("resize", layoutTerm);

function route() {
  const m = /^#pty=(\d+)$/.exec(location.hash);
  if (m) {
    if (Number(m[1]) !== openPty) openTerminal(Number(m[1]));
  } else if (openPty != null) closeTerminal(false);
}
window.addEventListener("popstate", route);

// ---- notifications ----

const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSub(): Promise<PushSubscription | null> {
  if (!canPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function syncBell() {
  const sub = await currentSub().catch(() => null);
  bell.classList.toggle("on", !!sub);
}

function b64urlToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return decode((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    if (!r.ok) throw new Error((await r.text()) || `Failed (${r.status})`);
  });

function showSheet(title: string, body: string, actions: { label: string; run?: () => Promise<void> | void; primary?: boolean }[]) {
  const card = $("div", "sheet-card");
  const msg = $("p", "sheet-body", body);
  const buttons = $("div", "sheet-actions");
  for (const a of actions) {
    const b = $<HTMLButtonElement>("button", a.primary ? "sheet-button primary" : "sheet-button", a.label);
    b.addEventListener("click", async () => {
      if (!a.run) return void (sheet.hidden = true);
      b.disabled = true;
      try {
        await a.run();
        sheet.hidden = true;
      } catch (e) {
        msg.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        b.disabled = false;
      }
    });
    buttons.append(b);
  }
  card.append($("h2", "sheet-title", title), msg, buttons);
  sheet.replaceChildren(card);
  sheet.hidden = false;
}
sheet.addEventListener("click", (e) => e.target === sheet && (sheet.hidden = true));

async function subscribe() {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them for Workdesk in the phone's Settings.");
  const reg = await navigator.serviceWorker.ready;
  const { key } = await (await fetch("/api/push/key")).json();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) as BufferSource });
  await post("/api/push/subscribe", sub.toJSON());
  await post("/api/push/test", { endpoint: sub.endpoint });
  await syncBell();
}

bell.addEventListener("click", async () => {
  if (!canPush() || !standalone()) {
    return showSheet(
      "Add Workdesk to your Home Screen",
      "Phones only send notifications to web apps on the Home Screen. In Safari, tap Share → Add to Home Screen, then open Workdesk from there and tap the bell again.",
      [{ label: "OK", primary: true }],
    );
  }
  const sub = await currentSub();
  if (!sub) {
    return showSheet("Get notified", "Your phone buzzes when an agent needs you or finishes, while you're away from the Mac.", [
      { label: "Not now" },
      { label: "Turn on", primary: true, run: subscribe },
    ]);
  }
  showSheet("Notifications are on", "You'll hear when an agent needs you or finishes, while Workdesk isn't in front on the Mac.", [
    {
      label: "Turn off",
      run: async () => {
        await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
        await syncBell();
      },
    },
    { label: "Send a test", run: () => post("/api/push/test", { endpoint: sub.endpoint }) },
    { label: "Done", primary: true },
  ]);
});

if ("serviceWorker" in navigator && !demo) {
  void navigator.serviceWorker.register("/phone-sw.js").then(syncBell, () => {});
  // A tapped notification, with the app already open.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.open != null) openTerminal(Number(e.data.open));
  });
}

// Times on the badges.
setInterval(() => !list.hidden && renderList(), 15_000);
// iOS suspends the page in the background; pick up where the Mac is now.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  connectState();
  if (openPty != null) openTerminal(openPty);
});

connectState();
route();
