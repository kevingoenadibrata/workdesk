import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { el } from "./page";
import { Bell, Copy, Smartphone, icon } from "./icons";
import { setPhoneMirrorWanted } from "./phoneFeed";
import { showToast } from "./toast";

/** A phone signed in to Tailscale as the same person as this Mac. */
export interface Device {
  name: string;
  os: string;
  online: boolean;
  lastSeen: string | null;
}

/** What `phone_status` (src-tauri/src/phone.rs) reports. */
export interface PhoneStatus {
  on: boolean;
  installed: boolean;
  node: { state: string; login: string | null; host: string | null; https: boolean; phones: Device[] } | null;
  url: string | null;
  serving: boolean;
  taken: boolean;
  viewers: string[];
  notifying: string[];
  error: string | null;
}

const POLL_MS = 4000;

/** Where the mirror stands, and its address as a QR code: what Home's phone card reads. */
export interface PhoneSource {
  status(): Promise<PhoneStatus>;
  qr(text: string): Promise<string>;
}

export const livePhone: PhoneSource = {
  status: () => invoke<PhoneStatus>("phone_status"),
  qr: (text) => invoke<string>("phone_qr", { text }),
};

/** This Mac is on Tailscale: running and signed in. */
export const desktopOnTailscale = (s: PhoneStatus) => s.node?.state === "Running" && !!s.node.login;

/** The phones of this Mac's Tailscale account that are online now. */
export const phonesOnline = (s: PhoneStatus) => (desktopOnTailscale(s) ? (s.node?.phones ?? []).filter((p) => p.online) : []);

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/**
 * Settings → Phone: the phone mirror's switch, where Tailscale stands, the
 * address and its QR code, and which phones are online, watching or getting
 * notifications. Refreshes while it's showing. Returns the switch to focus.
 */
