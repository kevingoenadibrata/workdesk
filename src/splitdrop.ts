import type { Direction, DropPlan, DropTarget, Workspace } from "./workspace";
import type { TermSession } from "./terminal";

/** How close to a gap between panes (or the tab's outer edge) counts as dropping into it, in px. */
const SEAM = 24;
/** How far in from a pane's edge counts as dropping on that edge: a share of its size, capped in px. */
const EDGE_SHARE = 0.3;
const EDGE_MAX = 180;

/**
 * Dropping a sidebar tab onto the panes splits the active tab there, and
 * dropping a pane's header moves it there. Near a gap between panes it slots
 * in with an even share; near a pane's edge it splits that pane; on a pane's
 * middle a dragged pane swaps with it. While dragging, the tab shows the
 * layout the drop will produce, worked out by the same plan the drop applies.
 */
export function installSplitDrop(host: HTMLElement, ws: Workspace, dragging: () => readonly number[] | null) {
  const overlay = document.createElement("div");
  overlay.className = "drop-preview";
  // One ghost per pane, kept across dragover events so they glide between layouts.
  const ghosts = new Map<TermSession, HTMLElement>();
  let dimmed: TermSession | null = null;

  const hide = () => {
    overlay.remove();
    for (const g of ghosts.values()) g.remove();
    ghosts.clear();
    dimmed?.pane.classList.remove("drag-source");
    dimmed = null;
  };

  function locate(e: DragEvent): { source: TermSession; target: DropTarget; plan: DropPlan } | null {
    const tab = ws.activeTab;
    const source = ws.dropSource(dragging());
    if (!tab || !source) return null;
    const box = tab.el.getBoundingClientRect();
    const { clientX: x, clientY: y } = e;
    if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return null;
    const plan = (target: DropTarget) => {
      const p = ws.planDrop(source, target);
      return p ? { source, target, plan: p } : null;
    };

    // Gaps between columns, and the tab's left and right edges.
    const cols = tab.columns.map((c) => c[0].pane.parentElement!.getBoundingClientRect());
    const colSeams = [box.left, ...cols.slice(1).map((r) => r.left), box.right];
    const colSeam = colSeams.findIndex((sx) => Math.abs(x - sx) <= SEAM);
    // A gap that's full falls through to the pane under the cursor.
    const between = colSeam >= 0 ? plan({ kind: "col", index: colSeam }) : null;
    if (between) return between;

    const col = cols.findIndex((r) => x >= r.left && x < r.right);
    if (col < 0) return null;
    // Gaps between the panes of a column, and its top and bottom edges.
    const rows = tab.columns[col].map((s) => s.pane.getBoundingClientRect());
    const rowSeams = [box.top, ...rows.slice(1).map((r) => r.top), box.bottom];
    const rowSeam = rowSeams.findIndex((sy) => Math.abs(y - sy) <= SEAM);
    const stacked = rowSeam >= 0 ? plan({ kind: "row", col, index: rowSeam }) : null;
    if (stacked) return stacked;

    const row = rows.findIndex((r) => y >= r.top && y < r.bottom);
    if (row < 0) return null;
    const target = tab.columns[col][row];
    const r = rows[row];
    const band = (size: number) => Math.min(size * EDGE_SHARE, EDGE_MAX);
    // Distance to each edge as a share of its band; under 1 means inside it.
    const near: [Direction, number][] = [
      ["left", (x - r.left) / band(r.width)],
      ["right", (r.right - x) / band(r.width)],
      ["up", (y - r.top) / band(r.height)],
      ["down", (r.bottom - y) / band(r.height)],
    ];
    near.sort((a, b) => a[1] - b[1]);
    const [side, dist] = near[0];
    if (dist >= 1) return source === target ? null : plan({ kind: "swap", target });
    if (target === source) return null;
    // When that edge is full, the nearest edge on the other axis.
    const across = near.find(([d]) => (d === "left" || d === "right") !== (side === "left" || side === "right"))![0];
    return plan({ kind: "edge", target, side }) ?? plan({ kind: "edge", target, side: across });
  }

  function show(source: TermSession, plan: DropPlan) {
    const tab = ws.activeTab!;
    const box = tab.el.getBoundingClientRect();
    const origin = host.getBoundingClientRect();
    if (!overlay.isConnected) host.append(overlay);
    Object.assign(overlay.style, {
      left: `${box.left - origin.left}px`,
      top: `${box.top - origin.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });

    if (dimmed !== source) {
      dimmed?.pane.classList.remove("drag-source");
      dimmed = tab.sessions.includes(source) ? source : null;
      dimmed?.pane.classList.add("drag-source");
    }

    const seen = new Set<TermSession>();
    const totalW = plan.reduce((n, c) => n + c.w, 0);
    let left = 0;
    for (const c of plan) {
      const width = (c.w / totalW) * box.width;
      const totalH = c.rows.reduce((n, r) => n + r.w, 0);
      let top = 0;
      for (const r of c.rows) {
        const height = (r.w / totalH) * box.height;
        let ghost = ghosts.get(r.s);
        if (!ghost) {
          ghost = document.createElement("div");
          ghost.className = "drop-ghost";
          ghost.classList.toggle("new", r.s === source);
          if (r.s === source) ghost.textContent = source.title;
          ghosts.set(r.s, ghost);
          // Start where the pane is now (or, for a new one, where it's headed) so it animates from there.
          const from = tab.sessions.includes(r.s) ? r.s.pane.getBoundingClientRect() : null;
          place(ghost, from ? from.left - box.left : left, from ? from.top - box.top : top, from?.width ?? width, from?.height ?? height);
          overlay.append(ghost);
          void ghost.offsetWidth;
        }
        place(ghost, left, top, width, height);
        seen.add(r.s);
        top += height;
      }
      left += width;
    }
    for (const [s, g] of ghosts) if (!seen.has(s)) (g.remove(), ghosts.delete(s));
  }

  function place(el: HTMLElement, left: number, top: number, width: number, height: number) {
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  host.addEventListener("dragover", (e) => {
    const hit = locate(e);
    // Not a drop that would change anything: show nothing, and refuse it.
    if (!hit) return hide();
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    show(hit.source, hit.plan);
  });

  host.addEventListener("dragleave", (e) => {
    if (!host.contains(e.relatedTarget as Node | null)) hide();
  });

  host.addEventListener("drop", (e) => {
    const hit = locate(e);
    hide();
    if (!hit) return;
    e.preventDefault();
    ws.drop(hit.source, hit.target);
  });

  window.addEventListener("dragend", hide);
}
