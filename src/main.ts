import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Workspace } from "./workspace";
import { Sidebar } from "./sidebar";
import { DirPicker } from "./dirpicker";
import { Settings } from "./settings";
import { ShortcutsPage } from "./shortcutsPage";
import { AgentMonitor, MonitorPage } from "./monitor";
import { Page } from "./page";
import { Keyboard, PanelLeftClose, PanelLeftOpen, Search, Settings as SettingsIcon, X, icon } from "./icons";
import { kbdFor } from "./kbd";
import { installSplitDrop } from "./splitdrop";
import { LayoutPicker } from "./layouts";
import { installFileDrop } from "./filedrop";
import { processCwds } from "./pty";
import { THEMES, loadTheme, setTheme } from "./themes";
import { resetZoom, zoom } from "./fonts";
import { keepSessionSaved, loadSession } from "./session";
import { addLoadout, cleanLoadoutName, findLoadout, onLoadoutsChange, usableLoadouts } from "./loadouts";
import { installHoldHints, installShortcuts, type Action } from "./shortcuts";
import { runnable } from "./macros";
import { confirmClose } from "./closeGuard";
import { shouldOnboard } from "./firstRun";
import { checkForUpdates, installUpdater } from "./updater";
import { applyAppIcon } from "./appIcon";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

loadTheme();

const ws = new Workspace($("#terminals"), () => void invoke("close_main_window"));
const sidebar = new Sidebar(
  $("#tablist"),
  ws,
  (dir) => void newTab(dir),
  () => newTabIn(),
  (tabIds, groupIds) => saveLoadout(tabIds, groupIds),
);
const dirPicker = new DirPicker($("#terminals"));
const focusTerminal = () => ws.activeTab?.session.term.focus();
const settings = new Settings($("#terminals"));
settings.onOpenLoadout = deployLoadout;
const shortcutsPage = new ShortcutsPage($("#terminals"));
const monitorPage = new MonitorPage($("#terminals"), (session) => {
  ws.reveal(session);
  Page.closeAll();
});
const monitor = new AgentMonitor(ws, $("#monitor-slot"), monitorPage);
installSplitDrop($("#terminals"), ws, () => sidebar.draggingTabIds);
installFileDrop(ws);
const layoutPicker = new LayoutPicker($("#terminals"), ws);
sidebar.onRelayout = () => {
  Page.closeAll();
  layoutPicker.open();
};

/** Working directory of the focused pane, or undefined (home) if there's none. */
async function currentCwd(): Promise<string | undefined> {
  const session = ws.activeTab?.session;
  let cwd = session?.cwd || undefined;
  if (session?.ptyId != null) {
    // The polled cwd can be up to a second stale; ask for the current one.
    const fresh = await processCwds([session.ptyId]).catch(() => ({}) as Record<string, string>);
    cwd = fresh[session.ptyId] || cwd;
  }
  return cwd;
}

/** Opens a tab in `dir`, else the active tab's directory, or home if there's none. */
async function newTab(dir?: string) {
  if (dir) Page.closeAll();
  ws.newTab(undefined, dir ?? (await currentCwd()));
}

/** Splits the focused pane, starting the new shell in the same directory. */
async function split(dir: "right" | "down") {
  if (!ws.canSplit(ws.activeTab, dir)) return;
  ws.split(dir, await currentCwd());
}

/** ⌘W closes the focused pane of a split tab, or the selected tabs otherwise. */
function close() {
  const ids = ws.selectedIds();
  const tab = ws.activeTab;
  if (tab && ids.length === 1 && tab.sessions.length > 1) void ws.requestClosePane(tab.id, tab.focused);
  else void ws.requestCloseTabs(ids);
}

/** ⌘Q and the window's close button: confirm first if any terminal is running a command. */
async function quit(command: "quit_app" | "close_main_window") {
  if (await confirmClose(ws.allSessions, "Workdesk", "Quit")) void invoke(command);
}

/** Teleport: asks which directory to start in (and which macro to run), then opens a tab there. */
function newTabIn() {
  void dirPicker.open(
    (dir, macro) => {
      Page.closeAll();
      ws.newTab(undefined, dir, macro ? runnable(macro) : [], macro?.name);
    },
    () => {
      if (!Page.current) focusTerminal();
    },
    deployLoadout,
  );
}

/** Opens a loadout's tabs and groups after the ones already open. */
function deployLoadout(name: string) {
  const loadout = findLoadout(name);
  if (!loadout) return;
  Page.closeAll();
  ws.deployLoadout(loadout);
}

