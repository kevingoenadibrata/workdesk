import "./powerups.css";
import { kbdKeys } from "./kbd";
import { MOD_LABEL } from "./shortcuts";
import { FolderOpen, Star, icon } from "./icons";

/*
 * The power-ups, drawn rather than recorded: each is a short illustrated scene
 * on an open stage (Teleport's vortex, a drift of folders getting starred, an
 * alias unfolding into commands, a loadout bursting into a workspace), plus a
 * still version of each for the closing bento.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Forces a style flush, so a transition starts from what's on screen now. */
const flush = (node: Element) => void node.getBoundingClientRect();

class Cancelled extends Error {}

/** Scenes are laid out at this size, then scaled down to fit the stage. */
const SCENE_W = 920;
const SCENE_H = 460;

/** Plays one scene at a time on a stage; starting another (or stopping) cancels the one playing. */
export class Stage {
  readonly root = el("div", "pu-stage");
  private run = 0;
  /** How much the scene is scaled to fit (1 or less). */
  fit = 1;

  constructor() {
    this.root.setAttribute("aria-hidden", "true");
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.fit = Math.min(1, width / SCENE_W, height / SCENE_H) || 1;
      this.root.style.setProperty("--fit", String(this.fit));
    }).observe(this.root);
  }

  stop() {
    this.run++;
  }

  /** Clears the stage and plays `scene`, then holds until `ms` have passed; resolves true if it ran to the end. */
  async play(scene: Scene): Promise<boolean> {
    const run = ++this.run;
    this.root.replaceChildren();
    const started = performance.now();
    try {
      await scene.play(this);
      await this.wait(scene.ms - (performance.now() - started));
      return run === this.run;
    } catch (e) {
      if (e instanceof Cancelled) return false;
      throw e;
    }
  }

  async wait(ms: number) {
    const run = this.run;
    if (ms > 0) await new Promise((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 120) : ms));
    if (run !== this.run) throw new Cancelled();
  }

  async type(target: HTMLElement, text: string, speed = 90) {
    for (const ch of text) {
      target.textContent += ch;
      await this.wait(speed + Math.random() * speed * 0.5);
    }
  }
}

export interface Scene {
  /** How long the scene runs, holds included; the chapter's progress bar fills over it. */
  ms: number;
  play(stage: Stage): Promise<void>;
  /** The still version, for the bento. */
  still(): HTMLElement;
}

/** Big keycaps; `press` pushes them down one after another, as fingers would. */
function keycaps(keys: string[]) {
  const row = el("div", "pu-keys");
  const caps = keys.map((k) => {
    const cap = el("div", "pu-key");
    cap.append(el("span", "", k));
    row.append(cap);
    return cap;
  });
  return {
    row,
    async press(stage: Stage) {
      for (const cap of caps) {
        cap.classList.add("down");
        await stage.wait(170);
      }
      row.classList.add("chord");
      await stage.wait(320);
      for (const cap of caps) cap.classList.remove("down");
    },
  };
}

const MOD = MOD_LABEL.replace("+", "");

// ─── Teleport ────────────────────────────────────────────────────────────────

/** Dashed rings turning at different speeds, and a blurred spiral of light under them. */
function vortex(className = "") {
  const wrap = el("div", `pu-vortex ${className}`);
  wrap.append(el("div", "pu-swirl"), el("div", "pu-swirl pu-swirl-2"));
  const rings = svg("svg", { viewBox: "-300 -300 600 600", class: "pu-rings" });
  const dashes = ["2 9", "26 12 3 12", "1 6", "60 18", "4 14", "90 30 8 30", "2 18"];
  [38, 72, 108, 148, 190, 236, 284].forEach((r, i) => {
    const g = svg("g", { class: "pu-ring" });
    g.style.setProperty("--dur", `${14 + i * 7}s`);
    g.style.setProperty("--dir", i % 2 ? "reverse" : "normal");
    g.append(
      svg("circle", {
        r,
        fill: "none",
        stroke: i % 2 ? "var(--ob-copper)" : "var(--ob-rose)",
        "stroke-width": i < 2 ? 1.6 : 1.1,
        "stroke-dasharray": dashes[i],
        "stroke-linecap": "round",
        opacity: 0.85 - i * 0.09,
      }),
    );
    rings.append(g);
  });
  wrap.append(rings, el("div", "pu-vortex-eye"));
  return wrap;
}

function teleportBox() {
  const box = el("div", "pu-box");
  const text = el("span", "pu-box-text");
  text.dataset.placeholder = "Where to?";
  box.append(icon(FolderOpen, 18, "pu-box-icon"), text, el("span", "pu-caret"));
  return { box, text };
}

