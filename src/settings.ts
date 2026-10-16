import { invoke } from "@tauri-apps/api/core";
import { loadFavorites, normalizePath, saveFavorites, tildePath } from "./favorites";
import { cleanName, loadMacros, saveMacros, type Macro } from "./macros";
import { kbd, kbdFor } from "./kbd";
import type { IconNode } from "lucide";
import {
  AppWindow,
  AtSign,
  Check,
  ChevronRight,
  FileCode,
  Folder,
  Plug,
  Layers,
  Package,
  Palette,
  Plus,
  Radar,
  RotateCcw,
  Search,
  Shell,
  Star,
  Trash2,
  Type,
  Ticket as TicketIcon,
  icon,
} from "./icons";
import { APP_ICONS, appIconUrl, currentAppIcon, setAppIcon } from "./appIcon";
import { LoadoutEditor } from "./loadoutEditor";
import { DEFAULT_LOG_LINES, MAX_LOG_LINES, MIN_LOG_LINES, logLines, setLogLines } from "./monitorSettings";

import { Page, el } from "./page";
import { PROVIDERS, ticketStore, ticketsApi, type TokenSource } from "./tickets";
import { providerLogo } from "./providerLogos";
import { openUrl } from "@tauri-apps/plugin-opener";
import { attachPathSuggest } from "./pathsuggest";
import { EDITORS, currentEditor, currentFolderApp, installedEditors, setEditor, setFolderApp, type FolderApp } from "./filelinks";
import {
  GROUP_COLOR_NAMES,
  THEMES,
  currentTheme,
  defaultColor,
  setDefaultColor,
  setTheme,
  type Theme,
} from "./themes";
import {
  DEFAULT_FONT,
  MAX_LINE_HEIGHT,
  MAX_SIZE,
  MIN_LINE_HEIGHT,
  MIN_SIZE,
  SUGGESTED_FAMILIES,
  currentFont,
  fontStack,
  onFontChange,
  setFont,
} from "./fonts";

/** One prompt per command line, shown in the gutter beside the commands. */
function gutterPrompts(lines: number) {
  return Array.from({ length: lines }, () => {
    const line = el("span", "macro-prompt");
    line.append(icon(ChevronRight, 14));
    return line;
  });
}

type SubPage = "teleport" | "loadouts" | "appearance" | "editor" | "integrations";
const SUBPAGES: { id: SubPage; label: string; icon: IconNode }[] = [
  { id: "teleport", label: "Teleport", icon: Shell },
  { id: "loadouts", label: "Loadouts", icon: Package },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: FileCode },
  { id: "integrations", label: "Integrations", icon: Plug },
];
const SUBPAGE_KEY = "workdesk.settingsPage";

/** A section heading led by its icon. */
function sectionTitle(text: string, node: IconNode) {
  const title = el("h2", "page-section-title");
  title.append(icon(node, 16, "page-section-icon"), text);
  return title;
}

/** The sub page Settings was last left on. */
function savedSubPage(): SubPage {
  try {
    const id = localStorage.getItem(SUBPAGE_KEY);
    if (SUBPAGES.some((p) => p.id === id)) return id as SubPage;
  } catch {
    // Fall through to the first.
  }
  return SUBPAGES[0].id;
}

type ThemeFilter = "all" | "dark" | "light" | "originals";
const THEME_FILTERS: [ThemeFilter, string][] = [
  ["all", "All"],
  ["dark", "Dark"],
  ["light", "Light"],
  ["originals", "Originals"],
];

