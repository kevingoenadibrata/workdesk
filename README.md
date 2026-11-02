<p align="center">
  <img src="branding/png/banner/banner-readme.png" alt="Workdesk — A desk for your terminals." width="100%">
</p>

<p align="center">
  <b>A terminal app for people who keep a lot of shells open.</b><br>
  Dev servers, test watchers, logs, and a few Claude Code agents working your tickets, all in one tidy desk.
</p>

<p align="center">
  <a href="https://github.com/kevingoenadibrata/workdesk/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/kevingoenadibrata/workdesk?style=flat-square&color=C98F7E&labelColor=120E0D"></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon-F4C7B8?style=flat-square&labelColor=120E0D&logo=apple&logoColor=F4C7B8">
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-C4826F?style=flat-square&labelColor=120E0D&logo=tauri&logoColor=C4826F">
  <img alt="149 themes" src="https://img.shields.io/badge/themes-149-8E5646?style=flat-square&labelColor=120E0D">
</p>

<p align="center">
  <a href="https://github.com/kevingoenadibrata/workdesk/releases/latest"><b>⬇&nbsp; Download for macOS</b></a>
  &nbsp;·&nbsp;
  <a href="#features">Features</a>
  &nbsp;·&nbsp;
  <a href="#keyboard-shortcuts">Shortcuts</a>
  &nbsp;·&nbsp;
  <a href="#build-from-source">Build from source</a>
</p>

<br>

<p align="center">
  <img src="docs/media/hero.gif" alt="Workdesk tour: tabs and groups, splits, tab search, Teleport and themes" width="900">
</p>

<br>

## Why Workdesk?

Seven terminals open. Which one was the API?

In most terminals every tab is called `zsh`. In Workdesk each tab is **named after its folder**, sits in a **colored group**, and is one keystroke away. Teleport opens a new tab in any folder, and `@macros` start your tools there for you, so Claude is already running when the tab opens.

<br>

## Features

<table>
<tr>
<td width="50%" valign="top">

### 🗂️ Tabs that name themselves
Vertical tabs take the name of the folder they're in, so `api`, `web` and `billing` stay apart. Put them in **colored groups**, collapse what you aren't using, and hold <kbd>⌘</kbd> to see the shortcut for every tab.

</td>
<td width="50%">
<img src="docs/media/tabs.gif" alt="Tabs and groups">
</td>
</tr>
<tr>
<td width="50%">
<img src="docs/media/splits.gif" alt="Split panes">
</td>
<td width="50%" valign="top">

### 🪟 Split panes
<kbd>⌘</kbd><kbd>D</kbd> splits right and <kbd>⌘</kbd><kbd>⇧</kbd><kbd>D</kbd> splits down, up to six panes per tab. Drag tabs and panes to rearrange them, with a preview of where they'll land, or press <kbd>⌘</kbd><kbd>L</kbd> to pick a grid layout. Maximize one pane, move between them with the arrow keys, or unsplit them back into tabs.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔎 Find any tab
<kbd>⌘</kbd><kbd>F</kbd> and start typing. Results narrow as you type, and <kbd>Enter</kbd> jumps straight to that tab. You don't have to scroll through a long tab bar.

</td>
<td width="50%">
<img src="docs/media/search.gif" alt="Tab search">
</td>
</tr>
<tr>
<td width="50%">
<img src="docs/media/teleport.gif" alt="Teleport and macros">
</td>
<td width="50%" valign="top">

### 🌀 Teleport + `@macros`
<kbd>⌘</kbd><kbd>⇧</kbd><kbd>T</kbd> opens a new tab in **any folder**, with fuzzy path search, favorites and recents. Type `@claude infra` and the tab opens in `infra` with Claude Code already running. You can define your own macros, and **loadouts** that open a whole set of groups, tabs and panes at once.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎨 149 themes, switched live
Hand-made originals like **Ember**, **Glacier** and **Sakura Night**, plus the popular schemes you already know. The whole app recolors as you click. There are also ten alternate Dock icons to pick from.

</td>
<td width="50%">
<img src="docs/media/themes.gif" alt="Theme gallery">
</td>
</tr>
</table>

<br>

### 🏠 Home: tickets → Claude → pull requests

<kbd>⌘</kbd><kbd>⇧</kbd><kbd>H</kbd> opens Home, a board that goes from ticket to merged PR in three lanes:

- **Backlog.** Tickets assigned to you from **GitHub Issues**, **Linear** and **ClickUp**, with search and filters. Open one to read its description.
- **With an agent.** Click **Hand to Claude** and Workdesk makes a git worktree for the ticket (in `~/.workdesk/worktrees/<repo>/<branch>`), opens a tab there and starts Claude Code on it. You can follow its status and recent output from the card. Toasts and macOS notifications tell you when it needs you or opens a PR.
- **Pull requests.** Your open GitHub PRs. A ticket's run is tracked until its PR merges.

Every coding agent running in your panes shows up here too: **Claude Code**, **Codex** and **opencode**, each with what it's doing and whether it's **waiting on you**. The header shows your **5-hour and weekly usage limits** for Claude and Codex, and a **local servers** button that opens a drawer listing every web server on your machine, whether or not you started it in Workdesk (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>L</kbd>).

Connect your accounts in **Settings → Integrations**. Tokens are stored in the macOS Keychain, and GitHub falls back to `gh auth token` if you don't paste one.

<br>

### 🌿 Git, diffs and files in every pane

