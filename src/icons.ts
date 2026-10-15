import { createElement, type IconNode } from "lucide";

export {
  AppWindow,
  ArrowDown,
  ArrowUp,
  AtSign,
  CaseSensitive,
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileCode,
  Folder,
  FolderOpen,
  History,
  Keyboard,
  Layers,
  House,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  Palette,
  Plus,
  Radar,
  RotateCcw,
  Rows2,
  Search,
  Settings,
  Shell,
  Star,
  Terminal,
  Trash2,
  Type,
  X,
} from "lucide";

/** A Lucide icon as an inline SVG, sized in px and coloured by `currentColor`. */
export function icon(node: IconNode, size = 14, className = ""): SVGElement {
  const svg = createElement(node);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  if (className) svg.classList.add(...className.split(/\s+/).filter(Boolean));
  return svg;
}
