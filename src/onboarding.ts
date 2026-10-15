import "./onboarding.css";
import { invoke } from "@tauri-apps/api/core";
import { kbd, kbdFor, kbdKeys } from "./kbd";
import { markOnboarded } from "./firstRun";
import { combosFor, comboFromEvent, keymap, type Action } from "./shortcuts";
import { THEMES, currentTheme, setTheme, type Theme } from "./themes";
import { POWER_SCENES, Stage } from "./powerups";
import {
  AtSign,
  Check,
  Columns2,
  Layers,
  Package,
  Palette,
  Plus,
  Shell,
  Star,
  Terminal,
  Type,
  icon,
} from "./icons";
import type { IconNode } from "lucide";

/** Brand colors (branding/tokens.json), for the edge glow. */
const GLOW = ["#F4C7B8", "#C98F7E", "#C4826F", "#FBF1EC"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Forces a style flush, so a restarted animation or transition starts over. */
const flushStyle = (node: Element) => void node.getBoundingClientRect();

// ─── The mark ────────────────────────────────────────────────────────────────

const BLADE = "M7 -200L7 -139.48A88.32 132.48 0 0 0 95.32 -7L131 -7Q145 -7 137.23 -18.65L14.77 -202.35Q7 -214 7 -200Z";
const SVG_NS = "http://www.w3.org/2000/svg";

/** The four-blade star, each blade its own element (`.blade-0` … `.blade-3`, clockwise from the top right). */
function mark(className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "-256 -256 512 512");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ob-mark", ...className.split(" ").filter(Boolean));
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "ob-mark-spin");
  for (let i = 0; i < 4; i++) {
    // Each blade turns into place, then is drawn from its own transform so CSS can move it outward.
    const turn = document.createElementNS(SVG_NS, "g");
    turn.setAttribute("transform", `rotate(${i * 90}) scale(1.1285)`);
    const blade = document.createElementNS(SVG_NS, "path");
    blade.setAttribute("d", BLADE);
    blade.setAttribute("class", `blade blade-${i}`);
    turn.append(blade);
    g.append(turn);
  }
  svg.append(g);
  return svg;
}

// ─── The demo desk ───────────────────────────────────────────────────────────

class Cancelled extends Error {}

type Color = "blue" | "purple" | "green" | "orange" | "pink" | "cyan" | "yellow" | "red" | "grey";

/**
 * A small, drawn copy of Workdesk (sidebar and panes) that acts out a
 * feature. It reads the app's theme variables, so it always wears the theme.
 */
class Desk {
  readonly root = el("div", "dk");
  private rows = el("div", "dk-rows");
  private panes = el("div", "dk-panes");
  private title = el("span", "dk-title");
  private run = 0;

  constructor() {
    const bar = el("div", "dk-bar");
    bar.append(el("i", ""), el("i", ""), el("i", ""), this.title);
    const side = el("div", "dk-side");
    side.append(el("div", "dk-search", "Search tabs"), this.rows);
    const main = el("div", "dk-main");
    main.append(this.panes);
    const body = el("div", "dk-body");
    body.append(side, main);
    this.root.append(bar, body);
    this.root.setAttribute("aria-hidden", "true");
  }

  /** Stops whatever is playing. */
  stop() {
    this.run++;
  }

  /** Plays `scene` from a clean desk; resolves when it ends (or is replaced). */
  async play(scene: (d: Desk) => Promise<void>): Promise<boolean> {
    const run = ++this.run;
    this.reset();
    try {
      await scene(this);
      return run === this.run;
    } catch (e) {
      if (e instanceof Cancelled) return false;
      throw e;
    }
  }

