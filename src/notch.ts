import "./styles.css";
import "./notch.css";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { loadTheme } from "./themes";
import { botSvg } from "./bot";
import { Orbit, TicketPlus, icon } from "./icons";
import { windowLabel, windowSummary, type Usage } from "./usage";
import type { NotchAgent } from "./notchFeed";

declare global {
  interface Window {
    /** The notch's size in points, from src-tauri/src/notch.rs. */
    __NOTCH?: { width: number; height: number };
  }
}

// The black shape around the MacBook notch (see src-tauri/src/notch.rs). It
// matches the notch when there's nothing to show, grows a little to each side
// while agents run, and opens while hovered: the agents, then a bar with New
// ticket and Teleport (which open in Workdesk, where you can type) and usage. Rust tells it
// when it's hovered; it tells Rust how big it is so clicks outside it fall through.
// It also pops open for a moment when an agent stops (goes idle) or starts waiting for you.

loadTheme();
const NOTCH = window.__NOTCH ?? { width: 200, height: 32 };
/** How far the status shows on each side of the notch. */
const EAR = Math.round(NOTCH.height + 6);
const OPEN_WIDTH = Math.max(NOTCH.width + 2 * EAR, 460);
/** How long the pointer can be gone before the panel closes. */
const CLOSE_DELAY = 250;
/** How often to re-read usage; reading is just files, never a ping. */
const USAGE_MS = 60_000;
/** How long the panel stays open after popping up for an agent that stopped or needs you. */
const PEEK_MS = 4_000;
/** Statuses worth popping the panel open for, when an agent moves into one. */
const POP_ON = new Set<NotchAgent["status"]>(["idle", "waiting"]);

const root = document.documentElement;
root.style.setProperty("--notch-h", `${NOTCH.height}px`);
root.style.setProperty("--ear", `${EAR}px`);

const island = document.createElement("div");
island.className = "island";
island.innerHTML = `
  <div class="ear left"></div>
  <div class="ear right"></div>
  <div class="panel">
    <div class="panel-head"><span>Agents</span><span class="panel-count"></span></div>
    <ul class="rows"></ul>
    <div class="panel-foot">
      <button class="act" data-action="ticket"><span>New ticket</span></button>
      <button class="act" data-action="teleport"><span>Teleport</span></button>
      <span class="usage"></span>
    </div>
  </div>`;
document.body.append(island);
const $ = <T extends HTMLElement>(sel: string) => island.querySelector<T>(sel)!;
const leftEar = $(".ear.left");
const rightEar = $(".ear.right");
const rows = $<HTMLUListElement>(".rows");
const count = $(".panel-count");
const panel = $(".panel");
const usage = $(".usage");

const ticketBtn = $(".act[data-action=ticket]");
const teleportBtn = $(".act[data-action=teleport]");
ticketBtn.prepend(icon(TicketPlus, 14));
teleportBtn.prepend(icon(Orbit, 14));
for (const btn of [ticketBtn, teleportBtn]) {
  btn.onclick = () => {
    // The modal opens in Workdesk, so get the panel out of the way.
    collapse();
    void invoke("notch_action", { action: btn.dataset.action });
  };
}

let agents: NotchAgent[] = [];
let open = false;
let closeTimer: number | undefined;
/** Whether the pointer is over the shape, per Rust. */
let hovering = false;
/** Open because an agent changed, not because of the pointer; closes on its own. */
let peeking = false;
let peekTimer: number | undefined;
/** Each agent's status at the last update, to spot the moment it changes. */
const lastStatus = new Map<number, NotchAgent["status"]>();
/** Agents that just popped the panel, highlighted while it's open. */
let fresh = new Set<number>();
/** Closed by a click: stay closed until the pointer leaves, so it doesn't pop back open under it. */
let dismissed = false;

function collapse() {
  clearTimeout(closeTimer);
  endPeek();
  dismissed = true;
  open = false;
  layout();
}

function endPeek() {
  clearTimeout(peekTimer);
  peeking = false;
  if (fresh.size) {
    fresh = new Set();
    for (const li of rows.querySelectorAll(".row.fresh")) li.classList.remove("fresh");
  }
}

/** Opens the panel for a few seconds without the pointer, to show agents that just stopped or need you. */
function peek(ids: number[]) {
  for (const id of ids) fresh.add(id);
  clearTimeout(peekTimer);
  if (!open) void refreshUsage();
  peeking = true;
  open = true;
  peekTimer = window.setTimeout(() => {
    peeking = false;
    // Leave it to the pointer if it's over the panel; it closes when the pointer leaves.
    if (!hovering) {
      endPeek();
      open = false;
      layout();
    }
  }, PEEK_MS);
}