/**
 * Saves tabs and groups as one new loadout, named after the group when it's
 * just one, then opens it in Settings to rename or adjust.
 */
function saveLoadout(tabIds?: Set<number>, groupIds?: Set<number>) {
  const loadout = tabIds && groupIds ? ws.captureLoadout("", tabIds, groupIds) : ws.captureAll("");
  const only = loadout.items.length === 1 && "tabs" in loadout.items[0] ? loadout.items[0].name : "";
  loadout.name = cleanLoadoutName(only) || (tabIds ? "loadout" : "workspace");
  settings.showLoadout(addLoadout(loadout));
}

// The Loadouts menu in the menu bar lists them, so rebuild it as they change.
function syncLoadoutMenu() {
  void invoke("set_loadout_menu", { names: usableLoadouts().map((l) => l.name) }).catch(() => {});
}
onLoadoutsChange(syncLoadoutMenu);
syncLoadoutMenu();
void listen<string>("menu", ({ payload: id }) => {
  if (id.startsWith("loadout:")) deployLoadout(id.slice("loadout:".length));
  else if (id === "loadout-save-all") saveLoadout();
  else if (id === "loadout-edit") settings.showLoadout();
  else if (id === "quit") void quit("quit_app");
  else if (id === "close-window") void quit("close_main_window");
  else if (id === "check-updates") void checkForUpdates(true);
});
installUpdater(() => confirmClose(ws.allSessions, "Workdesk", "Restart"));

function newGroup() {
  sidebar.startRename("group", ws.createGroup().id);
}

/** Puts the selected tabs (or just the active one) into a new group. */
function groupSelected() {
  const ids = ws.selectedIds();
  if (ids.length > 0) sidebar.startRename("group", ws.createGroup(ids).id);
}

/** Takes the selected tabs out of their groups. */
function ungroupSelected() {
  const ids = ws.selectedIds().filter((id) => ws.groupOf(id));
  if (ids.length > 0) ws.removeFromGroups(ids);
}

function toggleSidebar() {
  document.body.classList.toggle("sidebar-hidden");
}

const COLLAPSED_KEY = "workdesk.sidebarCollapsed";

/** Shrinks the sidebar to an icon rail, or expands it back. Remembered across launches. */
function setSidebarCollapsed(collapsed: boolean) {
  document.body.classList.remove("sidebar-hidden");
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "");
  } catch {}
  const button = $("#collapse-sidebar");
  const name = collapsed ? "Expand sidebar" : "Collapse sidebar";
  button.setAttribute("aria-label", name);
  button.querySelector(".icon")?.replaceWith(icon(collapsed ? PanelLeftOpen : PanelLeftClose, 16));
  button.querySelector(".tip")!.textContent = name;
  hideSideTip();
}

function collapseSidebar() {
  setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
}

/** Icon-only footer button: the page name shows on hover, its shortcut while ⌘ is held. */
function iconButton(sel: string, svg: SVGElement, name: string, action: Action) {
  const tip = document.createElement("span");
  tip.className = "tip";
  tip.setAttribute("aria-hidden", "true");
  tip.textContent = name;
  const hint = document.createElement("span");
  hint.className = "hold-hint";
  hint.append(kbdFor(action));
  $(sel).append(svg, hint, tip);
}
iconButton("#open-shortcuts", icon(Keyboard, 16), "Shortcuts", "openShortcuts");
iconButton("#open-settings", icon(SettingsIcon, 16), "Settings", "openSettings");
iconButton("#collapse-sidebar", icon(PanelLeftClose, 16), "Collapse sidebar", "collapseSidebar");
$("#open-shortcuts").addEventListener("click", () => shortcutsPage.toggle());
$("#collapse-sidebar").addEventListener("click", collapseSidebar);

