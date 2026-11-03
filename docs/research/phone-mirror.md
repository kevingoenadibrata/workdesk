# Workdesk on your phone over Tailscale (WD-24)

The goal: from your phone, see every Workdesk tab, watch a terminal live, and
answer an agent that's waiting on you, without exposing the Mac to the
internet. This note covers how terminals flow through Workdesk today, how
Tailscale can carry them to the phone, the problems to solve, and a plan in
three phases. No code is changed yet. A few decisions are yours; they're
listed at the end.

## How terminals work today

| Piece | Where | What matters for a mirror |
|---|---|---|
| PTYs | `src-tauri/src/pty.rs` | Rust owns every shell. A reader thread per PTY sends raw bytes to the webview over a Tauri `Channel`. Input arrives through `pty_write`. Size is set by `pty_resize`. |
| Screen state | `src/terminal.ts` (`TermSession`) | The rendered screen, scrollback and alt-screen state live only in xterm.js inside the webview. Rust keeps no copy. |
| Size | `TermSession.fit()` → `term.onResize` → `pty_resize` | One PTY, one size: whatever the desktop pane measures. |
| Tabs, splits, titles | `src/workspace.ts` (`Workspace`, `Tab`) | Lives in the webview. `workspace.onChange` fires on every change. |
| Agent status | `agent_status` (`src-tauri/src/agents.rs`), `src/monitor.ts` | Already reduced to `thinking / working / waiting / idle / error`, plus the last prompt and what it's waiting on. This is what the phone most needs. |

So a mirror needs three things the app doesn't do yet: copy PTY output to a
second consumer, get the current screen to a client that joins late, and
publish the tab list outside the webview.

## Ways to reach the phone

| | Tailscale + `tailscale serve` | Tailscale, bind to the 100.x address | Same Wi-Fi only (Bonjour / LAN IP) | Public tunnel (Cloudflare Tunnel, ngrok) | Tailscale SSH + tmux |
|---|---|---|---|---|---|
| Works away from home | Yes | Yes | No | Yes | Yes |
| Exposed to the internet | No | No | No (but to everyone on the Wi-Fi) | **Yes**: the whole auth story is ours | No |
| HTTPS | Yes: real cert for `<mac>.<tailnet>.ts.net`, no setup | No (plain HTTP inside WireGuard; fine on the wire, but the browser calls it insecure, so no PWA install or Web Push) | No | Yes | n/a |
| Knows who's connecting | Yes: serve adds `Tailscale-User-Login` / `Tailscale-User-Name` headers | Yes: `tailscale whois <ip:port>` | No | Only with its own login | Yes |
| Workdesk listens on | `127.0.0.1` only | The tailnet interface | All interfaces | `127.0.0.1` | nothing |
| Shows Workdesk's tabs | Yes | Yes | Yes | Yes | **No**: Workdesk's shells aren't in tmux, so there's nothing to attach to |
| Cost to the user | Install Tailscale on Mac and phone, one `serve` command | Same, minus the command | None | An account and a tunnel daemon | Already possible, but different shells |

**Recommendation: `tailscale serve` in front of a server bound to `127.0.0.1`.**
Nothing leaves the loopback interface, the phone gets a real HTTPS origin
(which iOS needs for an installable web app and push), and Tailscale tells
us who the user is. Binding to the 100.x address is the fallback if `serve`
turns out to be unavailable in some Tailscale build.

Tailscale on this Mac: the standalone app, 1.102.2, CLI at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` (not on `PATH`).
MagicDNS and HTTPS certs are both on for the tailnet. It was stopped when
this was written, so nothing below was tried end to end.

### What `serve` gives us, and what it doesn't

- `tailscale serve --bg --https=443 --set-path=/workdesk http://127.0.0.1:<port>`
  proxies `https://<mac>.<tailnet>.ts.net/workdesk` to Workdesk. `--bg` makes
  the config persist in `tailscaled`, across reboots, until `serve reset`.
- WebSockets pass through the proxy.
- Identity headers are only added for tailnet peers, and serve strips any
  the client sent. **But any local process can also call `127.0.0.1:<port>`
  and set those headers itself.** The headers say who's on the phone; they
  aren't a replacement for a secret. See [Security](#security).
