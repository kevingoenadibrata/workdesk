import { el } from "./page";

/** Shows an image (`![alt](src)`) in place, or returns null to leave it a link. */
export type ImageHook = (src: string, alt: string) => HTMLElement | null;

/**
 * A ticket description as DOM: paragraphs, headings, lists, quotes, code
 * blocks, inline code, bold and links. Built from text nodes only, never
 * HTML, since descriptions come from anyone who can edit the ticket.
 */
export function markdown(src: string, onLink: (url: string) => void, onImage?: ImageHook): HTMLElement[] {
  const out: HTMLElement[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const flush = () => {
    if (para.length) {
      const p = el("p", "");
      inline(p, para.join(" "), onLink, onImage);
      out.push(p);
    }
    para = [];
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith(fence[1])) code.push(lines[i]);
      out.push(el("pre", "", code.join("\n")));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      const h = el("h3", "");
      inline(h, heading[2].replace(/\s+#+\s*$/, ""), onLink, onImage);
      out.push(h);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push(el("hr", ""));
    } else if (item) {
      if (para.length) flush();
      if (!list) {
        list = el(/^\s*\d/.test(line) ? "ol" : "ul", "");
        out.push(list);
      }
      const li = el("li", "");
      if (item[1] !== undefined) li.append(item[1].trim() ? "☑ " : "☐ ");
      inline(li, item[2], onLink, onImage);
      list.append(li);
    } else if (quote) {
      flush();
      const q = el("blockquote", "");
      inline(q, quote[1], onLink, onImage);
      out.push(q);
    } else {
      list = null;
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

/** Appends `text` to `node`, with `code`, **bold** and links, which open in the browser. */
function inline(node: HTMLElement, text: string, onLink: (url: string) => void, onImage?: ImageHook) {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|!?\[([^\]]*)\]\(([^)\s]+)[^)]*\)|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let shown: HTMLElement | null;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) node.append(text.slice(last, m.index));
    if (m[1] !== undefined) node.append(el("code", "", m[1]));
    else if (m[2] !== undefined || m[3] !== undefined) node.append(el("strong", "", m[2] ?? m[3]));
    else if (m[0].startsWith("!") && onImage && (shown = onImage(m[5], m[4]))) node.append(shown);
    else {
      const url = m[5] ?? m[6];
      const a = el("button", "home-modal-link", m[4] !== undefined ? m[4] || (m[0].startsWith("!") ? "image" : url) : url);
      a.title = url;
      if (/^https?:\/\//.test(url)) a.addEventListener("click", () => onLink(url));
      node.append(a);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) node.append(text.slice(last));
}