// In the icon rail, rows name themselves in a tooltip to their right. It lives
// outside the scrolling list so it isn't clipped.
const sideTip = document.createElement("div");
sideTip.className = "side-tip";
sideTip.setAttribute("aria-hidden", "true");
document.body.append(sideTip);
function hideSideTip() {
  sideTip.classList.remove("visible");
}
function showSideTip(e: MouseEvent) {
  const target = (e.target as Element).closest<HTMLElement>("[data-tip]");
  if (!target || !document.body.classList.contains("sidebar-collapsed") || document.body.classList.contains("sidebar-peek")) {
    hideSideTip();
    return;
  }
  const r = target.getBoundingClientRect();
  sideTip.textContent = target.dataset.tip ?? "";
  sideTip.style.left = `${$("#sidebar").getBoundingClientRect().right + 6}px`;
  sideTip.style.top = `${r.top + r.height / 2}px`;
  sideTip.classList.add("visible");
}
for (const sel of ["#tablist", "#monitor-slot"]) {
  $(sel).addEventListener("mouseover", showSideTip);
  $(sel).addEventListener("mouseleave", hideSideTip);
}
$("#tablist").addEventListener("scroll", hideSideTip);
for (const type of ["dragstart", "contextmenu", "mousedown"]) $("#tablist").addEventListener(type, hideSideTip);
$("#open-settings").addEventListener("click", () => settings.toggle());

// ⌘F: filter the sidebar's tabs. ↑/↓ pick a match, Enter opens it, Esc goes back.
const search = $<HTMLInputElement>("#tab-search");
const clearSearch = document.createElement("button");
clearSearch.className = "tab-search-clear";
clearSearch.type = "button";
clearSearch.title = "Clear search";
clearSearch.setAttribute("aria-label", "Clear search");
clearSearch.hidden = true;
clearSearch.append(icon(X, 13));
// Clears but stays in the box, ready for a new search.
clearSearch.addEventListener("mousedown", (e) => e.preventDefault());
clearSearch.addEventListener("click", (e) => {
  e.preventDefault();
  endSearch();
  search.focus();
});
{
  const hint = document.createElement("span");
  hint.className = "hold-hint";
  hint.append(kbdFor("searchTabs"));
  search.before(icon(Search, 14, "tab-search-icon"));
  search.after(clearSearch, hint);
}
function endSearch() {
  search.value = "";
  sidebar.setQuery("");
  clearSearch.hidden = true;
  document.body.classList.remove("sidebar-peek");
}
function searchTabs() {
  document.body.classList.remove("sidebar-hidden");
  // A collapsed sidebar opens up while searching, and folds back once the search is done.
  if (document.body.classList.contains("sidebar-collapsed")) document.body.classList.add("sidebar-peek");
  search.focus();
  search.select();
}
// In the icon rail the box is just an icon, and the input inside it is hidden.
search.closest(".tab-search")!.addEventListener("click", (e) => {
  if (document.activeElement === search) return;
  e.preventDefault();
  searchTabs();
});
search.addEventListener("blur", () => {
  if (!search.value) document.body.classList.remove("sidebar-peek");
});
search.addEventListener("input", () => {
  sidebar.setQuery(search.value);
  clearSearch.hidden = search.value === "";
});
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sidebar.moveHit(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const id = sidebar.hitId;
    if (id == null) return;
    endSearch();
    Page.closeAll();
    ws.activate(id);
    focusTerminal();
  } else if (e.key === "Escape") {
    e.preventDefault();
    endSearch();
    if (!Page.current) focusTerminal();
  }
});

// Going to a tab leaves Settings/Shortcuts.
$("#tablist").addEventListener(
  "click",
  (e) => {
    if (!(e.target as Element).closest(".tab, .new-tab-row, .group-add")) return;
    Page.closeAll();
    // Picking a tab from the results ends the search.
    if (search.value) endSearch();
  },
  true,
);