- The serve config belongs to the whole machine. Other things the user serves
  may share port 443. Workdesk should check `serve status --json` and only
  add its own path, never call `serve reset`.
- Tailscale also offers `tsnet` (an embedded Tailscale node with its own
  name). It's a Go library; Rust would need `libtailscale` over C. That
  would remove the CLI step, but it's a large dependency for a small gain.
  Not recommended for now.

## Problems to solve

### 1. A copy of the output

The reader thread in `pty_spawn` sends each chunk to the webview. Add a
`tokio::sync::broadcast` sender per PTY and send the same chunk to it.
With no phone connected, `send` on a broadcast channel with no receivers
is a cheap no-op. A slow phone falls behind and gets `Lagged`; when that
happens it should take a fresh snapshot (below) instead of stalling the
desktop.

### 2. A client that joins late

Joining mid-session, the phone needs the current screen, not the bytes from
now on. Options:

| | How | Problem |
|---|---|---|
| Ring buffer in Rust | Keep the last ~256 KB per PTY and replay it | Can start in the middle of an escape sequence or after the switch to the alt screen. Claude Code, vim and htop then draw garbage until their next full redraw. |
| Force a redraw | Nudge the PTY size so the app gets `SIGWINCH` and repaints | Only full-screen apps repaint. Shell history is lost. The desktop flickers. |
| **Serialize the desktop's screen** | Ask the webview for `@xterm/addon-serialize`'s output for that terminal, send it, then stream live bytes | One more xterm addon. Needs a round trip to the webview. |

**Recommendation: serialize.** The webview already has the exact screen.
The addon writes it back out as escape sequences (alt screen and cursor
included), and the phone's xterm.js replays it. Rust asks the main webview
with an event, and the webview answers with an `invoke`. To avoid missing
bytes in between, Rust subscribes to the broadcast first, then asks for the
snapshot, and buffers live bytes until the snapshot is sent.

### 3. Screen size

A PTY has one size, the desktop pane's. A Claude pane is often 100–200
columns. A phone is about 45 columns wide in portrait at a readable size.

| | What the phone does | Effect on the desktop |
|---|---|---|
| **Mirror at desktop size** (default) | Renders the same columns, scaled to fit the width, with pinch-zoom and pan. Landscape helps. | None |
| "Fit to phone" while you use it | Resizes the PTY to the phone's columns. Restores the desktop size when the phone leaves or is idle. Like tmux's smallest-client rule. | The desktop pane shows a narrower terminal while the phone holds it. Claude Code reflows; shell history doesn't. |

Recommendation: mirror at desktop size by default, with "fit to phone" as a
per-pane toggle on the phone. Most of the time the phone doesn't need the
terminal at all; it needs the agent card (next).

### 4. What the phone should show

Reading a 150-column TUI on a phone is the worst case. The common case is
"is it done, and does it need me?", and Workdesk already knows that:

- **Tab list.** The sidebar's order, groups and colours, each tab's panes,
  and each pane's title, directory, git branch and agent status. The
  webview sends a snapshot to Rust (`mirror_state`) on `workspace.onChange`
  and when agent status is polled. Rust holds the latest and pushes it to
  phones.
- **Agent card** for panes running Claude, Codex or opencode: status, last
  prompt, what it's waiting on (from `monitor.ts`), and buttons for the
  usual replies (approve, deny, Esc) plus a text box. Those are just writes
  to the PTY.
- **Terminal view** as the drill-down, with a key bar: Esc, Tab, ⌃C, arrows,
  Enter.
- Browser panes show their URL only; they aren't mirrored.

### 5. The phone app

| | PWA served by Workdesk | Native iOS app |
|---|---|---|
| Build | A second Vite entry (`mobile.html`) with xterm.js, built into the app bundle and served by the same Rust server | Swift, App Store or TestFlight |
| Install | Safari → Share → Add to Home Screen. Needs HTTPS, which `serve` provides. | App Store |
| Notifications | Web Push for home-screen web apps (iOS 16.4+). Needs VAPID keys, and push goes through Apple's servers, so a message leaves the tailnet. The existing Discord webhook (the `notify-phone` skill) is a fallback that already works. | APNs |
| Updates | Ships with each Workdesk release | Separate release cycle |

