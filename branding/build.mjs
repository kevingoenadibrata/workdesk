// Builds the Workdesk brand kit: SVG sources + PNG renders.
// usage: node build.mjs <fontsDir> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
import { Resvg } from '@resvg/resvg-js';

const [fontsDir, OUT] = process.argv.slice(2);
const fontBold = opentype.loadSync(path.join(fontsDir, 'bricolage-700.ttf'));
const fontMed = opentype.loadSync(path.join(fontsDir, 'bricolage-500.ttf'));
const fontMono = opentype.loadSync(path.join(fontsDir, 'plexmono-500.ttf'));

// ---------- tokens ----------
const C = {
  night: '#120E0D',   // background
  ember: '#1E1715',   // raised surface on night
  rose: '#F4C7B8',    // primary blade / wordmark on dark
  copper: '#C98F7E',  // secondary blade
  clay: '#8E5646',    // secondary blade on light
  terra: '#C4826F',   // primary blade on light
  blush: '#FBF1EC',   // light background
};
const SCHEMES = {
  dark:  { a: C.rose,  b: C.copper, text: C.rose,  sub: C.copper },
  light: { a: C.terra, b: C.clay,   text: C.night, sub: C.clay },
  black: { a: '#000000', b: '#000000', text: '#000000', sub: '#000000' },
  white: { a: '#FFFFFF', b: '#FFFFFF', text: '#FFFFFF', sub: '#FFFFFF' },
};
const TAGLINE = 'A desk for your terminals.';

// ---------- mark ----------
const BLADE = 'M7 -200L7 -139.48A88.32 132.48 0 0 0 95.32 -7L131 -7Q145 -7 137.23 -18.65L14.77 -202.35Q7 -214 7 -200Z';
const MARK_BOX = 453.68; // reference viewBox width of the approved SVG
const INK = 430 / MARK_BOX; // blade tips reach ±214, plus a hair of air
const blades = (s) => [0, 90, 180, 270].map((r, i) =>
  `<path d="${BLADE}" transform="rotate(${r})" fill="${i % 2 ? s.b : s.a}"/>`).join('');
// mark centred at (cx,cy) inside a box of `size`
const mark = (s, size, cx, cy, extra = '') =>
  `<g transform="translate(${r2(cx)} ${r2(cy)}) scale(${r4(size / MARK_BOX)})"${extra}>${blades(s)}</g>`;

const r2 = (n) => +n.toFixed(2);
const r4 = (n) => +n.toFixed(4);