/** The agent the collapsed notch speaks for: one that needs you, else a busy one, else the first. */
function lead(): NotchAgent | undefined {
  return (
    agents.find((a) => a.needsYou) ??
    agents.find((a) => a.status === "working" || a.status === "thinking") ??
    agents[0]
  );
}

function render() {
  const first = lead();
  const waiting = agents.filter((a) => a.needsYou).length;
  leftEar.innerHTML = first ? botSvg(first.face) : "";
  leftEar.style.setProperty("--bot", first?.color ?? "var(--accent)");
  rightEar.textContent = agents.length ? String(waiting || agents.length) : "";
  rightEar.classList.toggle("needs-you", waiting > 0);
  island.classList.toggle("needs-you", waiting > 0);
  count.textContent = agents.length
    ? `${agents.length} running${waiting ? ` · ${waiting} need${waiting === 1 ? "s" : ""} you` : ""}`
    : "";

  rows.replaceChildren(
    ...(agents.length
      ? agents.map((a) => {
          const li = document.createElement("li");
          li.className = fresh.has(a.id) ? "row fresh" : "row";
          li.dataset.status = a.status;
          li.style.setProperty("--bot", a.color);
          li.innerHTML = `
            <span class="row-bot">${botSvg(a.face)}</span>
            <span class="row-text">
              <span class="row-title"></span>
              <span class="row-detail"></span>
            </span>
            <span class="row-badge"></span>`;
          li.querySelector(".row-title")!.textContent = a.title;
          li.querySelector(".row-detail")!.textContent = a.detail || a.harness;
          li.querySelector(".row-badge")!.textContent = a.label;
          li.onclick = () => void invoke("notch_jump", { id: a.id });
          return li;
        })
      : [Object.assign(document.createElement("li"), { className: "empty", textContent: "No agents running" })]),
  );
  layout();
}

/** Sizes the shape for its state and tells Rust, so the pointer test matches what's drawn. */
function layout() {
  let width = NOTCH.width;
  let height = NOTCH.height;
  if (open) {
    width = OPEN_WIDTH;
    // The panel includes the strip beside the camera, and is capped to the window.
    height = panel.offsetHeight;
  } else if (agents.length) {
    width = NOTCH.width + 2 * EAR;
  }
  island.classList.toggle("open", open);
  island.classList.toggle("eared", !open && agents.length > 0);
  island.style.width = `${width}px`;
  island.style.height = `${height}px`;
  void invoke("notch_hit", { width, height });
}

void listen<boolean>("notch-hover", ({ payload }) => {
  hovering = payload;
  clearTimeout(closeTimer);
  if (!hovering) dismissed = false;
  if (dismissed) return;
  if (hovering) {
    if (!open) void refreshUsage();
    open = true;
    layout();
  } else {
    // A pop-up still counting down closes on its own timer.
    if (peeking) return;
    closeTimer = window.setTimeout(() => {
      endPeek();
      open = false;
      layout();
    }, CLOSE_DELAY);
  }
});

// The main window sends every poll; redraw only on change so the bots' animations don't restart.
let lastSent = "";
void listen<NotchAgent[]>("notch-agents", ({ payload }) => {
  const sent = JSON.stringify(payload);
  if (sent === lastSent) return;
  lastSent = sent;
  agents = payload;
  // Agents that just went idle or started waiting, not ones seen for the first time.
  const changed = agents
    .filter((a) => {
      const before = lastStatus.get(a.id);
      return before !== undefined && before !== a.status && POP_ON.has(a.status);
    })
    .map((a) => a.id);
  lastStatus.clear();
  for (const a of agents) lastStatus.set(a.id, a.status);
  if (changed.length) peek(changed);
  render();
});

/** Claude's limits (Codex's if there's no Claude): a small meter per window. */
async function refreshUsage() {
  const u = await invoke<Usage>("usage_status").catch(() => null);
  const limits = u?.claude ?? u?.codex;
  const now = Date.now();
  usage.replaceChildren(
    ...(limits?.windows ?? [])
      .slice()
      .sort((a, b) => a.minutes - b.minutes)
      .map((w) => {
        const s = windowSummary(w, now);
        const meter = document.createElement("span");
        meter.className = "meter";
        meter.dataset.level = s.level;
        meter.title = s.resetsAt ? `${u?.claude ? "Claude" : "Codex"} ${windowLabel(w.minutes)}: resets ${s.resetsIn} (${s.resetsAt})` : "";
        meter.innerHTML = `<b></b><i><u></u></i><span></span>`;
        meter.querySelector("b")!.textContent = windowLabel(w.minutes);
        meter.querySelector("u")!.style.width = `${s.percent}%`;
        meter.querySelector("span")!.textContent = s.used;
        return meter;
      }),
  );
}

render();
void refreshUsage();
setInterval(() => void refreshUsage(), USAGE_MS);
void emitTo("main", "notch-ready");