  /** Pauses the scene; throws if another scene started (or the desk stopped) meanwhile. */
  async wait(ms: number) {
    const run = this.run;
    await new Promise((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 120) : ms));
    if (run !== this.run) throw new Cancelled();
  }

  reset() {
    this.rows.replaceChildren();
    this.panes.replaceChildren();
    this.panes.className = "dk-panes";
    this.title.textContent = "";
  }

  // Sidebar

  row(label: string, opts: { active?: boolean; color?: Color; into?: HTMLElement; enter?: boolean; split?: number } = {}) {
    const row = el("div", "dk-row");
    const layout = el("span", "dk-layout");
    for (let i = 0; i < (opts.split ?? 1); i++) layout.append(el("i", ""));
    if (opts.color) row.style.setProperty("--c", `var(--group-${opts.color})`);
    row.append(layout, el("span", "dk-label", label));
    if (opts.enter) row.classList.add("enter");
    (opts.into ?? this.rows).append(row);
    if (opts.active) this.activate(row);
    return row;
  }

  activate(row: HTMLElement) {
    for (const r of this.root.querySelectorAll(".dk-row.active")) r.classList.remove("active");
    row.classList.add("active");
    this.title.textContent = row.querySelector(".dk-label")!.textContent ?? "";
  }

  group(name: string, color: Color, opts: { enter?: boolean; before?: Element } = {}) {
    const group = el("div", "dk-group");
    group.style.setProperty("--c", `var(--group-${color})`);
    const head = el("div", "dk-group-head");
    head.append(el("span", "dk-group-dot"), el("span", "dk-group-name", name));
    const tabs = el("div", "dk-group-tabs");
    group.append(head, tabs);
    if (opts.enter) group.classList.add("enter");
    if (opts.before) this.rows.insertBefore(group, opts.before);
    else this.rows.append(group);
    return { group, head, tabs };
  }

  // Panes

  pane(dir: string, opts: { focused?: boolean } = {}) {
    const pane = el("div", "dk-pane");
    const lines = el("div", "dk-lines");
    pane.append(lines);
    pane.dataset.dir = dir;
    this.panes.append(pane);
    if (opts.focused ?? true) this.focus(pane);
    return pane;
  }

  focus(pane: HTMLElement) {
    for (const p of this.panes.querySelectorAll(".dk-pane.focused")) p.classList.remove("focused");
    pane.classList.add("focused");
  }

  /** A fresh prompt line in `pane`, with a blinking caret; returns where typed text goes. */
  prompt(pane: HTMLElement) {
    for (const c of this.root.querySelectorAll(".dk-caret")) c.remove();
    const line = el("div", "dk-line");
    line.append(el("span", "dk-path", pane.dataset.dir ?? "~"), el("span", "dk-arrow", " ❯ "));
    const input = el("span", "dk-input");
    line.append(input, el("span", "dk-caret"));
    pane.querySelector(".dk-lines")!.append(line);
    return input;
  }

  /** Output lines; each is a list of [text, tone] parts, tone being a group color or "muted". */
  async out(pane: HTMLElement, lines: [string, string?][][], gap = 70) {
    for (const c of pane.querySelectorAll(".dk-caret")) c.remove();
    for (const parts of lines) {
      const line = el("div", "dk-line enter");
      for (const [text, tone] of parts) {
        const span = el("span", "", text);
        if (tone) span.style.color = tone === "muted" ? "var(--muted)" : `var(--group-${tone})`;
        line.append(span);
      }
      pane.querySelector(".dk-lines")!.append(line);
      await this.wait(gap);
    }
  }

  async type(target: HTMLElement, text: string, speed = 55) {
    for (const ch of text) {
      target.textContent += ch;
      await this.wait(speed + Math.random() * speed * 0.6);
    }
  }

  async erase(target: HTMLElement, speed = 30) {
    while (target.textContent) {
      target.textContent = target.textContent.slice(0, -1);
      await this.wait(speed);
    }
  }

  /** Where typed text goes on `pane`'s current prompt line. */
  inputOf(pane: HTMLElement) {
    const inputs = pane.querySelectorAll<HTMLElement>(".dk-input");
    return inputs[inputs.length - 1];
  }

  /** Replaces the panes with `count` fresh ones in `dir`, as a new tab would; returns the focused one. */
  freshPanes(dir: string, count = 1) {
    this.panes.replaceChildren();
    const panes = Array.from({ length: count }, (_, i) => this.pane(dir, { focused: i === 0 }));
    for (const p of panes.slice(1)) this.prompt(p);
    this.prompt(panes[0]);
    return panes[0];
  }

  /** Splits the pane area into columns (1–2), the second optionally in two rows. */
  layout(kind: "single" | "cols" | "cols-rows") {
    this.panes.className = `dk-panes ${kind}`;
  }

  /** Lights up a key chip floating over the desk, as if just pressed. */
  async press(keys: HTMLElement) {
    const chip = el("div", "dk-press");
    chip.append(keys);
    this.root.append(chip);
    await this.wait(620);
    chip.classList.add("leave");
    setTimeout(() => chip.remove(), 300);
  }
}

// ─── Scenes ──────────────────────────────────────────────────────────────────

const pressFor = (action: Action) => kbdFor(action);

