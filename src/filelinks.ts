import { invoke } from "@tauri-apps/api/core";
import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

/** Editors a file can open in at a line, as Settings lists them. "system" is the file's default app. */
export const EDITORS = [
  ["vscode", "VS Code"],
  ["cursor", "Cursor"],
  ["windsurf", "Windsurf"],
  ["zed", "Zed"],
  ["sublime", "Sublime Text"],
  ["xcode", "Xcode"],
  ["system", "Default app"],
] as const;
export type Editor = (typeof EDITORS)[number][0];

const KEY = "workdesk.editor";

let installed: Promise<Editor[]> | null = null;

/** Editors installed on this Mac, then "system", which always is. */
export function installedEditors(): Promise<Editor[]> {
  installed ??= invoke<Editor[]>("installed_editors")
    .catch(() => [] as Editor[])
    .then((ids) => [...ids, "system"]);
  return installed;
}

/** The editor files open in: the one picked in Settings, else the first installed code editor. */
export async function currentEditor(): Promise<Editor> {
  const have = await installedEditors();
  try {
    const saved = localStorage.getItem(KEY) as Editor | null;
    if (saved && have.includes(saved)) return saved;
  } catch {
    // Fall through to the first.
  }
  return have.find((e) => e !== "xcode") ?? "system";
}

export function setEditor(editor: Editor) {
  try {
    localStorage.setItem(KEY, editor);
  } catch {
    // Not remembered past this session.
  }
}

/** Where folders open: Finder, or an editor as a project. */
export type FolderApp = Exclude<Editor, "system"> | "finder";
const FOLDER_KEY = "workdesk.folderApp";

/** The app folders open in: the one picked in Settings if still installed, else Finder. */
export async function currentFolderApp(): Promise<FolderApp> {
  const have = await installedEditors();
  try {
    const saved = localStorage.getItem(FOLDER_KEY) as FolderApp | null;
    if (saved && saved !== "finder" && have.includes(saved)) return saved;
  } catch {
    // Finder it is.
  }
  return "finder";
}

export function setFolderApp(app: FolderApp) {
  try {
    localStorage.setItem(FOLDER_KEY, app);
  } catch {
    // Not remembered past this session.
  }
}

/**
 * A path-like run of characters, then where in the file it points, if anywhere:
 * `:12`, `:12:5`, `(12,5)` from tsc, or `", line 12` from Python tracebacks.
 */
const CANDIDATE = /[^\s:'"`()<>[\]{},;|]+/g;
const POSITION = /^(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s?(\d+))?\)|", line (\d+))/;

/** Whether `token` could be a file path worth asking the backend about. */
function pathLike(token: string) {
  if (token.length < 3 || /^[\d.]+$/.test(token)) return false;
  return token.includes("/") || /\.[A-Za-z][\w]{0,9}$/.test(token);
}

/** Resolved paths by folder and text, so hovering the same output doesn't ask again. Forgotten after a while in case files appear. */
type Resolved = { path: string; dir: boolean };
const cache = new Map<string, { at: number; found: Resolved | null }>();
const CACHE_MS = 5000;

async function resolve(cwd: string, tokens: string[]): Promise<(Resolved | null)[]> {
  const now = Date.now();
  const missing = [...new Set(tokens.filter((t) => (cache.get(cwd + "\0" + t)?.at ?? 0) < now - CACHE_MS))];
  if (missing.length) {
    const found = await invoke<(Resolved | null)[]>("resolve_files", { cwd, paths: missing }).catch(() => missing.map(() => null));
    missing.forEach((t, i) => cache.set(cwd + "\0" + t, { at: now, found: found[i] }));
  }
  return tokens.map((t) => cache.get(cwd + "\0" + t)?.found ?? null);
}

/** Lines a soft-wrapped row belongs to, joined, with the first one's row (1-based). */
function logicalLine(term: Terminal, y: number) {
  const buf = term.buffer.active;
  let start = y - 1;
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  const rows: IBufferLine[] = [];
  for (let i = start; ; i++) {
    const line = buf.getLine(i);
    if (!line || (i > start && !line.isWrapped)) break;
    rows.push(line);
  }
  // Every row but the last is full width, so offsets map straight back to cells.
  const text = rows.map((r, i) => r.translateToString(i === rows.length - 1)).join("");
  return { text, firstRow: start + 1 };
}

/**
 * Makes file and folder paths in `term`'s output ⌘-clickable, opening them in the editor
 * from Settings at the line they name. `cwd` gives the folder relative paths
 * are in, which is the pane's current one.
 */
export function fileLinkProvider(term: Terminal, cwd: () => string): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const { text, firstRow } = logicalLine(term, y);
      const cols = term.cols;
      const found: { token: string; tries: string[]; start: number; end: number; line?: number; col?: number }[] = [];
      for (const m of text.matchAll(CANDIDATE)) {
        const token = m[0].replace(/\.+$/, "");
        const start = m.index;
        // Web links are the web links addon's; a URL's colon leaves its rest starting "//".
        if (token.startsWith("//") || !pathLike(token)) continue;
        const after = text.slice(start + token.length);
        const pos = POSITION.exec(after);
        const line = pos ? Number(pos[1] ?? pos[3] ?? pos[5]) : undefined;
        const col = pos && (pos[2] ?? pos[4]) ? Number(pos[2] ?? pos[4]) : undefined;
        // `", line 12` isn't part of the link, just where it points.
        const suffix = pos && pos[5] == null ? pos[0].length : 0;
        // git diffs prefix paths with a/ and b/.
        const tries = /^[ab]\//.test(token) ? [token, token.slice(2)] : [token];
        found.push({ token, tries, start, end: start + token.length + suffix, line, col });
        if (found.length >= 30) break;
      }
      if (found.length === 0) return callback(undefined);

      const dir = cwd();
      void resolve(dir, found.flatMap((f) => f.tries)).then((paths) => {
        let i = 0;
        const links: ILink[] = [];
        for (const f of found) {
          const target = f.tries.map(() => paths[i++]).find((p) => p != null);
          if (!target) continue;
          const { path, dir } = target;
          const startRow = firstRow + Math.floor(f.start / cols);
          const endRow = firstRow + Math.floor((f.end - 1) / cols);
          // Only the links that touch the row asked about.
          if (y < startRow || y > endRow) continue;
          links.push({
            range: {
              start: { x: (f.start % cols) + 1, y: startRow },
              end: { x: ((f.end - 1) % cols) + 1, y: endRow },
            },
            text: text.slice(f.start, f.end),
            decorations: { underline: true, pointerCursor: true },
            hover() {
              void (dir ? currentFolderApp() : currentEditor()).then((app) => {
                const name = app === "finder" ? "Finder" : EDITORS.find(([id]) => id === app)![1];
                if (term.element) term.element.title = `⌘-click to open in ${name}`;
              });
            },
            leave() {
              term.element?.removeAttribute("title");
            },
            activate(event) {
              if (!event.metaKey) return;
              void Promise.all([currentEditor(), currentFolderApp()]).then(([editor, folderApp]) =>
                invoke("open_in_editor", { editor, folderApp, path, line: f.line ?? null, col: f.col ?? null }),
              );
            },
          });
        }
        callback(links.length ? links : undefined);
      });
    },
  };
}
