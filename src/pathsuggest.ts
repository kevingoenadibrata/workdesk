import { invoke } from "@tauri-apps/api/core";
import { normalizePath, tildePath } from "./favorites";
import { homeDir } from "./recents";
import { Folder, icon } from "./icons";
import { el } from "./page";

const MAX_SUGGESTIONS = 8;

/**
 * Folder autocomplete under a path input, like Teleport's browsing: it lists
 * the folders matching what's typed after the last "/" (plain text searches
 * ~). ↑/↓ highlight, Tab completes into the highlighted folder so its
 * subfolders show next, Enter takes it, Esc dismisses. Completing fires an
 * "input" event so the field's own listeners save it.
 */
export function attachPathSuggest(input: HTMLInputElement) {
  const list = el("div", "path-suggest");
  list.hidden = true;
  input.after(list);

  let paths: string[] = [];
  let selected = 0;
  /** Bumped per lookup so a slow listing can't overwrite newer results. */
  let seq = 0;

  const close = () => {
    seq++;
    paths = [];
    list.hidden = true;
  };

  const render = () => {
    list.hidden = paths.length === 0;
    list.replaceChildren(
      ...paths.map((path, i) => {
        const row = el("div", `path-suggest-item${i === selected ? " selected" : ""}`);
        row.append(icon(Folder, 13), tildePath(path));
        row.addEventListener("mousemove", () => {
          if (selected === i) return;
          selected = i;
          render();
        });
        row.addEventListener("click", () => {
          selected = i;
          accept(true);
        });
        return row;
      }),
    );
    list.children[selected]?.scrollIntoView({ block: "nearest" });
  };

  const refresh = async () => {
    const id = ++seq;
    const home = homeDir();
    const raw = input.value.trim();
    // Bare text searches ~, like Teleport.
    const full = raw.includes("/") ? normalizeKeepSlash(raw) : `${home}/${raw === "~" ? "" : raw}`;
    const slash = full.lastIndexOf("/");
    const dir = full.slice(0, slash) || "/";
    const partial = full.slice(slash + 1).toLowerCase();
    const names = await invoke<string[]>("list_dirs", { path: dir, hidden: partial.startsWith(".") }).catch(() => []);
    if (id !== seq || document.activeElement !== input) return;
    const starts = names.filter((n) => n.toLowerCase().startsWith(partial));
    const contains = names.filter((n) => !n.toLowerCase().startsWith(partial) && n.toLowerCase().includes(partial));
    paths = [...starts, ...contains].slice(0, MAX_SUGGESTIONS).map((n) => (dir === "/" ? `/${n}` : `${dir}/${n}`));
    selected = 0;
    render();
  };

  /** Fills in the highlighted folder; `descend` keeps going into it. */
  const accept = (descend: boolean) => {
    const path = paths[selected];
    if (!path) return;
    const label = tildePath(path);
    input.value = descend ? `${label}/` : label;
    input.dispatchEvent(new Event("input"));
    if (!descend) close();
  };

  input.addEventListener("input", () => void refresh());
  input.addEventListener("focus", () => void refresh());
  input.addEventListener("blur", close);
  // Keep focus in the input while clicking suggestions.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") selected = (selected + 1) % paths.length;
    else if (e.key === "ArrowUp") selected = (selected - 1 + paths.length) % paths.length;
    else if (e.key === "Tab" && !e.shiftKey) accept(true);
    else if (e.key === "Enter") accept(false);
    else if (e.key === "Escape") close();
    else return;
    // Esc would otherwise leave the page, Tab move focus.
    e.preventDefault();
    e.stopPropagation();
    if (!list.hidden) render();
  });
}

/** `normalizePath` drops the trailing "/", which here means "list inside". */
function normalizeKeepSlash(raw: string) {
  const path = normalizePath(raw);
  return raw.endsWith("/") && path !== "/" ? `${path}/` : path;
}