/** The theme step's preview: a desk to show the theme off. */
async function themeScene(d: Desk) {
  const { tabs } = d.group("payments", "blue");
  d.row("api", { into: tabs, active: true });
  d.row("worker", { into: tabs });
  const web = d.group("website", "pink");
  d.row("dev server", { into: web.tabs });
  d.row("notes", { color: "green" });
  const pane = d.pane("~/Projects/payments/api");
  d.prompt(pane).textContent = "ls";
  await d.out(pane, [[["src  ", "blue"], ["test  ", "blue"], ["package.json  ", ""], ["deploy.sh", "green"]]], 0);
  d.prompt(pane).textContent = "git diff --stat";
  await d.out(pane, [[[" src/server.ts | 12 "], ["++++++++", "green"], ["----", "red"]], [[" 1 file changed", "muted"]]], 0);
  d.prompt(pane);
  await new Promise(() => {}); // Holds still; the theme picker drives it.
}

/** The basics as one continuous story; `chapter` names the feature on stage. */
async function basicsStory(d: Desk, chapter: (id: string) => void) {
  // A terminal.
  chapter("terminal");
  const home = d.row("workdesk", { active: true });
  const first = d.pane("~/Projects/workdesk");
  await d.wait(600);
  await d.type(d.prompt(first), "git status");
  await d.wait(240);
  await d.out(first, [[["On branch "], ["main", "cyan"]], [["  modified:   ", "red"], ["src/server.ts", "red"]]]);
  await d.wait(400);
  await d.type(d.prompt(first), "npm run build");
  await d.out(first, [[["✓ ", "green"], ["built in 812ms"]]], 220);
  d.prompt(first);
  await d.wait(1300);

  // A new tab, in the same folder.
  chapter("tabs");
  await d.wait(500);
  await d.press(pressFor("newTab"));
  const tab = d.row("zsh", { active: true, enter: true });
  const second = d.freshPanes("~/Projects/workdesk");
  await d.wait(400);
  await d.type(d.inputOf(second), "npm run dev");
  await d.out(second, [[["ready on ", "muted"], ["localhost:5173", "cyan"]]]);
  d.prompt(second);
  await d.wait(1300);

  // Split it.
  chapter("split");
  await d.wait(500);
  await d.press(pressFor("splitRight"));
  d.layout("cols");
  tab.querySelector(".dk-layout")!.append(el("i", ""));
  const right = d.pane("~/Projects/workdesk");
  await d.type(d.prompt(right), "git log --oneline", 45);
  await d.out(right, [[["a41c2f9 ", "yellow"], ["Add onboarding"]], [["7be0d13 ", "yellow"], ["Teleport favorites"]]]);
  d.prompt(right);
  await d.wait(500);
  await d.press(pressFor("splitDown"));
  d.layout("cols-rows");
  tab.querySelector(".dk-layout")!.classList.add("rows");
  const third = d.pane("~/Projects/workdesk");
  await d.type(d.prompt(third), "npm test", 50);
  await d.out(third, [[["✓ ", "green"], ["42 passed", "muted"]]]);
  d.prompt(third);
  await d.wait(1300);

  // Group both tabs.
  chapter("groups");
  await d.wait(500);
  home.classList.add("selected");
  await d.wait(380);
  tab.classList.add("selected");
  await d.wait(500);
  await d.press(pressFor("groupSelected"));
  const group = d.group("workdesk", "blue", { enter: true, before: home });
  home.classList.remove("selected");
  tab.classList.remove("selected");
  group.tabs.append(home, tab);
  await d.wait(1600);

  // Name the busy tab for what it's doing.
  chapter("rename");
  await d.wait(400);
  await d.press(pressFor("renameTab"));
  const label = tab.querySelector<HTMLElement>(".dk-label")!;
  tab.classList.add("editing");
  label.after(el("span", "dk-caret"));
  await d.erase(label, 60);
  await d.type(label, "dev server", 70);
  await d.wait(400);
  tab.classList.remove("editing");
  tab.querySelector(".dk-caret")?.remove();
  d.activate(tab);
  await d.wait(1200);

  // And give the group a color.
  chapter("colors");
  await d.wait(400);
  group.head.classList.add("menu-target");
  const menu = el("div", "dk-swatches enter");
  const order: Color[] = ["blue", "purple", "pink", "orange", "yellow", "green", "cyan", "red"];
  const swatches = order.map((c) => {
    const s = el("i", "");
    s.style.background = `var(--group-${c})`;
    menu.append(s);
    return s;
  });
  group.head.after(menu);
  for (const [i, color] of [[2, "pink"], [5, "green"], [3, "orange"]] as [number, Color][]) {
    await d.wait(620);
    swatches.forEach((s) => s.classList.remove("on"));
    swatches[i].classList.add("on");
    group.group.style.setProperty("--c", `var(--group-${color})`);
  }
  await d.wait(500);
  menu.remove();
  group.head.classList.remove("menu-target");
  await d.wait(2000);
}