/** A swatch of `theme`: a few lines of a shell session in its colors, then its name. */
function themeCard(theme: Theme, active: boolean) {
  const [, red, green, yellow, blue, magenta, cyan] = theme.ansi;
  const card = el("button", active ? "theme-card active" : "theme-card");
  card.setAttribute("aria-pressed", String(active));
  card.title = theme.name;

  const preview = el("div", "theme-preview");
  preview.style.background = theme.bg;
  preview.style.color = theme.fg;
  const span = (text: string, color: string) => {
    const s = el("span", "", text);
    s.style.color = color;
    return s;
  };
  const line = (...parts: (string | HTMLElement)[]) => {
    const l = el("div", "theme-line");
    l.append(...parts);
    return l;
  };
  preview.append(
    line(span("~/desk", blue), " ", span("main", magenta), " ", span("❯", green), " npm test"),
    line(span("✓", green), " 12 passed ", span("2 skipped", yellow)),
    line(span("✗", red), " 1 failed ", span("src/app.ts", cyan)),
  );
  const swatches = el("div", "theme-swatches");
  for (const c of theme.ansi.slice(1, 7)) {
    const sw = el("span", "");
    sw.style.background = c;
    swatches.append(sw);
  }
  preview.append(swatches);

  const label = el("div", "theme-name");
  label.append(el("span", "theme-name-text", theme.name), icon(Check, 13, "theme-check"));
  card.append(preview, label);
  return card;
}

/**
 * ⌘, settings page, laid over the terminal area, split into sub pages picked
 * from a list on the left. Teleport holds macros (a name used as "@name" in
 * Teleport and the commands typed into the new shell, one per line) and
 * favorite destinations (folders Teleport lists first); Appearance holds the
 * color theme. Edits save as you type.
 */
export class Settings extends Page {
  readonly title = "Settings";
  private list!: HTMLElement;
  private macros: Macro[] = [];
  private favList!: HTMLElement;
  private favorites: string[] = [];
  /** Bumped per check so a slow folder lookup can't flag newer edits. */
  private favSeq = 0;
  private themeGrid!: HTMLElement;
  private themeCount!: HTMLElement;
  private themeQuery = "";
  private themeFilter: ThemeFilter = "all";
  /** Loadout whose name to focus when the Loadouts sub page is next built. */
  private focusLoadout: string | undefined;
  /** Switches to a sub page while Settings is open. */
  private showSub: ((id: SubPage) => HTMLElement | null) | null = null;
  /** Opens a loadout's tabs; set by the app. */
  onOpenLoadout: (name: string) => void = () => {};

  constructor(host: HTMLElement) {
    super(host);
    onFontChange((f) => this.syncFont?.(f));
  }

  protected build(body: HTMLElement) {
    body.classList.add("settings-body");
    const nav = el("nav", "settings-nav");
    nav.setAttribute("aria-label", "Settings sections");
    const content = el("div", "settings-content");
    const buttons = new Map<SubPage, HTMLButtonElement>();

    const show = (id: SubPage) => {
      for (const [other, b] of buttons) {
        b.classList.toggle("active", other === id);
        if (other === id) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      }
      try {
        localStorage.setItem(SUBPAGE_KEY, id);
      } catch {
        // Opens on the first sub page next time.
      }
      content.replaceChildren();
      // The loadout editor draws a miniature of the app, so it gets the whole width.
      body.classList.toggle("wide", id === "loadouts");
      if (id === "editor") return this.buildEditor(content);
      if (id === "integrations") return this.buildIntegrations(content);
      if (id === "loadouts") return this.buildLoadouts(content);
      return id === "appearance" ? this.buildAppearance(content) : this.buildTeleport(content);
    };
    this.showSub = show;

    for (const sub of SUBPAGES) {
      const b = el("button", "settings-nav-item");
      b.append(icon(sub.icon, 15), sub.label);
      b.addEventListener("click", () => {
        if (b.classList.contains("active")) return;
        show(sub.id);
        content.parentElement?.closest(".page")?.scrollTo(0, 0);
      });
      buttons.set(sub.id, b);
      nav.append(b);
    }

    const layout = el("div", "settings-layout");
    layout.append(nav, content);
    body.append(layout);
    return show(savedSubPage());
  }

