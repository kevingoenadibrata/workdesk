# Web pages in Workdesk (WD-12)

The goal: a new kind of pane that shows a web page. It should handle a site
on the web or a local dev server's UI, and split, move and save like a shell
pane, so the page can sit next to the shell running its server.

## Options considered

| | `<iframe>` in Workdesk's DOM | Native child webview (Tauri multiwebview) | Separate window |
|---|---|---|---|
| Local dev servers | Mostly works | Works | Works |
| Sites on the web | Many refuse to load (`X-Frame-Options`, CSP `frame-ancestors`: GitHub, Google, Linear, most logins) | Works: it's a full WKWebView | Works |
| Knows the current URL / title | No: cross-origin frames are opaque | Yes: page-load and title callbacks, plus an injected script for SPA route changes | Yes |
| Back / forward | No (cross-origin `history` is off limits) | Yes | Yes |
| Splits and tabs | Free: it's just DOM | Has to be laid over a DOM placeholder and kept in sync | No: not part of the layout |
| Overlays (Home, pickers, menus) | Free | Native views draw over the DOM, so the page must hide while covered | n/a |
| Keyboard shortcuts | Free when focus is in Workdesk | The page takes the keyboard, so shortcuts have to be forwarded | Separate window |
| Cost | None | Needs Tauri's `unstable` feature (`Window::add_child`) | None |

An iframe can't do half the ticket (browsing the web), and a separate window
can't split with shells. So this prototype uses **native child webviews**.

## How it works

- **`src-tauri/src/browser.rs`**: commands to open, place (bounds and
  show/hide), navigate, go back/forward, reload, focus and close a webview
  labeled `browser-N` in the main window. Only `http`/`https` URLs are allowed.
  `target=_blank` and `window.open` load in the same pane. The user agent
  is Safari's, because WKWebView's default makes some sites serve
  stripped-down pages.
- **Bridge, page → Workdesk.** Pages get no Tauri IPC: the capability
  now names the `main` and `onboarding` webviews instead of windows, so
  child webviews in the main window aren't covered. An injected script
  reports focus, SPA URL changes and shortcut keys by navigating to
  `workdesk-bridge://<token>/<kind>?…`. The navigation handler cancels
  these and emits a `browser` event. The token is random per webview and
  lives only in the script's closure.
- **`src/webview.ts`** keeps each webview over its pane's placeholder. On
  any DOM mutation, resize or drag, it re-measures (coalesced to one frame).
  It hides the webview if the placeholder is off screen or covered: a 3×3
  grid of `elementFromPoint` hits must all land inside the placeholder.
  This covers Home, Settings, Teleport, menus and modals without any of
  them knowing about browsers. Webviews also hide during pane drags and
  divider resizes, so the mouse reaches Workdesk. A covered page gives the
  keyboard back.
- **`src/browser.ts`**: `BrowserPane` is a `TermSession` whose terminal
  is never opened (`kind: "web"`). That lets it go through all the
  existing split, drag, maximize, layout, save/restore and loadout code
  unchanged. Saved layouts and loadouts record each browser pane's URL.
- **Shortcuts.** Pages are told which combos are Workdesk's (all except
  select-all, clear, find, file tree and zoom, which the page keeps). They
  swallow those and forward them. <kbd>⌘</kbd><kbd>R</kbd> reloads the page.

## Using it

- <kbd>⌘</kbd><kbd>⇧</kbd><kbd>B</kbd>: new browser tab. <kbd>⌘</kbd><kbd>⌥</kbd><kbd>B</kbd>: split a browser in to the right.
- The address bar takes a URL, a bare port (`3000` → `http://localhost:3000`), a domain, or a search.
- Opening a server from Home's Local Servers drawer puts it to the right of the shell running it, or in a new tab if that tab is full.
- A single-pane browser tab can be dragged into another tab like any other.

## Known limits / follow-ups

- **Small floating UI over a page is hidden behind it.** The hit test only
  samples nine points, so toasts or tooltips that don't cover one of them
  draw under the page. Fixing this means hiding on overlap with any
  fixed-position element, or snapshotting the page into the placeholder
  while covered.
- **The page disappears while covered** instead of showing a dimmed copy,
  for example during the maximize animation or behind Home.
- **External file drops onto a page** go to WebKit, which may navigate to
  the file.
- **No find-in-page, zoom, devtools toggle, downloads or permissions UI
  yet.** Pages share Workdesk's default WebKit data store, so logins
  persist.
- **`TermSession` as the base class is a shortcut.** A proper `Pane` base
  class (header, weights, hooks) with `ShellPane` and `BrowserPane` would
  be cleaner, but it touches every file that uses `TermSession`.
- **The bridge relies on cancelled navigations.** If a page is mid-load
  when it sends a message, WebKit could in theory drop one of the two. A
  `WKScriptMessageHandler` registered only on these webviews would be
  sturdier, but it needs wry/objc plumbing.
- **Turning on Tauri's `unstable` feature** opts into APIs that may change
  between Tauri minor versions.