/** A small drawing of what a basics feature does, for its bento tile. */
function tileArt(id: string): HTMLElement {
  const art = el("div", `ob-art ob-art-${id}`);
  const line = (...parts: [string, string?][]) => {
    const row = el("div", "ob-art-line");
    for (const [text, cls] of parts) row.append(el("span", cls ?? "", text));
    return row;
  };
  const tab = (label: string, cls = "") => {
    const row = el("div", `ob-art-tab ${cls}`);
    row.append(el("i", ""), el("span", "", label));
    return row;
  };
  switch (id) {
    case "terminal":
      art.append(
        line(["~/workdesk", "path"], [" ❯ git status"]),
        line(["On branch "], ["main", "hi"]),
        line(["~/workdesk", "path"], [" ❯ npm run build"]),
        line(["✓ ", "ok"], ["built in 812ms"]),
      );
      break;
    case "tabs":
      art.append(tab("workdesk"), tab("notes"), tab("zsh", "new"));
      break;
    case "split": {
      for (let i = 0; i < 3; i++) art.append(el("i", ""));
      break;
    }
    case "groups": {
      const head = el("div", "ob-art-group");
      head.append(el("i", ""), el("span", "", "workdesk"));
      const tabs = el("div", "ob-art-group-tabs");
      tabs.append(tab("workdesk"), tab("dev server"));
      art.append(head, tabs);
      break;
    }
    case "rename": {
      const field = el("div", "ob-art-field");
      field.append(el("span", "", "dev server"), el("span", "ob-art-caret"));
      art.append(field);
      break;
    }
    case "colors":
      for (const c of ["blue", "purple", "pink", "orange", "yellow", "green", "cyan", "red"]) {
        const dot = el("i", c === "orange" ? "on" : "");
        dot.style.background = `var(--group-${c})`;
        art.append(dot);
      }
      break;
  }
  return art;
}

// ─── Steps ───────────────────────────────────────────────────────────────────

interface Feature {
  id: string;
  name: string;
  icon: IconNode;
  text: string;
  /** Shortcut chips shown on the row. */
  keys: () => HTMLElement[];
  /** Pressing one of these plays the feature: combos, or single typed characters. */
  combos: () => string[];
}

/** A feature's shortcut chips, alternatives split by a slash. */
function featureKeys(f: Feature) {
  const keys = el("span", "ob-feature-keys");
  f.keys().forEach((k, j) => keys.append(...(j ? [el("span", "ob-feature-or", "/"), k] : [k])));
  return keys;
}

const actionKeys = (...actions: Action[]) => ({
  keys: () => actions.map((a) => kbdFor(a)),
  combos: () => actions.flatMap((a) => combosFor(keymap(), a)),
});

const BASICS: Feature[] = [
  {
    id: "terminal",
    name: "Terminal",
    icon: Terminal,
    text: "A full shell in every tab. Search its output, and ⌘-click a file path to open it in your editor.",
    ...actionKeys("findInTerminal"),
  },
  { id: "tabs", name: "Tabs", icon: Plus, text: "New tabs open in the folder you're already in.", ...actionKeys("newTab") },
  {
    id: "split",
    name: "Split panes",
    icon: Columns2,
    text: "Split right or down, as many times as you like. Each pane is its own shell.",
    ...actionKeys("splitRight", "splitDown"),
  },
  {
    id: "groups",
    name: "Tab groups",
    icon: Layers,
    text: "Select a few tabs and group them to keep a project together. Groups fold away when you don't need them.",
    ...actionKeys("groupSelected"),
  },
  {
    id: "rename",
    name: "Rename",
    icon: Type,
    text: "Name a tab for what it's for. Unnamed tabs follow whatever is running in them.",
    ...actionKeys("renameTab"),
  },
  {
    id: "colors",
    name: "Colors",
    icon: Palette,
    text: "Right-click a tab or group to give it a color you can spot at a glance.",
    keys: () => [kbdKeys(["Right-click"])],
    combos: () => [],
  },
];