  /** Teleport macros and favorite destinations; returns the element to focus. */
  private buildTeleport(content: HTMLElement) {
    this.macros = loadMacros();

    const section = el("section", "page-section");
    const intro = el("p", "page-intro");
    intro.append(
      "Open Teleport with ",
      kbdFor("newTabIn"),
      " and type ",
      el("code", "", "@name"),
      " before a folder to run these commands in the new tab, like ",
      el("code", "", "@claude ~/Projects/workdesk"),
      ".",
    );
    this.list = el("div", "macro-list");
    const add = el("button", "macro-add");
    add.append(icon(Plus), "New macro");
    add.addEventListener("click", () => {
      this.macros.push({ name: "", commands: [] });
      this.save();
      this.render();
      this.list.querySelector<HTMLInputElement>(".macro:last-child .macro-name")?.focus();
    });
    const footnote = el(
      "p",
      "page-footnote",
      "Lines run in order. Once a line starts an interactive program like claude, the lines after it are typed into that program.",
    );
    section.append(sectionTitle("Macros", AtSign), intro, this.list, add, footnote);
    content.append(section, this.buildFavorites());
    this.render();
    this.renderFavorites();
    return this.list.querySelector<HTMLElement>("input") ?? add;
  }

  /** Opens Settings on its Loadouts sub page, with `name`'s name selected for renaming. */
  showLoadout(name?: string) {
    this.focusLoadout = name;
    this.showSubPage("loadouts");
  }

  /** Opens Settings on sub page `id`. */
  showSubPage(id: SubPage) {
    if (this.isOpen && this.showSub) {
      this.showSub(id)?.focus();
      return;
    }
    try {
      localStorage.setItem(SUBPAGE_KEY, id);
    } catch {
      // Opens wherever it was left.
    }
    this.open();
  }

  /** A card per ticket service: connect it with a token, or disconnect it; returns the first token box to focus. */
  private buildIntegrations(content: HTMLElement) {
    const section = el("section", "page-section");
    const intro = el("p", "page-intro");
    intro.append("Connect a service to list the tickets assigned to you on the Tickets page (", kbdFor("openTickets"), "). Tokens are kept in your macOS Keychain.");
    const cards = el("div", "integration-list");
    section.append(sectionTitle("Ticket services", TicketIcon), intro, cards);
    content.append(section);
    let first: HTMLInputElement | null = null;
    for (const p of PROVIDERS) {
      const { card, input } = integrationCard(p);
      first ??= input;
      cards.append(card);
    }
    return first;
  }

  /** The loadout editor; returns the element to focus. */
  private buildLoadouts(content: HTMLElement) {
    const editor = new LoadoutEditor((name) => this.onOpenLoadout(name), this.focusLoadout);
    this.focusLoadout = undefined;
    const { section, focus } = editor.build();
    content.append(section);
    return focus;
  }

  /** Font settings, the default color, the Dock icon, then the theme gallery; returns the theme search box to focus. */
  private buildAppearance(content: HTMLElement) {
    const section = this.buildThemes();
    content.append(this.buildFont(), this.buildDefaultColor(), this.buildAppIcon(), this.buildMonitor(), section);
    return section.querySelector<HTMLElement>(".theme-search input");
  }

