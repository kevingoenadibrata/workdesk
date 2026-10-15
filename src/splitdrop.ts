import type { Direction, Workspace } from "./workspace";

/**
 * Dropping a sidebar tab onto a pane splits the active tab there, and dropping
 * a pane's header onto another pane moves it there: the half of the pane
 * nearest the cursor shows where it will go.
 */
export function installSplitDrop(host: HTMLElement, ws: Workspace, dragging: () => readonly number[] | null) {
  const marker = document.createElement("div");
  marker.className = "split-marker";
  const hide = () => marker.remove();

  function locate(e: DragEvent) {
    const ids = dragging();
    const pane = ws.paneDrag;
    const tab = ws.activeTab;
    if (!tab || (!pane && (!ids || ids.length !== 1))) return null;
    const session = tab.sessions.find((s) => {
      const r = s.pane.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    });
    if (!session) return null;

    // Nearest edge, measured relative to the pane's size.
    const r = session.pane.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const horizontal: Direction = x < 0.5 ? "left" : "right";
    const vertical: Direction = y < 0.5 ? "up" : "down";
    const preferHorizontal = Math.min(x, 1 - x) <= Math.min(y, 1 - y);
    const [preferred, fallback] = preferHorizontal ? [horizontal, vertical] : [vertical, horizontal];
    const side = pane
      ? ws.paneDropSide(pane, session, preferred, fallback)
      : ws.dropSide(ids![0], session, preferred, fallback);
    return side ? { session, side, pane, sourceId: ids?.[0] } : null;
  }

  host.addEventListener("dragover", (e) => {
    const hit = locate(e);
    if (!hit) return hide();
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";

    const pane = hit.session.pane.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    const half = { left: 0, top: 0, width: pane.width, height: pane.height };
    if (hit.side === "left" || hit.side === "right") half.width /= 2;
    else half.height /= 2;
    if (hit.side === "right") half.left = pane.width / 2;
    if (hit.side === "down") half.top = pane.height / 2;
    Object.assign(marker.style, {
      left: `${pane.left - box.left + half.left}px`,
      top: `${pane.top - box.top + half.top}px`,
      width: `${half.width}px`,
      height: `${half.height}px`,
    });
    if (!marker.isConnected) host.append(marker);
  });

  host.addEventListener("dragleave", (e) => {
    if (!host.contains(e.relatedTarget as Node | null)) hide();
  });

  host.addEventListener("drop", (e) => {
    const hit = locate(e);
    hide();
    if (!hit) return;
    e.preventDefault();
    if (hit.pane) ws.movePane(hit.pane, hit.session, hit.side);
    else ws.splitWithTab(hit.sourceId!, hit.session, hit.side);
  });

  window.addEventListener("dragend", hide);
}