const POWER_UPS: Feature[] = [
  {
    id: "teleport",
    name: "Teleport",
    icon: Shell,
    text: "Type part of any folder's name and open a new tab there. Recent folders come first.",
    ...actionKeys("newTabIn"),
  },
  {
    id: "favorites",
    name: "Favorite destinations",
    icon: Star,
    text: "Star a folder in Teleport and it stays at the top of the list.",
    keys: () => [kbd("mod+d")],
    combos: () => ["mod+d"],
  },
  {
    id: "macros",
    name: "Macros",
    icon: AtSign,
    text: "Start with @name to run a list of commands as the tab opens, like @dev. Write your own in Settings.",
    keys: () => [kbdKeys(["@"])],
    combos: () => ["@"],
  },
  {
    id: "loadouts",
    name: "Loadouts",
    icon: Package,
    text: "Save your tabs, groups and splits, then open them all again with #name or from the Loadouts menu.",
    keys: () => [kbdKeys(["#"])],
    combos: () => ["#"],
  },
];

type StepId = "welcome" | "basics" | "power" | "theme" | "done";
const STEPS: StepId[] = ["welcome", "basics", "power", "theme", "done"];

/**
 * First-run tour: a welcome, the basics, the power-ups, a theme, and a send-off.
 * It only shows and explains; the one thing it changes is the theme, and only
 * when one is picked. Replaying it from the menu bar leaves everything else alone.
 */
export class Onboarding {
  /** `onClosed` runs once the tour has faded out. */
  constructor(private onClosed: () => void) {}

  private root: HTMLElement | null = null;
  private stage!: HTMLElement;
  private step = 0;
  private desk = new Desk();
  private stage_ = new Stage();
  /** The features on screen that a shortcut can jump to, and how to jump. */
  private features: Feature[] = [];
  private featureIndex = 0;
  private jump: ((i: number) => void) | null = null;
  private cleanup: (() => void)[] = [];
  private themeButtons: HTMLElement[] = [];

  get isOpen() {
    return this.root != null;
  }

  open() {
    if (this.root) return;

    const root = el("div", "ob");
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Welcome to Workdesk");
    const skip = el("button", "ob-skip", "Skip tour");
    skip.addEventListener("click", () => this.finish());
    this.stage = el("div", "ob-stage");
    root.append(el("div", "ob-veil"), this.stage, skip);
    root.addEventListener("keydown", (e) => this.onKey(e));
    document.body.append(root);
    this.root = root;
    requestAnimationFrame(() => root.classList.add("in"));
    this.show(0);
    root.focus();
  }

  /** Ends the tour where it is; nothing is undone. */
  finish() {
    if (!this.root) return;
    markOnboarded();
    this.desk.stop();
    this.stage_.stop();
    for (const fn of this.cleanup.splice(0)) fn();
    const root = this.root;
    this.root = null;
    root.classList.remove("in");
    root.classList.add("out");
    setTimeout(() => {
      root.remove();
      this.onClosed();
    }, reducedMotion() ? 0 : 480);
  }

  private show(index: number) {
    const dir = index >= this.step ? 1 : -1;
    this.step = index;
    this.desk.stop();
    this.stage_.stop();
    for (const fn of this.cleanup.splice(0)) fn();

    const old = this.stage.querySelector(".ob-screen:not(.leaving)");
    if (old) {
      old.classList.add("leaving");
      old.classList.toggle("back", dir < 0);
      setTimeout(() => old.remove(), 420);
    }
    const id = STEPS[index];
    if (this.root) this.root.dataset.step = id;
    const screen =
      id === "welcome" ? this.welcome() : id === "done" ? this.done() : id === "theme" ? this.themeStep() : this.featureStep(id);
    screen.classList.add("ob-screen", `ob-step-${id}`);
    screen.classList.toggle("from-back", dir < 0);
    this.stage.append(screen);
    this.root?.focus();
  }

  private next() {
    if (this.step < STEPS.length - 1) this.show(this.step + 1);
    else this.finish();
  }

  private back() {
    if (this.step > 0 && STEPS[this.step] !== "done") this.show(this.step - 1);
  }

