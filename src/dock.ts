import "./styles.css";
import "./dock.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { loadTheme } from "./themes";
import { Camera, FileUp, TicketPlus, icon } from "./icons";
import { harnessLogo } from "./harnessLogos";
import { windowLabel, windowSummary, type Usage } from "./usage";

// The dock extender (src-tauri/src/dock.rs): glass cards in the empty strip
// beside the macOS Dock, one window each; the URL's hash says which this is.
// - usage: Claude's limits (Codex's if there's no Claude), a meter per window
//   with when it resets;
// - ticket: a button opening the New ticket composer in Workdesk;
// - drop: files dropped on it open the composer with them in the description.
//   Right after Shottr copies a screenshot (src-tauri/src/shottr.rs), it offers
//   to start a ticket from it for a while.

loadTheme();
const card = location.hash.slice(1) || "usage";
/** How often to re-read usage; reading is just files, never a ping. */
const USAGE_MS = 60_000;
/** How long the drop zone offers a ticket from a Shottr screenshot. */
const SHOT_OFFER_MS = 20_000;

const panel = document.createElement("div");
panel.className = `dock-panel dock-${card}`;
document.body.append(panel);

async function refresh() {
  const u = await invoke<Usage>("usage_status").catch(() => null);
  const harness = u?.claude ? "claude" : u?.codex ? "codex" : null;
  const limits = u?.claude ?? u?.codex;
  const now = Date.now();
  const windows = (limits?.windows ?? []).slice().sort((a, b) => a.minutes - b.minutes);

  const logo = document.createElement("span");
  logo.className = "dock-logo";
  if (harness) logo.dataset.harness = harness;
  if (harness) logo.innerHTML = harnessLogo(harness, 22);

  const rows = document.createElement("div");
  rows.className = "dock-rows";
  if (!windows.length) {
    rows.append(Object.assign(document.createElement("span"), { className: "dock-empty", textContent: "No usage yet" }));
  }
  for (const w of windows) {
    const s = windowSummary(w, now);
    const row = document.createElement("div");
    row.className = "dock-meter";
    row.dataset.level = s.level;
    row.innerHTML = `<b></b><i><u></u></i><span class="pct"></span><span class="reset"></span>`;
    row.querySelector("b")!.textContent = windowLabel(w.minutes);
    row.querySelector("u")!.style.width = `${s.percent}%`;
    row.querySelector(".pct")!.textContent = s.used;
    row.querySelector(".reset")!.textContent = s.resetsIn;
    rows.append(row);
  }
  panel.replaceChildren(logo, rows);
}

/** Create ticket: Workdesk comes forward with the composer open, where you can type. */
function ticketCard() {
  const button = document.createElement("button");
  button.className = "dock-action";
  button.append(icon(TicketPlus, 18), Object.assign(document.createElement("span"), { textContent: "New ticket" }));
  button.onclick = () => void invoke("notch_action", { action: "ticket" });
  panel.append(button);
}

/** The drop zone: Tauri hands over the dropped files' paths; Rust copies images in and opens the composer. */
function dropCard() {
  const hint = document.createElement("div");
  hint.className = "dock-drop-hint";
  const text = document.createElement("span");
  const idle = "Drop files to start a ticket";
  text.textContent = idle;
  hint.append(icon(FileUp, 18), text);
  panel.append(hint);

  const setOver = (over: boolean) => {
    panel.classList.toggle("over", over);
    text.textContent = over ? "Release to start a ticket" : idle;
  };

  // A Shottr screenshot was just copied: the zone becomes a button for a while.
  const offer = document.createElement("button");
  offer.className = "dock-action dock-shot";
  const offerText = document.createElement("span");
  offer.append(icon(Camera, 18), offerText);
  let offerTimer = 0;
  const endOffer = () => {
    clearTimeout(offerTimer);
    offer.replaceWith(hint);
  };
  offer.onclick = () => {
    clearTimeout(offerTimer);
    offerText.textContent = "Opening…";
    invoke("shottr_ticket").catch((e) => {
        offerText.textContent = String(e);
        offerTimer = window.setTimeout(endOffer, 3000);
      });
  };
  void listen("shottr-shot", () => {
    clearTimeout(offerTimer);
    offerText.textContent = "Ticket from screenshot";
    if (hint.isConnected) hint.replaceWith(offer);
    offerTimer = window.setTimeout(endOffer, SHOT_OFFER_MS);
  });
  void listen("shottr-taken", endOffer);
  void getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "enter" || payload.type === "over") setOver(true);
    else if (payload.type === "leave") setOver(false);
    else if (payload.type === "drop") {
      setOver(false);
      if (!payload.paths.length) return;
      text.textContent = "Opening…";
      invoke("dock_drop", { paths: payload.paths })
        .catch((e) => {
          text.textContent = String(e);
        })
        .finally(() => setTimeout(() => (text.textContent = idle), 2000));
    }
  });
}

if (card === "ticket") ticketCard();
else if (card === "drop") dropCard();
else {
  void refresh();
  setInterval(() => void refresh(), USAGE_MS);
}