  /** Which apps ⌘-clicked files and folders open in; returns the file picker to focus. */
  private buildEditor(content: HTMLElement) {
    /** A segmented picker filled in once the installed editors are known. */
    const picker = <T extends string>(label: string, load: Promise<[[T, string][], T]>, pick: (id: T) => void) => {
      const options = el("div", "theme-filters editor-options");
      options.setAttribute("role", "radiogroup");
      options.setAttribute("aria-label", label);
      void load.then(([choices, picked]) => {
        for (const [id, name] of choices) {
          const b = el("button", "theme-filter", name);
          b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", String(id === picked));
          b.addEventListener("click", () => {
            pick(id);
            for (const other of options.children) other.setAttribute("aria-checked", String(other === b));
          });
          options.append(b);
        }
      });
      return options;
    };
    const have = installedEditors();

    const files = el("section", "page-section");
    const filesIntro = el("p", "page-intro");
    filesIntro.append(
      kbd("mod"),
      "-click a file path in any terminal, like ",
      el("code", "", "src/app.ts:42"),
      ", to open it at that line. Paths are found from the pane's current folder.",
    );
    const fileOptions = picker(
      "Open files in",
      Promise.all([have, currentEditor()]).then(([ids, picked]) => [EDITORS.filter(([id]) => ids.includes(id)).map(([id, name]) => [id, name]), picked]),
      setEditor,
    );
    const footnote = el("p", "page-footnote", "Default app opens the file in whatever opens it from Finder, without going to the line.");
    files.append(sectionTitle("Open files in", FileCode), filesIntro, fileOptions, footnote);

    const folders = el("section", "page-section");
    const foldersIntro = el("p", "page-intro");
    foldersIntro.append(kbd("mod"), "-click a folder path, like ", el("code", "", "~/Projects/workdesk"), ", to show it in Finder or open it as a project in an editor.");
    const folderOptions = picker<FolderApp>(
      "Open folders in",
      Promise.all([have, currentFolderApp()]).then(([ids, picked]) => [
        [["finder", "Finder"], ...EDITORS.filter(([id]) => id !== "system" && ids.includes(id)).map(([id, name]) => [id, name] as [FolderApp, string])],
        picked,
      ]),
      setFolderApp,
    );
    folders.append(sectionTitle("Open folders in", Folder), foldersIntro, folderOptions);

    content.append(files, folders);
    return fileOptions;
  }

  /** Called with the new font while the Appearance page shows it, to keep its fields current. */
  private syncFont: ((f: ReturnType<typeof currentFont>) => void) | null = null;

  private buildFont() {
    const section = el("section", "page-section");
    const intro = el("p", "page-intro");
    intro.append("The text in every terminal. ", kbdFor("zoomIn"), " and ", kbdFor("zoomOut"), " change the size from anywhere, and ", kbdFor("resetZoom"), " puts it back.");

    const font = currentFont();
    const field = (label: string, control: HTMLElement) => {
      const row = el("label", "font-field");
      row.append(el("span", "font-label", label), control);
      return row;
    };

    const family = el("input", "font-input font-family");
    family.value = font.family;
    family.placeholder = DEFAULT_FONT.family;
    family.spellcheck = false;
    family.autocomplete = "off";
    const options = el("datalist", "");
    options.id = "font-families";
    for (const name of SUGGESTED_FAMILIES) {
      const option = el("option", "");
      option.value = name;
      options.append(option);
    }
    family.setAttribute("list", options.id);
    family.addEventListener("input", () => setFont({ family: family.value }));
    // An emptied box means the default, so show it.
    family.addEventListener("blur", () => {
      if (!family.value.trim()) {
        family.value = DEFAULT_FONT.family;
        setFont({ family: DEFAULT_FONT.family });
      }
    });

    /** A number box that applies values in range as typed, and shows the applied value once left. */
    const number = (key: "size" | "lineHeight", min: number, max: number, step: number) => {
      const input = el("input", "font-input font-number");
      input.type = "number";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(font[key]);
      input.addEventListener("input", () => {
        const n = parseFloat(input.value);
        if (Number.isFinite(n) && n >= min && n <= max) setFont({ [key]: n });
      });
      input.addEventListener("blur", () => (input.value = String(currentFont()[key])));
      return input;
    };
    const size = number("size", MIN_SIZE, MAX_SIZE, 1);
    const lineHeight = number("lineHeight", MIN_LINE_HEIGHT, MAX_LINE_HEIGHT, 0.05);

    const preview = el("div", "font-preview");
    const paint = (f: ReturnType<typeof currentFont>) => {
      preview.style.fontFamily = fontStack(f);
      preview.style.fontSize = `${f.size}px`;
      preview.style.lineHeight = String(f.lineHeight);
    };
    preview.append(el("div", "", "~/desk ❯ git log --oneline -2"), el("div", "", "a1b2c3d Fix {}[]() => != 0O 1lI"), el("div", "", "e4f5a6b Add find-in-terminal"));
    paint(font);

    const reset = el("button", "macro-add");
    reset.append(icon(RotateCcw, 13), "Reset font");
    reset.addEventListener("click", () => setFont(DEFAULT_FONT));

    this.syncFont = (f) => {
      if (!family.isConnected) return;
      if (document.activeElement !== family) family.value = f.family;
      if (document.activeElement !== size) size.value = String(f.size);
      if (document.activeElement !== lineHeight) lineHeight.value = String(f.lineHeight);
      paint(f);
    };

    const fields = el("div", "font-fields");
    fields.append(field("Font", family), field("Size", size), field("Line height", lineHeight), options);
    section.append(sectionTitle("Font", Type), intro, fields, preview, reset);
    return section;
  }