  private onKey(e: KeyboardEvent) {
    // Keep keys from reaching the app (and the terminals) behind the tour.
    e.stopPropagation();
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Back and Skip do what they say; everywhere else Enter moves on.
      if (e.target instanceof Element && e.target.closest(".ob-back, .ob-skip")) return;
      e.preventDefault();
      if (e.shiftKey) this.back();
      else this.next();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (this.jump) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const n = this.features.length;
        this.jump((this.featureIndex + (e.key === "ArrowRight" ? 1 : n - 1)) % n);
        return;
      }
      // Pressing a feature's real shortcut plays it.
      const combo = comboFromEvent(e);
      const hit = this.features.findIndex((f) => f.combos().some((c) => c === combo || c === e.key));
      if (hit >= 0) {
        e.preventDefault();
        this.jump(hit);
        return;
      }
    }
    if (STEPS[this.step] === "theme" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const i = this.themeButtons.findIndex((b) => b === document.activeElement);
      const j = Math.max(0, Math.min(this.themeButtons.length - 1, (i < 0 ? 0 : i) + (e.key === "ArrowRight" ? 1 : -1)));
      this.themeButtons[j]?.focus();
      return;
    }
    if (e.metaKey && ["q", "h", "m"].includes(e.key.toLowerCase())) return;
    if (e.metaKey || e.ctrlKey) e.preventDefault();
  }

  // ─── Screens ───

  private nextButton(label: string) {
    const b = el("button", "ob-next");
    b.append(el("span", "", label), kbdKeys(["↵"]));
    b.addEventListener("click", () => this.next());
    return b;
  }

  private welcome() {
    const screen = el("section", "");
    const logo = mark("ob-welcome-mark");
    const eyebrow = el("p", "ob-eyebrow", "Welcome to");
    const word = el("h1", "ob-wordmark", "Workdesk");
    const tagline = el("p", "ob-tagline", "A desk for your terminals.");
    const lede = el("p", "ob-lede", "Here's a quick tour: the basics, a few power-ups, and a theme to make it yours.");
    const actions = el("div", "ob-actions");
    actions.append(this.nextButton("Show me around"), el("span", "ob-aside", "About a minute"));
    screen.append(logo, eyebrow, word, tagline, lede, actions);
    setTimeout(() => screen.querySelector<HTMLElement>(".ob-next")?.focus({ preventScroll: true }), 50);
    return screen;
  }

  /** The step's place in the mark: one blade per step after the welcome. */
  private progress() {
    const lit = this.step;
    const wrap = el("div", "ob-progress");
    const m = mark("ob-progress-mark");
    m.querySelectorAll(".blade").forEach((b, i) => {
      if (i < lit) b.classList.add("lit");
      if (i === lit - 1) b.classList.add("now");
    });
    wrap.append(m, el("span", "ob-progress-text", `${lit} of 4`));
    return wrap;
  }

  private card(eyebrow: string, title: string, lede: string, left: HTMLElement, nextLabel: string, preview: HTMLElement) {
    const screen = el("section", "");
    const card = el("div", "ob-card");
    const copy = el("div", "ob-copy");
    const head = el("header", "ob-head");
    const titleRow = el("div", "ob-title-row");
    titleRow.append(el("p", "ob-eyebrow", eyebrow), this.progress());
    head.append(titleRow, el("h2", "ob-title", title), el("p", "ob-lede", lede));
    const foot = el("footer", "ob-foot");
    const back = el("button", "ob-back", "Back");
    back.addEventListener("click", () => this.back());
    foot.append(back, this.nextButton(nextLabel));
    copy.append(head, left, foot);
    const side = el("div", "ob-side");
    side.append(preview);
    card.append(copy, side);
    screen.append(card);
    return screen;
  }

  /** A step with no card: the desk floats in the open, its features as loose captions either side. */
  private floating(eyebrow: string, title: string, lede: string, left: HTMLElement[], right: HTMLElement[], nextLabel: string) {
    const screen = el("section", "ob-open");
    const head = el("header", "ob-open-head");
    const titleRow = el("div", "ob-title-row");
    titleRow.append(el("p", "ob-eyebrow", eyebrow), this.progress());
    head.append(titleRow, el("h2", "ob-title", title), el("p", "ob-lede", lede));
    const scene = el("div", "ob-open-scene");
    const desk = el("div", "ob-open-desk");
    const leftCol = el("div", "ob-floats left");
    const rightCol = el("div", "ob-floats right");
    leftCol.append(...left);
    rightCol.append(...right);
    desk.append(this.desk.root, leftCol, rightCol);
    scene.append(desk);
    const foot = el("footer", "ob-open-foot");
    const back = el("button", "ob-back", "Back");
    back.addEventListener("click", () => this.back());
    foot.append(back, this.nextButton(nextLabel));
    screen.append(head, scene, foot);
    return screen;
  }

  private featureStep(id: "basics" | "power") {
    return id === "basics" ? this.basicsStep(BASICS) : this.powerStep(POWER_UPS);
  }

  /**
   * The power-ups as illustrations, one after another: Teleport, favorites,
   * macros, loadouts. A strip of chapters underneath fills as each plays and
   * can be clicked (or its shortcut pressed) to jump; after the last, the four
   * settle into a bento of full-height columns.
   */
  private powerStep(features: Feature[]) {
    const screen = el("section", "ob-open ob-power");
    const head = el("header", "ob-open-head");
    const titleRow = el("div", "ob-title-row");
    titleRow.append(el("p", "ob-eyebrow", "Power-ups"), this.progress());
    head.append(
      titleRow,
      el("h2", "ob-title", "Get anywhere in a keystroke."),
      el("p", "ob-lede", "Teleport opens a tab in any folder. Favorites, macros and loadouts turn that one keystroke into a whole setup."),
    );

    const scene = el("div", "ob-open-scene");
    const show = el("div", "ob-power-show");
    const strip = el("div", "ob-chapters");
    const blurb = el("p", "ob-chapter-text");
    const chapters = features.map((f, i) => {
      const b = el("button", "ob-chapter");
      const keys = featureKeys(f);
      const top = el("span", "ob-chapter-top");
      top.append(icon(f.icon, 15, "ob-chapter-icon"), el("span", "ob-chapter-name", f.name), keys);
      b.append(top, el("span", "ob-chapter-bar"));
      b.addEventListener("click", () => play(i));
      strip.append(b);
      return b;
    });
    show.append(this.stage_.root, strip, blurb);

    const bento = el("div", "ob-columns");
    bento.setAttribute("aria-hidden", "true");
    features.forEach((f, i) => {
      const col = el("div", "ob-column");
      col.style.setProperty("--i", String(i));
      const keys = featureKeys(f);
      const words = el("div", "ob-column-words");
      const name = el("div", "ob-column-name");
      name.append(icon(f.icon, 16, "ob-column-icon"), el("span", "", f.name));
      words.append(name, keys, el("p", "ob-column-text", f.text));
      col.append(el("div", "ob-column-art"), words);
      col.querySelector(".ob-column-art")!.append(POWER_SCENES[f.id as keyof typeof POWER_SCENES].still());
      bento.append(col);
    });
    scene.append(show, bento);

    const foot = el("footer", "ob-open-foot");
    const replay = el("button", "ob-replay", "Watch again");
    replay.addEventListener("click", () => play(0));
    const back = el("button", "ob-back", "Back");
    back.addEventListener("click", () => this.back());
    foot.append(replay, back, this.nextButton("Next"));
    screen.append(head, scene, foot);

    const play = (i: number) => {
      this.featureIndex = i;
      screen.classList.remove("bento");
      const f = features[i];
      const sceneDef = POWER_SCENES[f.id as keyof typeof POWER_SCENES];
      chapters.forEach((c, j) => {
        c.classList.toggle("active", j === i);
        c.classList.toggle("seen", j < i);
        c.setAttribute("aria-current", String(j === i));
        // Restart the fill so it tracks this run.
        const bar = c.querySelector<HTMLElement>(".ob-chapter-bar")!;
        bar.style.animation = "none";
        flushStyle(bar);
        bar.style.animation = "";
      });
      chapters[i].style.setProperty("--ms", `${sceneDef.ms}ms`);
      blurb.textContent = f.text;
      blurb.classList.remove("in");
      flushStyle(blurb);
      blurb.classList.add("in");
      void this.stage_.play(sceneDef).then((finished) => {
        if (!finished) return;
        if (i + 1 < features.length) play(i + 1);
        else {
          for (const c of chapters) c.classList.remove("active");
          screen.classList.add("bento");
        }
      });
    };
    this.features = features;
    this.jump = play;
    this.cleanup.push(() => {
      this.features = [];
      this.jump = null;
    });
    requestAnimationFrame(() => play(0));
    return screen;
  }

  /**
   * The basics as one story on the desk: a terminal, a new tab, split panes, a
   * group, a rename and a color. Each caption lights as its feature appears,
   * and the story closes on a bento of all six.
   */
  private basicsStep(features: Feature[]) {
    // Sidebar features sit by the sidebar; the rest by the panes.
    const LEFT = new Set(["tabs", "groups", "rename", "colors"]);
    let li = 0;
    let ri = 0;
    const captions = new Map<string, HTMLElement>();
    for (const f of features) {
      const side = LEFT.has(f.id) ? "left" : "right";
      const row = el("div", "ob-float");
      row.style.setProperty("--i", String(side === "left" ? li++ : ri++));
      const top = el("span", "ob-float-top");
      const keys = featureKeys(f);
      top.append(el("span", "ob-float-name", f.name), keys, el("span", "ob-float-line"));
      row.append(top, el("span", "ob-float-text", f.text));
      row.dataset.side = side;
      captions.set(f.id, row);
    }
    const rows = [...captions.values()];
    const screen = this.floating(
      "The basics",
      "Everything a terminal should do.",
      "Each tab is a shell, and the sidebar keeps them in order. Watch one project come together.",
      rows.filter((r) => r.dataset.side === "left"),
      rows.filter((r) => r.dataset.side === "right"),
      "Next",
    );

    const bento = el("div", "ob-bento");
    bento.setAttribute("aria-hidden", "true");
    features.forEach((f, i) => {
      const tile = el("div", `ob-tile ob-tile-${f.id}`);
      const art = tileArt(f.id);
      tile.style.setProperty("--i", String(i));
      const keys = featureKeys(f);
      const top = el("div", "ob-tile-top");
      top.append(icon(f.icon, 16, "ob-tile-icon"), keys);
      tile.append(top, art, el("div", "ob-tile-name", f.name), el("p", "ob-tile-text", f.text));
      bento.append(tile);
    });
    const replay = el("button", "ob-replay", "Watch again");
    replay.addEventListener("click", () => play());
    screen.querySelector(".ob-open-scene")!.append(bento);
    screen.querySelector(".ob-open-foot")!.prepend(replay);

    const chapter = (id: string) => {
      for (const [key, row] of captions) {
        if (row.classList.contains("active")) row.classList.add("seen");
        row.classList.toggle("active", key === id);
      }
    };
    const play = () => {
      screen.classList.remove("bento");
      for (const row of rows) row.classList.remove("active", "seen");
      void this.desk.play((d) => basicsStory(d, chapter)).then((finished) => {
        if (!finished) return;
        chapter("");
        screen.classList.add("bento");
      });
    };
    requestAnimationFrame(play);
    return screen;
  }

  private themeStep() {
    const originals = THEMES.filter((t) => t.original);
    const grid = el("div", "ob-themes");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Theme");
    const name = el("span", "ob-theme-name");
    const pick = (theme: Theme) => {
      setTheme(theme);
      name.textContent = theme.name;
      for (const b of this.themeButtons) {
        const on = b.dataset.name === theme.name;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      }
    };
    this.themeButtons = originals.map((theme) => {
      const b = el("button", "ob-theme");
      b.dataset.name = theme.name;
      b.title = theme.name;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", theme.name);
      b.style.setProperty("--t-bg", theme.bg);
      b.style.setProperty("--t-fg", theme.fg);
      b.style.setProperty("--t-accent", theme.accent);
      const chip = el("span", "ob-theme-chip");
      for (const c of [theme.groups.blue, theme.groups.pink, theme.groups.green]) {
        const dot = el("i", "");
        dot.style.background = c;
        chip.append(dot);
      }
      b.append(chip, icon(Check, 11, "ob-theme-check"));
      b.addEventListener("click", () => pick(theme));
      b.addEventListener("focus", () => pick(theme));
      grid.append(b);
      return b;
    });
    const all = el("p", "ob-theme-more");
    all.append(
      document.createTextNode(`Browse all ${THEMES.length} themes, fonts and tab colors any time in Settings `),
      kbdFor("openSettings"),
    );
    const left = el("div", "ob-theme-pick");
    const nameRow = el("div", "ob-theme-current");
    nameRow.append(el("span", "ob-theme-label", "Theme"), name);
    left.append(nameRow, grid, all);
    pick(currentTheme());
    void this.desk.play(themeScene);
    this.cleanup.push(() => (this.themeButtons = []));
    return this.card(
      "Your theme",
      "Make it yours.",
      "Pick a look for the terminals and everything around them. The preview, and the app behind it, change as you go.",
      left,
      "Finish",
      this.desk.root,
    );
  }

  private done() {
    const screen = el("section", "");
    const logo = mark("ob-done-mark");
    const halo = el("div", "ob-halo");
    const logoWrap = el("div", "ob-done-logo");
    logoWrap.append(halo, logo);
    const title = el("h1", "ob-done-title", "You're all set.");
    const lede = el("p", "ob-lede");
    lede.append(document.createTextNode("Open a folder with Teleport "), kbdFor("newTabIn"), document.createTextNode(" whenever you need one."));
    const replay = el("p", "ob-aside", "Replay this tour any time from Workdesk › Restart Onboarding.");
    const actions = el("div", "ob-actions");
    actions.append(this.nextButton("Start working"));
    screen.append(logoWrap, title, lede, actions, replay);
    // Let the card clear out first so the spin and the glow land together.
    const t = setTimeout(() => {
      screen.classList.add("play");
      void invoke("edge_glow", { colors: GLOW }).catch(() => {});
    }, reducedMotion() ? 0 : 260);
    this.cleanup.push(() => clearTimeout(t));
    setTimeout(() => screen.querySelector<HTMLElement>(".ob-next")?.focus({ preventScroll: true }), 50);
    return screen;
  }
}