const handlers: Record<Action, () => void> = {
  newTab: () => void newTab(),
  newTabIn,
  openSettings: () => settings.toggle(),
  openShortcuts: () => shortcutsPage.toggle(),
  openMonitor: () => monitorPage.toggle(),
  searchTabs,
  closeTab: close,
  splitRight: () => void split("right"),
  splitDown: () => void split("down"),
  unsplit: () => ws.activeId != null && ws.unsplit(ws.activeId),
  focusPaneLeft: () => ws.focusPane("left"),
  focusPaneRight: () => ws.focusPane("right"),
  focusPaneUp: () => ws.focusPane("up"),
  focusPaneDown: () => ws.focusPane("down"),
  nextPane: () => ws.cyclePane(1),
  prevPane: () => ws.cyclePane(-1),
  newGroup,
  groupSelected,
  ungroupSelected,
  nextTab: () => ws.cycle(1),
  prevTab: () => ws.cycle(-1),
  renameTab: () => ws.activeId != null && sidebar.startRename("tab", ws.activeId),
  toggleSidebar,
  collapseSidebar,
  selectAll: () => ws.activeTab?.session.term.selectAll(),
  clear: () => ws.activeTab?.session.term.clear(),
  findInTerminal: () => ws.activeTab?.session.openFind(),
  zoomIn: () => zoom(1),
  zoomOut: () => zoom(-1),
  resetZoom,
  maximizePane: () => ws.toggleMaximized(),
  arrangePanes: () => layoutPicker.open(),
  goToTab1: () => ws.activateIndex(1),
  goToTab2: () => ws.activateIndex(2),
  goToTab3: () => ws.activateIndex(3),
  goToTab4: () => ws.activateIndex(4),
  goToTab5: () => ws.activateIndex(5),
  goToTab6: () => ws.activateIndex(6),
  goToTab7: () => ws.activateIndex(7),
  goToTab8: () => ws.activateIndex(8),
  goToTab9: () => ws.activateIndex(9),
};
/** Actions that work while a page is open; every other one first goes back to the terminals. */
const PAGE_SAFE = new Set<Action>([
  "openSettings",
  "openShortcuts",
  "openMonitor",
  "toggleSidebar",
  "collapseSidebar",
  "newTabIn",
  "searchTabs",
  "zoomIn",
  "zoomOut",
  "resetZoom",
]);
/** Terminal-only actions that do nothing while a page is open. */
const TERMINAL_ONLY = new Set<Action>(["selectAll", "clear", "findInTerminal"]);
for (const action of Object.keys(handlers) as Action[]) {
  const run = handlers[action];
  if (PAGE_SAFE.has(action)) continue;
  handlers[action] = () => {
    if (Page.current) {
      if (TERMINAL_ONLY.has(action)) return;
      Page.closeAll();
    }
    run();
  };
}
installShortcuts(handlers);
installHoldHints();

// Title bar mirrors the open page, or else the active tab.
const titleEl = $("#title");
function updateTitle() {
  const tab = ws.activeTab;
  const group = tab && ws.groupOf(tab.id);
  titleEl.textContent = Page.current?.title ?? (tab ? (group ? `${group.name} · ${ws.title(tab)}` : ws.title(tab)) : "");
}
ws.onChange(updateTitle);

// A page takes the active spot: its sidebar button lights up and no tab does.
Page.onChange(() => {
  const page = Page.current;
  sidebar.setShowActive(!page);
  $("#open-settings").classList.toggle("active", page === settings);
  $("#open-shortcuts").classList.toggle("active", page === shortcutsPage);
  for (const sel of ["#open-settings", "#open-shortcuts"]) {
    const button = $(sel);
    if (button.classList.contains("active")) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  updateTitle();
  if (!page) focusTerminal();
});

// Keep every terminal sized to the pane.
let fitQueued = false;
new ResizeObserver(() => {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    ws.fitAll();
  });
}).observe($("#terminals"));
void document.fonts.ready.then(() => ws.fitAll());

// Draggable sidebar edge. Dragging it far enough left folds the sidebar into icons, and back out unfolds it.
const resizer = $("#sidebar-resizer");
resizer.addEventListener("mousedown", (e) => {
  e.preventDefault();
  document.body.classList.add("resizing");
  const onMove = (ev: MouseEvent) => {
    const collapse = ev.clientX < 110;
    if (collapse !== document.body.classList.contains("sidebar-collapsed")) setSidebarCollapsed(collapse);
    if (!collapse) document.documentElement.style.setProperty("--sidebar-w", `${Math.min(420, Math.max(160, ev.clientX))}px`);
  };
  const onUp = () => {
    document.body.classList.remove("resizing");
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    ws.activeTab?.session.term.focus();
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});

let startCollapsed = false;
try {
  startCollapsed = localStorage.getItem(COLLAPSED_KEY) === "1";
} catch {}
setSidebarCollapsed(startCollapsed);

// Reopen last time's tabs, splits and groups, or start with one tab.
const saved = loadSession();
if (!saved || !ws.restore(saved)) ws.newTab();
keepSessionSaved(ws);
applyAppIcon();
ws.startTitlePolling();
ws.startGitPolling();
monitor.start();

// The tour runs in its own window over the whole display (Workdesk › Restart
// Onboarding opens it too). A theme picked there repaints this window, and
// closing it comes back to the terminal.
void listen<string>("theme-changed", ({ payload }) => {
  const theme = THEMES.find((t) => t.name === payload);
  if (theme) setTheme(theme);
});
void listen("onboarding-closed", focusTerminal);
if (shouldOnboard(saved != null)) void invoke("open_onboarding").catch(() => {});