const teleport: Scene = {
  ms: 8200,
  async play(stage) {
    const scene = el("div", "pu-scene pu-teleport");
    const swirl = vortex();
    const keys = keycaps([MOD, "⇧", "T"]);
    const { box, text } = teleportBox();
    const results = el("div", "pu-results");
    scene.append(swirl, keys.row, box, results);
    stage.root.append(scene);

    await stage.wait(700);
    keys.row.classList.add("in");
    await stage.wait(500);
    await keys.press(stage);
    swirl.classList.add("surge");
    keys.row.classList.add("gone");
    await stage.wait(300);
    box.classList.add("in");
    await stage.wait(500);
    await stage.type(text, "pay", 130);
    const rows = ["~/Projects/payments", "~/Projects/payments/api", "~/Archive/payslips"].map((path, i) => {
      const row = el("div", "pu-result");
      row.style.setProperty("--i", String(i));
      row.append(icon(FolderOpen, 14, "pu-result-icon"), el("span", "", path));
      results.append(row);
      return row;
    });
    await stage.wait(500);
    rows[1].classList.add("selected");
    await stage.wait(450);
    rows[1].classList.remove("selected");
    rows[0].classList.add("selected");
    rows[0].append(kbdKeys(["↵"]));
    await stage.wait(700);
    // Enter: everything spirals into the eye of the vortex…
    scene.classList.add("warp");
    await stage.wait(950);
    // …and comes out the other side as a new tab there.
    const arrive = el("div", "pu-arrive");
    const chip = el("div", "pu-arrive-chip");
    chip.append(icon(FolderOpen, 16), el("span", "", "~/Projects/payments"));
    arrive.append(el("span", "pu-arrive-label", "New tab"), chip);
    scene.append(arrive);
    swirl.classList.remove("surge");
  },
  still() {
    const s = el("div", "pu-still pu-still-teleport");
    const { box, text } = teleportBox();
    text.textContent = "pay";
    box.classList.add("in");
    s.append(vortex("small"), box);
    return s;
  },
};

// ─── Favorite destinations ───────────────────────────────────────────────────

/** Folders scattered over the stage: path, then where (percent of the stage). */
const DRIFT: [string, number, number][] = [
  ["~/Projects/workdesk", 22, 22],
  ["~/Downloads", 70, 16],
  ["~/dotfiles", 50, 38],
  ["/var/log", 86, 40],
  ["~/Archive/2023", 14, 48],
  ["~/Projects/payments", 64, 60],
  ["~/Desktop", 30, 72],
  ["~/notes", 84, 78],
  ["~/Projects/website", 16, 88],
  ["~/.config/nvim", 52, 86],
];
const STARRED = [0, 5, 2];

function pathChip(path: string) {
  const chip = el("div", "pu-path");
  const star = el("span", "pu-path-star");
  star.append(icon(Star, 13));
  const burst = el("span", "pu-burst");
  for (let i = 0; i < 8; i++) {
    const ray = el("i", "");
    ray.style.setProperty("--a", `${i * 45}deg`);
    burst.append(ray);
  }
  star.append(burst);
  chip.append(icon(FolderOpen, 13, "pu-path-icon"), el("span", "pu-path-text", path), star);
  return chip;
}

const favorites: Scene = {
  ms: 8200,
  async play(stage) {
    const scene = el("div", "pu-scene pu-favorites");
    const panel = el("div", "pu-panel");
    const field = el("div", "pu-panel-field");
    const where = el("span", "pu-box-text");
    where.dataset.placeholder = "Where to?";
    field.append(icon(FolderOpen, 15, "pu-box-icon"), where, el("span", "pu-caret"));
    const heading = el("div", "pu-panel-heading");
    heading.append(icon(Star, 11), el("span", "", "Favorites"));
    // The quick-access rows the starred folders land in, laid out by the panel itself.
    const list = el("div", "pu-panel-list");
    const rows = STARRED.map((ci) => {
      const row = pathChip(DRIFT[ci][0]);
      row.classList.add("starred", "pu-fav-row");
      list.append(row);
      return row;
    });
    panel.append(field, heading, list);
    scene.append(panel);
    const chips = DRIFT.map(([path, x, y], i) => {
      const chip = pathChip(path);
      chip.style.left = `${x}%`;
      chip.style.top = `${y}%`;
      chip.style.setProperty("--i", String(i));
      chip.style.setProperty("--drift", `${5 + (i % 4) * 1.3}s`);
      scene.append(chip);
      return chip;
    });
    stage.root.append(scene);

    await stage.wait(1500);
    for (const i of STARRED) {
      const press = el("div", "pu-mini-press");
      press.append(kbdKeys([MOD, "D"]));
      chips[i].append(press);
      await stage.wait(260);
      chips[i].classList.add("starred");
      await stage.wait(620);
    }
    await stage.wait(400);
    // Quick access: Teleport opens, the rest fall away…
    scene.classList.add("gather");
    await stage.wait(750);
    // …and each starred folder flies onto its row there, then becomes it.
    for (const [slot, ci] of STARRED.entries()) {
      const chip = chips[ci];
      const row = rows[slot];
      const from = chip.getBoundingClientRect();
      const to = row.getBoundingClientRect();
      chip.classList.add("flying");
      chip.style.transform = `translate(${(to.left - from.left) / stage.fit}px, ${(to.top + to.height / 2 - (from.top + from.height / 2)) / stage.fit}px)`;
      // The row opens out from the chip's width to its own.
      row.style.setProperty("--from", `${Math.max(0, to.width - from.width) / stage.fit}px`);
      void stage.wait(700).then(() => {
        row.classList.add("landed");
        chip.classList.add("handed");
      }, () => {});
      await stage.wait(160);
    }
  },
  still() {
    const s = el("div", "pu-still pu-still-favorites");
    for (const ci of [5, 0, 2, 8]) {
      const chip = pathChip(DRIFT[ci][0]);
      if (ci !== 8) chip.classList.add("starred");
      s.append(chip);
    }
    return s;
  },
};