- **Git status cards.** Panes inside a repo show the repo, the branch (with commits ahead/behind) and lines added/removed. Click the branch to search, check out or create a branch.
- **Changes panel.** Click the <code>+N −M</code> card to dock a diff of your changes inside the pane, unified or split.
- **File tree.** <kbd>⌘</kbd><kbd>E</kbd> docks a file tree in the pane. It follows the shell when you `cd`.

<br>

### ✨ And the small stuff

- **Sessions restore.** Quit and reopen, and your tabs, groups and splits are where you left them.
- **⌘-click a file path** in the output to open it at that line in VS Code, Cursor, Zed, Windsurf, Sublime or Xcode.
- **Browser panes.** <kbd>⌘</kbd><kbd>⇧</kbd><kbd>B</kbd> opens a page in a tab, <kbd>⌘</kbd><kbd>⌥</kbd><kbd>B</kbd> splits one in beside a shell. Type a port like `3000` for a local server; opening one from Local Servers puts it next to the shell running it.
- **Drag files in.** Dropped files are pasted as shell-escaped paths, so you can drop images onto Claude Code.
- **Safe close.** Workdesk asks before closing a pane that's still running something.
- **Rebindable shortcuts**, a searchable shortcuts page, and terminal search (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>F</kbd>).
- **WebGL rendering** via xterm.js, so even very long logs scroll smoothly.
- **Auto-updates.** New releases install from inside the app.

<p align="center">
  <img src="public/app-icons/ember.png" width="64" alt="Ember icon">
  <img src="public/app-icons/classic.png" width="64" alt="Classic icon">
  <img src="public/app-icons/copper.png" width="64" alt="Copper icon">
  <img src="public/app-icons/midnight.png" width="64" alt="Midnight icon">
  <img src="public/app-icons/ocean.png" width="64" alt="Ocean icon">
  <img src="public/app-icons/forest.png" width="64" alt="Forest icon">
  <img src="public/app-icons/sunset.png" width="64" alt="Sunset icon">
  <img src="public/app-icons/phosphor.png" width="64" alt="Phosphor icon">
  <img src="public/app-icons/graphite.png" width="64" alt="Graphite icon">
  <img src="public/app-icons/light.png" width="64" alt="Light icon">
  <br>
  <sub>Pick your Dock icon in Settings → Appearance.</sub>
</p>

<br>

## Install

1. Download the latest **`Workdesk_x.y.z_aarch64.dmg`** from [Releases](https://github.com/kevingoenadibrata/workdesk/releases/latest).
2. Drag **Workdesk** into **Applications**.
3. Open it. Later updates install from inside the app.

> [!NOTE]
> Builds are for Apple Silicon Macs and aren't notarized yet. If macOS refuses to open the app, run:
> ```sh
> xattr -dr com.apple.quarantine /Applications/Workdesk.app
> ```

<br>

## Keyboard shortcuts

Hold <kbd>⌘</kbd> anywhere to see hints, or press <kbd>⌘</kbd><kbd>/</kbd> for the full list. Every shortcut can be rebound.

| | Shortcut | |
|---|---|---|
| **New tab** | <kbd>⌘</kbd><kbd>T</kbd> | Opens in the current folder |
| **Teleport** | <kbd>⌘</kbd><kbd>⇧</kbd><kbd>T</kbd> | Opens a new tab in any folder |
| **Search tabs** | <kbd>⌘</kbd><kbd>F</kbd> | |
| **Go to tab** | <kbd>⌘</kbd><kbd>1</kbd> … <kbd>⌘</kbd><kbd>9</kbd> | <kbd>9</kbd> goes to the last tab |
| **Split right / down** | <kbd>⌘</kbd><kbd>D</kbd> / <kbd>⌘</kbd><kbd>⇧</kbd><kbd>D</kbd> | Up to six panes |
| **New browser tab** | <kbd>⌘</kbd><kbd>⇧</kbd><kbd>B</kbd> | A site, a search, or a port like `3000` |
| **Split in a browser** | <kbd>⌘</kbd><kbd>⌥</kbd><kbd>B</kbd> | To the right of the focused pane |
| **Maximize pane** | <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↩</kbd> | |
| **Change layout** | <kbd>⌘</kbd><kbd>L</kbd> | Pick a grid, then swap panes |
| **File tree** | <kbd>⌘</kbd><kbd>E</kbd> | Docked in the current pane |
| **Next / previous pane** | <kbd>⌘</kbd><kbd>]</kbd> / <kbd>⌘</kbd><kbd>[</kbd> | |
| **Group selected tabs** | <kbd>⌘</kbd><kbd>G</kbd> | |
| **Home** | <kbd>⌘</kbd><kbd>⇧</kbd><kbd>H</kbd> | Tickets, agents and PRs |
| **Local servers** | <kbd>⌘</kbd><kbd>⇧</kbd><kbd>L</kbd> | Opens Home's servers drawer |
| **Settings** | <kbd>⌘</kbd><kbd>,</kbd> | |
| **Toggle sidebar** | <kbd>⌘</kbd><kbd>B</kbd> | |

<br>

## Build from source

You need [Node.js](https://nodejs.org) (LTS), [Rust](https://rustup.rs), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for macOS.

```sh
git clone https://github.com/kevingoenadibrata/workdesk.git
cd workdesk
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # build a release .app / .dmg
```

**Stack:** [Tauri 2](https://tauri.app) (Rust) · TypeScript + Vite, no framework · [xterm.js](https://xtermjs.org) with WebGL · [Lucide](https://lucide.dev) icons

<br>

<p align="center">
  <img src="branding/svg/mark/mark-color.svg" width="40" alt=""><br>
  <sub><b>Workdesk</b> · A desk for your terminals.</sub>
</p>
