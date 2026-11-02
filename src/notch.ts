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

loadTheme();
const NOTCH = window.__NOTCH ?? { width: 200, height: 32 };
/** How far the status shows on each side of the notch. */
const EAR = Math.round(NOTCH.height + 6);
const OPEN_WIDTH = Math.max(NOTCH.width + 2 * EAR, 460);
/** How long the pointer can be gone before the panel closes. */
const CLOSE_DELAY = 250;
/** How often to re-read usage; reading is just files, never a ping. */
const USAGE_MS = 60_000;

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
/** Closed by a click: stay closed until the pointer leaves, so it doesn't pop back open under it. */
let dismissed = false;

function collapse() {
  clearTimeout(closeTimer);
  dismissed = true;
  open = false;
  layout();
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
          li.className = "row";
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

void listen<boolean>("notch-hover", ({ payload: hovering }) => {
  clearTimeout(closeTimer);
  if (!hovering) dismissed = false;
  if (dismissed) return;
  if (hovering) {
    if (!open) void refreshUsage();
    open = true;
    layout();
  } else {
    closeTimer = window.setTimeout(() => {
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