  private buildMonitor() {
    const section = el("section", "page-section");
    const intro = el("p", "page-intro", `How many of each pane's latest screen lines its Agent Monitor card shows, with two older ones fading out above them. ${DEFAULT_LOG_LINES} by default.`);
    const input = el("input", "font-input font-number");
    input.type = "number";
    input.min = String(MIN_LOG_LINES);
    input.max = String(MAX_LOG_LINES);
    input.step = "1";
    input.value = String(logLines());
    input.addEventListener("input", () => {
      const n = parseInt(input.value, 10);
      if (n >= MIN_LOG_LINES && n <= MAX_LOG_LINES) setLogLines(n);
    });
    input.addEventListener("blur", () => (input.value = String(logLines())));
    const field = el("label", "font-field monitor-lines-field");
    field.append(el("span", "font-label", "Log lines"), input);
    section.append(sectionTitle("Agent Monitor", Radar), intro, field);
    return section;
  }

  private buildAppIcon() {
    const section = el("section", "page-section");
    const intro = el("p", "page-intro", "The icon Workdesk shows in the Dock while it runs. Finder and Launchpad keep the classic one.");
    const row = el("div", "app-icon-grid");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "App icon");
    const picked = currentAppIcon();
    for (const [id, name] of APP_ICONS) {
      const b = el("button", "app-icon-option");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(id === picked));
      const img = el("img", "");
      img.src = appIconUrl(id);
      img.alt = "";
      img.draggable = false;
      b.append(img, el("span", "app-icon-name", name));
      b.addEventListener("click", () => {
        setAppIcon(id);
        for (const other of row.children) other.setAttribute("aria-checked", String(other === b));
      });
      row.append(b);
    }
    section.append(sectionTitle("App icon", AppWindow), intro, row);
    return section;
  }

  private buildDefaultColor() {
    const section = el("section", "page-section");
    const intro = el("p", "page-intro", "New tabs and tab groups start in this color, and you can change either from its right-click menu. Each theme tunes all nine to suit it, and its accent is always one of them.");
    const row = el("div", "group-color-swatches");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "Default color");
    const picked = defaultColor();
    for (const c of GROUP_COLOR_NAMES) {
      const b = el("button", "swatch");
      b.style.setProperty("--swatch", `var(--group-${c})`);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(c === picked));
      b.setAttribute("aria-label", c);
      b.title = c[0].toUpperCase() + c.slice(1);
      b.addEventListener("click", () => {
        setDefaultColor(c);
        for (const other of row.children) other.setAttribute("aria-checked", String(other === b));
      });
      row.append(b);
    }
    section.append(sectionTitle("Default color", Layers), intro, row);
    return section;
  }

  private buildFavorites() {
    this.favorites = loadFavorites();
    const section = el("section", "page-section");
    const intro = el("p", "page-intro");
    intro.append(
      "Teleport lists these folders first, and ranks them above everything else as you type. Press ",
      kbd("mod+d"),
      " in Teleport to star or unstar the highlighted folder.",
    );
    this.favList = el("div", "fav-list");
    const add = el("button", "macro-add");
    add.append(icon(Plus), "New favorite");
    add.addEventListener("click", () => {
      this.favorites.push("");
      this.saveFavorites();
      this.renderFavorites();
      this.favList.querySelector<HTMLInputElement>(".fav:last-child .fav-path")?.focus();
    });
    section.append(sectionTitle("Favorite destinations", Star), intro, this.favList, add);
    return section;
  }

  private buildThemes() {
    const section = el("section", "page-section");
    const intro = el(
      "p",
      "page-intro",
      `${THEMES.length} themes for the terminals and the app around them: Workdesk originals, then popular schemes. Click one to switch.`,
    );

    const bar = el("div", "theme-bar");
    const search = el("label", "theme-search");
    const input = el("input", "");
    input.type = "search";
    input.placeholder = "Search themes";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search themes");
    input.addEventListener("input", () => {
      this.themeQuery = input.value.trim().toLowerCase();
      this.renderThemes();
    });
    search.append(icon(Search, 13), input);

    const filters = el("div", "theme-filters");
    filters.setAttribute("role", "radiogroup");
    filters.setAttribute("aria-label", "Show");
    for (const [value, label] of THEME_FILTERS) {
      const b = el("button", "theme-filter", label);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(value === this.themeFilter));
      b.addEventListener("click", () => {
        this.themeFilter = value;
        for (const other of filters.children) other.setAttribute("aria-checked", String(other === b));
        this.renderThemes();
      });
      filters.append(b);
    }
    this.themeCount = el("span", "theme-count");
    bar.append(search, filters, this.themeCount);

    this.themeGrid = el("div", "theme-grid");
    section.append(sectionTitle("Theme", Palette), intro, bar, this.themeGrid);
    this.renderThemes();
    return section;
  }

  private renderThemes() {
    const active = currentTheme();
    const shown = THEMES.filter((t) => {
      if (this.themeQuery && !t.name.toLowerCase().includes(this.themeQuery)) return false;
      if (this.themeFilter === "dark") return !t.light;
      if (this.themeFilter === "light") return t.light;
      if (this.themeFilter === "originals") return t.original;
      return true;
    });
    this.themeCount.textContent = shown.length === THEMES.length ? "" : `${shown.length} of ${THEMES.length}`;
    const cards: HTMLElement[] = shown.map((t) => {
      const card = themeCard(t, t === active);
      card.addEventListener("click", () => {
        setTheme(t);
        for (const c of this.themeGrid.querySelectorAll(".theme-card.active")) c.classList.remove("active");
        for (const c of this.themeGrid.querySelectorAll("[aria-pressed]")) c.setAttribute("aria-pressed", "false");
        card.classList.add("active");
        card.setAttribute("aria-pressed", "true");
      });
      return card;
    });
    if (cards.length === 0) cards.push(el("p", "macro-empty", "No themes match."));
    this.themeGrid.replaceChildren(...cards);
  }

  private saveFavorites() {
    saveFavorites(this.favorites);
  }

  private renderFavorites() {
    const rows = this.favorites.map((path, i) => {
      const row = el("div", "fav");
      const input = el("input", "fav-path");
      input.value = tildePath(path);
      input.placeholder = "~/Projects/something";
      input.spellcheck = false;
      input.autocomplete = "off";
      input.setAttribute("aria-label", "Favorite folder");
      input.addEventListener("input", () => {
        this.favorites[i] = normalizePath(input.value);
        this.saveFavorites();
        void this.validateFavorites();
      });
      // Show the cleaned path once editing is done, not mid-keystroke.
      input.addEventListener("blur", () => (input.value = tildePath(this.favorites[i] ?? "")));
      const remove = el("button", "macro-remove");
      remove.append(icon(Trash2));
      remove.title = "Remove favorite";
      remove.setAttribute("aria-label", `Remove ${tildePath(path) || "favorite"}`);
      remove.addEventListener("click", () => {
        this.favorites.splice(i, 1);
        this.saveFavorites();
        this.renderFavorites();
      });
      row.append(icon(Star, 14, "fav-star"), input, remove, el("p", "macro-note"));
      attachPathSuggest(input);
      return row;
    });
    if (rows.length === 0) {
      rows.push(el("p", "macro-empty", "No favorites yet. Add a folder here, or star one in Teleport."));
    }
    this.favList.replaceChildren(...rows);
    void this.validateFavorites();
  }

  /** Flags favorites Teleport would skip or can't open. */
  private async validateFavorites() {
    const seq = ++this.favSeq;
    const paths = this.favorites.filter(Boolean);
    const existing = new Set(await invoke<string[]>("existing_dirs", { paths }).catch(() => paths));
    if (seq !== this.favSeq) return;
    const rows = this.favList.querySelectorAll<HTMLElement>(".fav");
    this.favorites.forEach((path, i) => {
      const row = rows[i];
      const note = row?.querySelector(".macro-note");
      if (!row || !note) return;
      let msg = "";
      if (!path) msg = "Enter a folder path.";
      else if (this.favorites.indexOf(path) !== i) msg = "Already a favorite above.";
      else if (!existing.has(path)) msg = "No folder at this path.";
      note.textContent = msg;
      row.classList.toggle("invalid", msg !== "");
    });
  }

  private save() {
    saveMacros(this.macros);
  }

  private render() {
    const rows = this.macros.map((macro, i) => {
      const card = el("div", "macro");

      const head = el("label", "macro-head");
      const name = el("input", "macro-name");
      name.value = macro.name;
      name.placeholder = "name";
      name.spellcheck = false;
      name.autocomplete = "off";
      name.setAttribute("aria-label", "Macro name");
      const remove = el("button", "macro-remove");
      remove.append(icon(Trash2));
      remove.title = "Delete macro";
      remove.setAttribute("aria-label", `Delete @${macro.name || "macro"}`);
      remove.addEventListener("click", () => {
        this.macros.splice(i, 1);
        this.save();
        this.render();
      });
      head.append(el("span", "macro-at", "@"), name, remove);

      const body = el("div", "macro-body");
      const gutter = el("div", "macro-gutter");
      gutter.setAttribute("aria-hidden", "true");
      const commands = el("textarea", "macro-commands");
      commands.value = macro.commands.join("\n");
      commands.placeholder = "claude";
      commands.spellcheck = false;
      commands.wrap = "off";
      commands.setAttribute("aria-label", `Commands for @${macro.name || "macro"}, one per line`);
      const sync = () => {
        const lines = commands.value.split("\n").length;
        if (gutter.childElementCount !== lines) gutter.replaceChildren(...gutterPrompts(lines));
        // Sized by line count so the box is exactly as tall as the gutter.
        commands.style.setProperty("--lines", String(lines));
      };
      sync();
      body.append(gutter, commands);
      // Clicking the gutter or padding lands in the commands.
      body.addEventListener("mousedown", (e) => {
        if (e.target === commands) return;
        e.preventDefault();
        commands.focus();
      });

      const note = el("p", "macro-note");

      name.addEventListener("input", () => {
        macro.name = cleanName(name.value);
        this.save();
        this.validate();
      });
      // Show the cleaned name once editing is done, not mid-keystroke.
      name.addEventListener("blur", () => (name.value = macro.name));
      commands.addEventListener("input", () => {
        macro.commands = commands.value.split("\n");
        sync();
        this.save();
        this.validate();
      });

      card.append(head, body, note);
      return card;
    });
    if (rows.length === 0) {
      rows.push(el("p", "macro-empty", "No macros yet. Add one to run commands every time Teleport opens a tab."));
    }
    this.list.replaceChildren(...rows);
    this.validate();
  }

  /** Flags macros Teleport would ignore. */
  private validate() {
    const cards = this.list.querySelectorAll<HTMLElement>(".macro");
    this.macros.forEach((macro, i) => {
      const card = cards[i];
      const note = card?.querySelector(".macro-note");
      if (!card || !note) return;
      let msg = "";
      if (!macro.name) msg = "Name this macro to use it in Teleport.";
      else if (this.macros.findIndex((m) => m.name === macro.name) !== i)
        msg = `Teleport uses the first @${macro.name} above. Rename this one to use it.`;
      else if (!macro.commands.some((c) => c.trim())) msg = "Add a command for Teleport to run.";
      note.textContent = msg;
      card.classList.toggle("invalid", msg !== "");
    });
  }
}

