import { invoke } from "@tauri-apps/api/core";
import type { Workspace } from "./workspace";

/** Backslash-escapes the characters a shell would split or expand, as Terminal.app does for dropped files. */
function shellEscape(path: string): string {
  return path.replace(/[^A-Za-z0-9_\-.,:+@%/=~]/g, "\\$&");
}

/**
 * Dropping files (or text, or a link) from outside onto a pane pastes them into
 * it, the way a terminal does: paths shell-escaped and space-separated, so
 * Claude Code attaches dropped images. Without this the webview navigates to
 * the dropped file and the app is gone. The webview never says where a dropped
 * file lives, so each one is saved to a temp folder and that path is pasted.
 */
export function installFileDrop(ws: Workspace) {
  const external = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    return types.includes("Files") || types.includes("text/uri-list");
  };

  window.addEventListener("dragover", (e) => {
    if (!external(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  });

  window.addEventListener("drop", (e) => {
    if (!external(e) || e.defaultPrevented) return;
    e.preventDefault();
    const tab = ws.activeTab;
    if (!tab) return;
    const session =
      tab.sessions.find((s) => {
        const r = s.pane.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      }) ?? tab.session;

    const dt = e.dataTransfer!;
    const files = [...dt.files];
    const text = dt.getData("text/uri-list").split(/\r?\n/).filter((l) => l && !l.startsWith("#")).join(" ");
    void (async () => {
      let paste: string;
      if (files.length > 0) {
        const paths = await Promise.all(
          files.map(async (f) =>
            invoke<string>("save_drop", new Uint8Array(await f.arrayBuffer()), {
              headers: { "x-name": encodeURIComponent(f.name) },
            }),
          ),
        ).catch((err) => {
          session.term.write(`\r\n\x1b[31mCouldn't take dropped file: ${err}\x1b[0m\r\n`);
          return null;
        });
        if (!paths) return;
        paste = paths.map(shellEscape).join(" ");
      } else if (text) {
        paste = text;
      } else return;
      session.focus();
      session.term.paste(paste + " ");
    })();
  });
}