// ─── Macros ──────────────────────────────────────────────────────────────────

const MACRO_STEPS = ["cd ~/Projects/api", "git pull", "npm install", "npm run dev"];

function bigAt() {
  const art = svg("svg", { viewBox: "0 0 300 300", class: "pu-at" });
  const defs = svg("defs");
  const grad = svg("linearGradient", { id: "pu-at-fill", x1: 0, y1: 0, x2: 1, y2: 1 });
  grad.append(svg("stop", { offset: 0, "stop-color": "#FBF1EC" }), svg("stop", { offset: 0.55, "stop-color": "#F4C7B8" }), svg("stop", { offset: 1, "stop-color": "#C98F7E" }));
  defs.append(grad);
  const text = svg("text", { x: 150, y: 158, "text-anchor": "middle", "dominant-baseline": "middle", class: "pu-at-glyph" });
  text.textContent = "@";
  art.append(defs, text);
  return art;
}

function commandList(done: boolean) {
  const list = el("div", "pu-cmds");
  const rows = MACRO_STEPS.map((cmd, i) => {
    const row = el("div", "pu-cmd" + (done ? " in ok" : ""));
    row.style.setProperty("--i", String(i));
    const tick = el("span", "pu-tick");
    tick.append(el("i", ""));
    row.append(tick, el("span", "pu-cmd-prompt", "❯"), el("span", "pu-cmd-text", cmd));
    list.append(row);
    return row;
  });
  return { list, rows };
}

function aliasPill() {
  const pill = el("div", "pu-alias");
  pill.append(el("span", "pu-alias-at", "@"), el("span", "pu-alias-name", "dev"));
  return pill;
}

const macros: Scene = {
  ms: 8600,
  async play(stage) {
    const scene = el("div", "pu-scene pu-macros");
    const at = bigAt();
    const pill = aliasPill();
    const { list, rows } = commandList(false);
    const ready = el("div", "pu-ready");
    ready.append(el("i", ""), el("span", "", "ready on localhost:3000"));
    scene.append(at, pill, list, ready);
    stage.root.append(scene);

    // The @ draws itself, fills, then settles into the alias.
    await stage.wait(2000);
    scene.classList.add("alias");
    await stage.wait(1100);
    // One alias unfolds into the commands it stands for, each running in turn.
    scene.classList.add("unfold");
    await stage.wait(300);
    for (const row of rows) {
      row.classList.add("in");
      await stage.wait(420);
      row.classList.add("ok");
      await stage.wait(160);
    }
    await stage.wait(200);
    ready.classList.add("in");
  },
  still() {
    const s = el("div", "pu-still pu-still-macros");
    s.append(el("div", "pu-still-at", "@"), aliasPill(), commandList(true).list);
    return s;
  },
};

// ─── Loadouts ────────────────────────────────────────────────────────────────

type Piece = { cls: string; x: number; y: number; w: number; h: number; label?: string; color?: string };