// ---------- text → outlines ----------
function text(font, str, size, { x = 0, y = 0, tracking = 0, anchor = 'start' } = {}) {
  const glyphs = font.stringToGlyphs(str);
  const scale = size / font.unitsPerEm;
  let adv = 0;
  const parts = [];
  glyphs.forEach((g, i) => {
    parts.push([g, adv]);
    adv += g.advanceWidth * scale + tracking * size;
    if (i < glyphs.length - 1) adv += font.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  adv -= tracking * size;
  const x0 = anchor === 'middle' ? x - adv / 2 : anchor === 'end' ? x - adv : x;
  const p = new opentype.Path();
  parts.forEach(([g, dx]) => p.extend(g.getPath(x0 + dx, y, size)));
  const bb = p.getBoundingBox();
  return { d: p.toPathData(2), width: adv, bb };
}
const wordmark = (size, opts) => text(fontBold, 'Workdesk', size, { tracking: -0.025, ...opts });

// ---------- svg helpers ----------
const svg = (w, h, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${extra}>${body}</svg>\n`;
const files = [];
function emit(rel, content, renders = []) {
  const p = path.join(OUT, 'svg', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  files.push(rel);
  for (const r of renders) {
    const png = new Resvg(content, { fitTo: { mode: 'width', value: r.w }, background: 'rgba(0,0,0,0)' }).render().asPng();
    const out = path.join(OUT, 'png', r.name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
  }
}

// ---------- 1. marks ----------
for (const [k, s] of Object.entries(SCHEMES)) {
  const name = { dark: 'mark-color', light: 'mark-color-on-light', black: 'mark-black', white: 'mark-white' }[k];
  emit(`mark/${name}.svg`, svg(512, 512, mark(s, 512, 256, 256)), [{ name: `mark/${name}.png`, w: 1024 }]);
}

// ---------- 2. wordmarks + lockups ----------
function horizontal(s) {
  const F = 100;
  const t = wordmark(F);
  const capH = -t.bb.y1;                // ascender height above baseline
  const M = capH * 1.62;                // mark box size
  const ink = M * INK;
  const gap = M * 0.2;
  const cy = -capH / 2;
  const w = ink + gap + t.bb.x2;
  const h = ink;
  const body =
    mark(s, M, ink / 2, h / 2) +
    `<path d="${t.d}" fill="${s.text}" transform="translate(${r2(ink + gap)} ${r2(h / 2 - cy)})"/>`;
  return svg(r2(w), r2(h), body);
}
function stacked(s) {
  const F = 100;
  const t = wordmark(F, { anchor: 'middle' });
  const M = 300;
  const ink = M * INK;
  const gap = 34;
  const w = Math.max(ink, t.bb.x2 - t.bb.x1);
  const h = ink + gap - t.bb.y1 + t.bb.y2;
  const body =
    mark(s, M, w / 2, ink / 2) +
    `<path d="${t.d}" fill="${s.text}" transform="translate(${r2(w / 2)} ${r2(ink + gap - t.bb.y1)})"/>`;
  return svg(r2(w), r2(h), body);
}
function wordOnly(s) {
  const t = wordmark(100);
  return svg(r2(t.bb.x2 - t.bb.x1), r2(t.bb.y2 - t.bb.y1),
    `<path d="${t.d}" fill="${s.text}" transform="translate(${r2(-t.bb.x1)} ${r2(-t.bb.y1)})"/>`);
}
const SUFFIX = { dark: 'color', light: 'color-on-light', black: 'black', white: 'white' };
for (const [k, s] of Object.entries(SCHEMES)) {
  emit(`logo/logo-horizontal-${SUFFIX[k]}.svg`, horizontal(s), [{ name: `logo/logo-horizontal-${SUFFIX[k]}.png`, w: 2000 }]);
  emit(`logo/logo-stacked-${SUFFIX[k]}.svg`, stacked(s), [{ name: `logo/logo-stacked-${SUFFIX[k]}.png`, w: 1200 }]);
  emit(`logo/wordmark-${SUFFIX[k]}.svg`, wordOnly(s), [{ name: `logo/wordmark-${SUFFIX[k]}.png`, w: 1600 }]);
}

// ---------- 3. app icons ----------
const plateDefs = (id, top, bottom) =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>`;
function macIcon(dark = true) {
  const s = dark ? SCHEMES.dark : SCHEMES.light;
  const [top, bot] = dark ? ['#211917', C.night] : ['#FFFFFF', '#F6E6DE'];
  const edge = dark ? 'rgba(255,255,255,0.07)' : 'rgba(18,14,13,0.08)';
  return svg(1024, 1024,
    plateDefs('p', top, bot) +
    `<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#p)"/>` +
    `<rect x="101" y="101" width="822" height="822" rx="184" fill="none" stroke="${edge}" stroke-width="2"/>` +
    mark(s, 824 * 0.62, 512, 512));
}
emit('app-icon/app-icon-macos.svg', macIcon(true), [
  { name: 'app-icon/app-icon-macos-1024.png', w: 1024 },
  { name: 'app-icon/app-icon-macos-512.png', w: 512 },
]);
emit('app-icon/app-icon-macos-light.svg', macIcon(false), [{ name: 'app-icon/app-icon-macos-light-1024.png', w: 1024 }]);
// full-bleed square: iOS / Android / Windows apply their own mask
const square = svg(1024, 1024, `<rect width="1024" height="1024" fill="${C.night}"/>` + mark(SCHEMES.dark, 1024 * 0.6, 512, 512));
emit('app-icon/app-icon-square.svg', square, [
  { name: 'app-icon/app-icon-square-1024.png', w: 1024 },
  { name: 'web/icon-512.png', w: 512 },
  { name: 'web/icon-192.png', w: 192 },
  { name: 'web/apple-touch-icon.png', w: 180 },
]);
// favicon: rounded tile so it reads on any tab-bar colour
const fav = svg(64, 64, `<rect width="64" height="64" rx="14" fill="${C.night}"/>` + mark(SCHEMES.dark, 64 * 0.86, 32, 32));
emit('web/favicon.svg', fav, [
  { name: 'web/favicon-16.png', w: 16 },
  { name: 'web/favicon-32.png', w: 32 },
  { name: 'web/favicon-48.png', w: 48 },
]);
// avatar: circle-safe profile picture
emit('social/avatar.svg', svg(800, 800, `<rect width="800" height="800" fill="${C.night}"/>` + mark(SCHEMES.dark, 800 * 0.58, 400, 400)),
  [{ name: 'social/avatar-800.png', w: 800 }]);

// ---------- 4. pattern ----------
function patternDef(id, cell, opacity) {
  // offset rows, alternating 0° / 45° turns
  const m = cell * 0.42;
  const g = (x, y, rot) => mark({ a: C.rose, b: C.copper }, m, x, y, ` opacity="${opacity}"`).replace('scale(', `rotate(${rot}) scale(`);
  return `<pattern id="${id}" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse">` +
    g(cell * 0.25, cell * 0.25, 0) + g(cell * 0.75, cell * 0.75, 45) + `</pattern>`;
}
emit('pattern/pattern-tile.svg', svg(240, 240, `<rect width="240" height="240" fill="${C.night}"/><defs>${patternDef('t', 240, 0.12)}</defs><rect width="240" height="240" fill="url(#t)"/>`),
  [{ name: 'pattern/pattern-tile.png', w: 480 }]);

// ---------- 5. wide formats ----------
// Big cropped mark on the right, glow behind, logo + tagline on the left.
function wide(w, h, { logoH, tagSize, showTag = true, markScale = 1.25, markX = 0.8, pad }) {
  pad = pad ?? h * 0.14;
  const s = SCHEMES.dark;
  const bigM = h * markScale;
  const mx = w * markX, my = h / 2;
  // logo
  const F = logoH / 1.0;
  const t = wordmark(F);
  const capH = -t.bb.y1;
  const M = capH * 1.62;
  const ink = M * INK;
  const tagH = showTag ? tagSize * 1.9 : 0;
  const blockH = ink + tagH;
  const top = (h - blockH) / 2;
  const lx = pad;
  let body =
    `<defs><radialGradient id="g" cx="${r2(mx)}" cy="${r2(my)}" r="${r2(bigM * 0.62)}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${C.copper}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.copper}" stop-opacity="0"/></radialGradient>` +
    patternDef('pt', Math.round(h * 0.36), 0.05) + `</defs>` +
    `<rect width="${w}" height="${h}" fill="${C.night}"/>` +
    `<rect width="${w}" height="${h}" fill="url(#pt)"/>` +
    `<circle cx="${r2(mx)}" cy="${r2(my)}" r="${r2(bigM * 0.62)}" fill="url(#g)"/>` +
    mark(s, bigM, mx, my) +
    mark(s, M, lx + ink / 2, top + ink / 2) +
    `<path d="${t.d}" fill="${s.text}" transform="translate(${r2(lx + ink + M * 0.2)} ${r2(top + ink / 2 + capH / 2)})"/>`;
  if (showTag) {
    const tg = text(fontMed, TAGLINE, tagSize, { x: lx, y: top + ink + tagH * 0.78, tracking: -0.005 });
    body += `<path d="${tg.d}" fill="${C.copper}"/>`;
  }
  return svg(w, h, body);
}
emit('social/og-image.svg', wide(1200, 630, { logoH: 96, tagSize: 40, markScale: 1.15, markX: 0.86 }), [{ name: 'social/og-image.png', w: 1200 }]);
emit('social/github-social-preview.svg', wide(1280, 640, { logoH: 100, tagSize: 42, markScale: 1.15, markX: 0.86 }), [{ name: 'social/github-social-preview.png', w: 1280 }]);
emit('banner/banner-readme.svg', wide(1280, 320, { logoH: 70, tagSize: 26, markScale: 1.5, markX: 0.88, pad: 72 }), [{ name: 'banner/banner-readme.png', w: 2560 }]);
emit('banner/banner-x.svg', wide(1500, 500, { logoH: 84, tagSize: 34, markScale: 1.3, markX: 0.86, pad: 110 }), [{ name: 'banner/banner-x.png', w: 1500 }]);
emit('banner/banner-linkedin.svg', wide(1584, 396, { logoH: 70, tagSize: 28, markScale: 1.45, markX: 0.88, pad: 120 }), [{ name: 'banner/banner-linkedin.png', w: 1584 }]);

// ---------- 6. wallpaper ----------
function wallpaper(w, h) {
  const m = h * 0.34;
  return svg(w, h,
    `<defs><radialGradient id="g" cx="${w / 2}" cy="${h / 2}" r="${h * 0.42}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.copper}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.copper}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="${C.night}"/><circle cx="${w / 2}" cy="${h / 2}" r="${h * 0.42}" fill="url(#g)"/>` +
    mark(SCHEMES.dark, m, w / 2, h / 2));
}
emit('wallpaper/wallpaper-2560x1600.svg', wallpaper(2560, 1600), [{ name: 'wallpaper/wallpaper-2560x1600.png', w: 2560 }]);

// ---------- 7. palette card ----------
{
  const sw = [['Night', C.night], ['Rose', C.rose], ['Copper', C.copper], ['Terra', C.terra], ['Clay', C.clay], ['Blush', C.blush]];
  const W = 1200, H = 420, cw = W / sw.length;
  let b = '';
  sw.forEach(([n, hex], i) => {
    const dark = ['Night', 'Clay'].includes(n);
    const fg = dark ? C.blush : C.night;
    const nm = text(fontBold, n, 34, { x: i * cw + 28, y: H - 82 });
    const hx = text(fontMono, hex, 20, { x: i * cw + 28, y: H - 44 });
    b += `<rect x="${i * cw}" width="${cw}" height="${H}" fill="${hex}"/><path d="${nm.d}" fill="${fg}"/><path d="${hx.d}" fill="${fg}" opacity="0.75"/>`;
  });
  emit('palette.svg', svg(W, H, b), [{ name: 'palette.png', w: 1200 }]);
}

fs.writeFileSync(path.join(OUT, 'tokens.json'), JSON.stringify({ color: C, font: { display: 'Bricolage Grotesque 700', body: 'Bricolage Grotesque 500', mono: 'IBM Plex Mono 500' }, tagline: TAGLINE }, null, 2) + '\n');
console.log(files.join('\n'));