**Recommendation: PWA.** Same code base, same release, no store.

### 6. The server in Rust

Tauri already runs a tokio runtime. `axum` (with its `ws` feature) adds an
HTTP + WebSocket server for a few hundred KB of binary. Routes:

- `GET /workdesk/` – the PWA's files.
- `GET /workdesk/api/state` and a WebSocket for tab-list updates.
- `WS /workdesk/api/pty/<id>` – snapshot, then live bytes; input and resize
  messages back.

Only start it when the user turns mirroring on.

## Security

A mirror is a remote shell. Each layer should hold on its own:

1. **Off by default.** A Settings switch starts the server. Turning it off
   stops it and removes Workdesk's path from `serve`.
2. **Loopback only.** Bind `127.0.0.1`. Tailscale is the only way in from
   outside.
3. **Same person.** Accept a request only if `Tailscale-User-Login` matches
   the Mac's own Tailscale user (`tailscale status --json` → `Self.UserID` →
   `User[...].LoginName`). This stops other members of a shared tailnet,
   and shared-in devices.
4. **Pairing secret.** Settings shows a QR code with the URL and a random
   token. The phone trades it for a cookie (`HttpOnly`, `Secure`,
   `SameSite=Strict`). The token is kept in the Keychain, like ticket tokens
   (`KEYCHAIN_SERVICE` in `src-tauri/src/tickets.rs`). "Forget phones"
   rotates it. This covers local processes that could otherwise fake the
   headers on loopback.
5. **Check `Origin`** on WebSocket upgrades, so no other site open in the
   phone's browser can connect.
6. **Visible.** A dot in the sidebar while a phone is connected, and a
   "Phone connected" toast on first connect.
7. **Read-only first.** Phase 1 doesn't accept input at all.

Funnel (`tailscale funnel`) puts a serve path on the public internet.
Workdesk must never enable it, and should refuse to run if its path is
funnelled (`serve status --json` shows `AllowFunnel`).

## Plan

**Phase 1 – look (read-only).**
Settings switch, Rust server, `serve` setup (Workdesk runs the command if
Tailscale is installed and running; otherwise it shows the command), QR
pairing, tab list with agent status, live terminal view at desktop size.

**Phase 2 – answer.**
Input over the WebSocket, the key bar, agent card buttons, "fit to phone".

**Phase 3 – get told.**
Notify when an agent goes from working to waiting or finishes. Either Web
Push from the PWA, or the existing Discord webhook path, chosen in
Settings.

Rough size: phase 1 is the bulk (server, pairing, PWA shell, snapshot
plumbing). Phases 2 and 3 are smaller and build on it.

## Things to check before building

- `tailscale serve` with `--set-path` and WebSockets on the standalone macOS
  app (1.102). Expected to work; untested here because Tailscale was stopped.
- Whether the Mac App Store build of Tailscale allows `serve` to a loopback
  port the same way.
- `@xterm/addon-serialize` with xterm 6 and Claude Code's screen: does a
  replayed snapshot look identical?
- Web Push from an iOS home-screen app on a `*.ts.net` origin.

## Decisions for you

1. **Scope of phase 1:** read-only mirror, or read + reply from the start?
2. **Notifications:** Web Push in the PWA, or keep using the Discord webhook?
3. **`serve` setup:** should Workdesk run `tailscale serve` for you, or only
   show the command to paste?
4. **Shared tailnets:** only your own Tailscale user, or also let other users
   in your tailnet in (for example a work tailnet)? This note assumes only you.

## Sources

- Tailscale Serve: <https://tailscale.com/kb/1312/serve>, and
  `tailscale serve --help` on this Mac (1.102.2).
- Serve identity headers: <https://tailscale.com/kb/1312/serve#identity-headers>
- `tailscale whois`: <https://tailscale.com/kb/1080/cli#whois>
- HTTPS certs on `ts.net`: <https://tailscale.com/kb/1153/enabling-https>
- `tsnet`: <https://tailscale.com/kb/1244/tsnet>
- xterm.js serialize addon: <https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize>
- Web Push for home-screen web apps on iOS 16.4: <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>