/**
 * One ticket service in Settings: whether it's connected and as whom, a box
 * to paste a token into, and Disconnect.
 */
function integrationCard(p: (typeof PROVIDERS)[number]) {
  const card = el("div", "integration");
  const logo = el("span", "integration-logo");
  logo.innerHTML = providerLogo(p.id, 20);
  const name = el("div", "integration-name", p.name);
  const status = el("div", "integration-status");
  const head = el("div", "integration-head");
  const text = el("div", "integration-text");
  text.append(name, status);
  const disconnect = el("button", "integration-disconnect", "Disconnect");
  head.append(logo, text, disconnect);

  const form = el("form", "integration-form");
  const input = el("input", "integration-token");
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = `Paste a ${p.name} token`;
  input.setAttribute("aria-label", `${p.name} token`);
  const connect = el("button", "integration-connect", "Connect");
  connect.type = "submit";
  form.append(input, connect);
  const help = el("p", "integration-help");
  const link = el("a", "", "Create a token");
  link.href = p.tokenUrl;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    void openUrl(p.tokenUrl);
  });
  help.append(p.tokenHelp, " ", link, ".");
  const error = el("p", "integration-error");
  card.append(head, form, help, error);

  /** Shows `source`'s state, looking up whose account it is when connected. */
  const show = (source: TokenSource, who?: string) => {
    card.classList.toggle("connected", source != null);
    disconnect.hidden = source !== "keychain";
    error.textContent = "";
    const label = (name?: string) =>
      source === "gh" ? `Using your gh login${name ? ` (${name})` : ""}` : source ? `Connected${name ? ` as ${name}` : ""}` : "Not connected";
    status.textContent = label(who);
    // A gh login works without a token, but a pasted one takes over.
    input.placeholder = source === "keychain" ? "Paste a new token to replace it" : `Paste a ${p.name} token`;
    if (source && !who) void ticketsApi.whoami(p.id).then((n) => n && (status.textContent = label(n)), () => {});
  };
  void ticketsApi.accounts().then((all) => show(all.find((a) => a.provider === p.id)?.source ?? null), () => show(null));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    connect.disabled = true;
    connect.textContent = "Checking…";
    ticketsApi.connect(p.id, input.value).then(
      (who) => {
        input.value = "";
        show("keychain", who);
        void ticketStore.refresh();
      },
      (err) => (error.textContent = String(err)),
    ).finally(() => {
      connect.disabled = false;
      connect.textContent = "Connect";
    });
  });
  disconnect.addEventListener("click", () => {
    void ticketsApi.disconnect(p.id).then(async () => {
      const all = await ticketsApi.accounts().catch(() => []);
      show(all.find((a) => a.provider === p.id)?.source ?? null);
      void ticketStore.refresh();
    });
  });
  return { card, input };
}