export function buildPhoneSettings(content: HTMLElement): HTMLElement {
  const section = el("section", "page-section");
  const title = el("h2", "page-section-title");
  title.append(icon(Smartphone, 16, "page-section-icon"), "Phone mirror");
  const intro = el(
    "p",
    "page-intro",
    "Watch your tabs, agents and terminals from your phone, at home or away. It goes over Tailscale, so only devices signed in to your own Tailscale account can open it. The phone can only look: nothing it does reaches a terminal.",
  );

  // The switch, and where to open it.
  const mirror = el("div", "integration phone-card");
  const mirrorHead = el("div", "integration-head");
  const mirrorLogo = el("span", "integration-logo");
  mirrorLogo.append(icon(Smartphone, 18));
  const mirrorText = el("div", "integration-text");
  const mirrorStatus = el("div", "integration-status");
  mirrorText.append(el("div", "integration-name", "Phone mirror"), mirrorStatus);
  const toggle = el("button", "integration-connect phone-toggle");
  toggle.setAttribute("role", "switch");
  mirrorHead.append(mirrorLogo, mirrorText, toggle);
  const error = el("p", "integration-error");
  const open = el("div", "phone-open");
  const qr = el("div", "phone-qr");
  const openText = el("div", "phone-open-text");
  const urlRow = el("div", "phone-url-row");
  const url = el("code", "phone-url");
  const copy = el("button", "integration-disconnect phone-copy");
  copy.append(icon(Copy, 12), "Copy");
  urlRow.append(url, copy);
  const steps = el("ol", "phone-steps");
  for (const step of [
    "Scan the code with your phone's camera, or open the address on it.",
    "In Safari, tap Share → Add to Home Screen, then open Workdesk from there.",
    "Tap the bell in the app to get notified when an agent needs you or finishes.",
  ])
    steps.append(el("li", "", step));
  openText.append(urlRow, steps);
  open.append(qr, openText);
  mirror.append(mirrorHead, error, open);

  // Tailscale on this Mac.
  const ts = el("div", "integration phone-card");
  const tsHead = el("div", "integration-head");
  const tsLogo = el("span", "integration-logo phone-ts-logo");
  tsLogo.innerHTML = TAILSCALE_LOGO;
  const tsText = el("div", "integration-text");
  const tsStatus = el("div", "integration-status");
  tsText.append(el("div", "integration-name", "Tailscale"), tsStatus);
  const tsAction = el("button", "integration-disconnect");
  tsHead.append(tsLogo, tsText, tsAction);
  const tsHelp = el("p", "integration-help");
  ts.append(tsHead, tsHelp);

  // Phones on the same account.
  const phones = el("div", "integration phone-card");
  const phonesHead = el("div", "integration-head");
  const phonesLogo = el("span", "integration-logo");
  phonesLogo.append(icon(Bell, 18));
  const phonesText = el("div", "integration-text");
  const phonesStatus = el("div", "integration-status");
  phonesText.append(el("div", "integration-name", "Your phones"), phonesStatus);
  const forget = el("button", "integration-disconnect", "Stop notifications");
  forget.title = "Forget every phone that gets notifications. Each can turn them on again.";
  phonesHead.append(phonesLogo, phonesText, forget);
  const phoneList = el("ul", "phone-list");
  const phonesHelp = el("p", "integration-help");
  phones.append(phonesHead, phoneList, phonesHelp);

  const cards = el("div", "integration-list");
  cards.append(mirror, ts, phones);
  section.append(title, intro, cards);
  const footnote = el(
    "p",
    "page-footnote",
    "Workdesk listens on this Mac only (127.0.0.1) and asks Tailscale to forward port 8443 on your tailnet to it with tailscale serve. Turning the mirror off removes that again. Notifications travel through Apple's or Google's push service encrypted, and wait while Workdesk is in front.",
  );
  section.append(footnote);
  content.append(section);

  let status: PhoneStatus | null = null;
  let busy = false;
  let qrFor = "";

  const render = (s: PhoneStatus) => {
    status = s;
    const node = s.node;
    const running = desktopOnTailscale(s);

    // Mirror.
    mirror.classList.toggle("connected", s.on);
    toggle.setAttribute("aria-checked", String(s.on));
    toggle.textContent = busy ? (s.on ? "Turning off…" : "Turning on…") : s.on ? "Turn off" : "Turn on";
    toggle.disabled = busy || (!s.on && !running);
    mirrorStatus.textContent = s.on
      ? s.viewers.length
        ? `On · ${s.viewers.join(", ")} watching`
        : s.serving
          ? "On · no phone watching"
          : "On · waiting for Tailscale serve"
      : "Off";
    error.textContent = s.error ?? "";
    open.hidden = !(s.on && s.url);
    if (s.on && s.url) {
      url.textContent = s.url;
      if (qrFor !== s.url) {
        qrFor = s.url;
        void invoke<string>("phone_qr", { text: s.url }).then((svg) => (qr.innerHTML = svg), () => {});
      }
    }

    // Tailscale.
    ts.classList.toggle("connected", running);
    tsAction.hidden = false;
    if (!s.installed) {
      tsStatus.textContent = "Not installed";
      tsHelp.textContent = "Install Tailscale on this Mac and on your phone, and sign in to both with the same account.";
      tsAction.textContent = "Get Tailscale";
    } else if (!node || node.state === "Stopped") {
      tsStatus.textContent = "Off";
      tsHelp.textContent = "Turn Tailscale on from its menu bar icon, then come back here.";
      tsAction.textContent = "Open Tailscale";
    } else if (node.state === "NeedsLogin" || !node.login) {
      tsStatus.textContent = "Signed out";
      tsHelp.textContent = "Sign in to Tailscale from its menu bar icon.";
      tsAction.textContent = "Open Tailscale";
    } else if (node.state !== "Running") {
      tsStatus.textContent = node.state;
      tsHelp.textContent = "";
      tsAction.hidden = true;
    } else {
      tsStatus.textContent = `Signed in as ${node.login}`;
      tsHelp.textContent = node.https
        ? `This Mac is ${node.host} on your tailnet.`
        : "HTTPS certificates are off for your tailnet. Turn them on in the Tailscale admin console under DNS, so your phone can open the mirror securely.";
      tsAction.hidden = true;
    }
    tsAction.dataset.action = s.installed ? "open" : "get";

    // Phones.
    const list = node?.phones ?? [];
    const online = list.filter((p) => p.online).length;
    phones.classList.toggle("connected", online > 0);
    phonesStatus.textContent = !running
      ? "Waiting for Tailscale"
      : list.length
        ? `${online} of ${list.length} online`
        : "None signed in";
    phoneList.replaceChildren(
      ...list.map((p) => {
        const li = el("li", "phone-row");
        li.classList.toggle("online", p.online);
        const dot = el("span", "phone-dot");
        const name = el("span", "phone-name", p.name);
        const meta = el("span", "phone-meta", p.online ? "Online" : p.lastSeen ? `Last seen ${ago(p.lastSeen)}` : "Offline");
        const tags = el("span", "phone-tags");
        if (s.viewers.includes(p.name)) tags.append(el("span", "phone-tag watching", "Watching"));
        if (s.notifying.includes(p.name)) tags.append(el("span", "phone-tag", "Notifications"));
        li.append(dot, name, meta, tags);
        return li;
      }),
    );
    phoneList.hidden = list.length === 0;
    phonesHelp.textContent =
      running && !list.length
        ? `Install Tailscale on your phone and sign in as ${node!.login}. Phones signed in to other accounts can't open your mirror.`
        : running && !online
          ? "Open Tailscale on your phone and turn it on to reach the mirror."
          : "";
    forget.hidden = s.notifying.length === 0;
  };

  const refresh = async () => {
    if (!section.isConnected) return;
    try {
      render(await invoke<PhoneStatus>("phone_status"));
    } catch (e) {
      error.textContent = String(e);
    }
  };

  toggle.addEventListener("click", async () => {
    if (!status || busy) return;
    const on = !status.on;
    busy = true;
    render(status);
    try {
      const s = await invoke<PhoneStatus>("phone_enable", { on });
      setPhoneMirrorWanted(on);
      busy = false;
      render(s);
    } catch (e) {
      busy = false;
      setPhoneMirrorWanted(false);
      await refresh();
      error.textContent = String(e);
    }
  });
  copy.addEventListener("click", () => {
    if (!status?.url) return;
    void navigator.clipboard.writeText(status.url).then(() => showToast("Copied the phone mirror's address"));
  });
  tsAction.addEventListener("click", () => {
    if (tsAction.dataset.action === "get") void openUrl("https://tailscale.com/download");
    else void invoke("open_tailscale").catch(() => void openUrl("https://tailscale.com/download"));
  });
  forget.addEventListener("click", () => void invoke("phone_forget_push").then(refresh));

  void refresh();
  const timer = window.setInterval(() => {
    if (!section.isConnected) return window.clearInterval(timer);
    void refresh();
  }, POLL_MS);
  return toggle;
}

/** Tailscale's mark: nine dots, the bottom-left six dimmed. */
const TAILSCALE_LOGO = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
<circle cx="4" cy="4" r="2.4" opacity=".3"/><circle cx="12" cy="4" r="2.4" opacity=".3"/><circle cx="20" cy="4" r="2.4" opacity=".3"/>
<circle cx="4" cy="12" r="2.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="20" cy="12" r="2.4"/>
<circle cx="4" cy="20" r="2.4" opacity=".3"/><circle cx="12" cy="20" r="2.4"/><circle cx="20" cy="20" r="2.4" opacity=".3"/>
</svg>`;
