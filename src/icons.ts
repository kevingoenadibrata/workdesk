import { createElement, type IconNode } from "lucide";

export {
  AppWindow,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  AtSign,
  CaseSensitive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  EthernetPort,
  FileCode,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  GitPullRequest,
  Hash,
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
  Plug,
  Plus,
  Radar,
  RotateCcw,
  Rows2,
  Search,
  Settings,
  Shell,
  Star,
  Terminal,
  Ticket,
  Trash2,
  Type,
  Undo2,
  CornerLeftUp,
  Eye,
  EyeOff,
  File,
  FolderTree,
  RefreshCw,
  SquareTerminal,
  Ellipsis,
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