/** The workspace a loadout opens, as blocks on a 100×100 grid inside the window. */
const WORKSPACE: Piece[] = [
  { cls: "head", x: 3, y: 9, w: 22, h: 6, label: "payments", color: "blue" },
  { cls: "tab", x: 5, y: 17, w: 20, h: 7, label: "api", color: "blue" },
  { cls: "tab", x: 5, y: 26, w: 20, h: 7, label: "worker", color: "blue" },
  { cls: "tab", x: 5, y: 35, w: 20, h: 7, label: "db", color: "blue" },
  { cls: "head", x: 3, y: 47, w: 22, h: 6, label: "website", color: "pink" },
  { cls: "tab", x: 5, y: 55, w: 20, h: 7, label: "dev server", color: "pink" },
  { cls: "tab", x: 5, y: 64, w: 20, h: 7, label: "deploy", color: "pink" },
  { cls: "pane", x: 28, y: 9, w: 36, h: 87 },
  { cls: "pane", x: 65.5, y: 9, w: 31.5, h: 42.5 },
  { cls: "pane", x: 65.5, y: 53.5, w: 31.5, h: 42.5 },
];
const PANE_RUNS = [
  ["npm run dev", "ready on localhost:3000"],
  ["git status", "nothing to commit"],
  ["npm test --watch", "42 passed"],
];

function workspace(assembled: boolean) {
  const win = el("div", "pu-win" + (assembled ? " built" : ""));
  const bar = el("div", "pu-win-bar");
  bar.append(el("i", ""), el("i", ""), el("i", ""));
  win.append(bar, el("div", "pu-win-side"));
  const pieces = WORKSPACE.map((p, i) => {
    const piece = el("div", `pu-piece pu-piece-${p.cls}` + (assembled ? " placed" : ""));
    Object.assign(piece.style, { left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%`, height: `${p.h}%` });
    piece.style.setProperty("--i", String(i));
    if (p.color) piece.style.setProperty("--c", `var(--group-${p.color})`);
    if (p.cls === "head") piece.append(el("i", ""), el("span", "", p.label));
    if (p.cls === "tab") piece.append(el("i", ""), el("span", "", p.label));
    if (p.cls === "pane") {
      for (let b = 0; b < 4; b++) {
        const bar = el("b", "");
        bar.style.width = `${[62, 38, 74, 46][(b + i) % 4]}%`;
        piece.append(bar);
      }
    }
    win.append(piece);
    return piece;
  });
  return { win, pieces };
}

const loadouts: Scene = {
  ms: 9400,
  async play(stage) {
    const scene = el("div", "pu-scene pu-loadouts");
    const pkg = el("div", "pu-pkg");
    pkg.append(el("span", "pu-pkg-hash", "#"), el("span", "pu-pkg-name", "morning"));
    const { win, pieces } = workspace(false);
    const caption = el("div", "pu-loadout-caption");
    caption.append(el("b", "", "#morning"), el("span", "", "2 groups · 5 tabs · 3 panes, in one go"));
    scene.append(win, pkg, caption);
    stage.root.append(scene);

    await stage.wait(400);
    pkg.classList.add("in");
    await stage.wait(1100);
    pkg.classList.add("open");
    win.classList.add("frame");
    await stage.wait(250);
    // Every piece starts packed in the box, tumbled, and flies out to its place.
    win.classList.add("packing");
    const box = pkg.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    pieces.forEach((piece, i) => {
      const r = piece.getBoundingClientRect();
      // Measured on screen, applied inside the scaled scene.
      const dx = (cx - (r.left + r.width / 2)) / stage.fit;
      const dy = (cy - (r.top + r.height / 2)) / stage.fit;
      piece.style.transform = `translate(${dx}px, ${dy}px) rotate(${(i % 2 ? 1 : -1) * (20 + i * 9)}deg) scale(0.15)`;
    });
    flush(win);
    win.classList.remove("packing");
    flush(win);
    for (const piece of pieces) piece.classList.add("placed");
    for (const piece of pieces) piece.style.transform = "";
    await stage.wait(1600);
    // Then the panes come alive.
    win.classList.add("built");
    const panes = pieces.filter((p) => p.classList.contains("pu-piece-pane"));
    await Promise.all(
      panes.map(async (pane, i) => {
        await stage.wait(i * 260);
        const line = el("div", "pu-run");
        const cmd = el("span", "");
        line.append(el("span", "pu-run-prompt", "❯ "), cmd);
        pane.prepend(line);
        await stage.type(cmd, PANE_RUNS[i][0], 45);
        const out = el("div", "pu-run-out", PANE_RUNS[i][1]);
        line.after(out);
      }),
    );
    await stage.wait(300);
    win.classList.add("shine");
    caption.classList.add("in");
  },
  still() {
    const s = el("div", "pu-still pu-still-loadouts");
    const pkg = el("div", "pu-pkg in small");
    pkg.append(el("span", "pu-pkg-hash", "#"), el("span", "pu-pkg-name", "morning"));
    s.append(workspace(true).win, pkg);
    return s;
  },
};

export const POWER_SCENES = { teleport, favorites, macros, loadouts };
