# Workdesk brand kit

Open `index.html` in a browser to see every asset on its intended background.

## The mark

A four-blade star. Each blade is a right triangle with its inner corner scooped out, and the four blades turn around a shared centre with a small gap between them. Alternate blades use the two tones: Rose on the top-right and bottom-left, Copper on the other two.

Do not redraw it, change the curve, close the gaps, recolour single blades, or add effects such as shadows, outlines or gradients on the blades.

## Colour

| Name   | Hex       | Use |
|--------|-----------|-----|
| Night  | `#120E0D` | Main background. App icon plate, banners, dark UI |
| Ember  | `#1E1715` | Raised surfaces on Night |
| Rose   | `#F4C7B8` | Primary blade, wordmark on dark |
| Copper | `#C98F7E` | Secondary blade, taglines and accents on dark |
| Terra  | `#C4826F` | Primary blade on light backgrounds |
| Clay   | `#8E5646` | Secondary blade on light backgrounds |
| Blush  | `#FBF1EC` | Light background |

Rose and Copper are too pale for white or Blush backgrounds. On light backgrounds use the `*-color-on-light` files (Terra/Clay blades, Night wordmark).

## Type

- **Wordmark:** Bricolage Grotesque Bold, title case, tracked -2.5%. In every file it is converted to outlines, so the font does not need to be installed.
- **Headings and taglines:** Bricolage Grotesque Medium
- **Code and small labels:** IBM Plex Mono Medium

All three are open-source fonts (SIL Open Font License) from Google Fonts. Copies are in `fonts/`.

Tagline: **A desk for your terminals.**

## Which file to use

| Need | File |
|------|------|
| Dock / Finder icon (macOS) | `png/app-icon/app-icon-macos-1024.png` (the source for `tauri icon`) |
| Alternate Dock icons (Settings → Appearance → App icon) | `svg/app-icon/variants/*.svg`, rendered into `src-tauri/icons/variants/` and `public/app-icons/` |
| iOS / Android / Windows tile (masked by the OS) | `svg/app-icon/app-icon-square.svg` |
| Browser tab | `svg/web/favicon.svg` + `png/web/favicon-32.png` |
| Home-screen / PWA | `png/web/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` |
| Website header, docs, slides | `svg/logo/logo-horizontal-*.svg` |
| Square spaces (splash screen, about box, stickers) | `svg/logo/logo-stacked-*.svg` |
| Text-only spaces | `svg/logo/wordmark-*.svg` |
| Mark on its own | `svg/mark/mark-*.svg` |
| One-colour print, fax, embossing, laser etching | `*-black.svg` / `*-white.svg` |
| Link previews (Slack, iMessage, X, Discord) | `png/social/og-image.png` (1200×630) |
| GitHub repo social preview | `png/social/github-social-preview.png` (1280×640) |
| Top of the README | `png/banner/banner-readme.png` (2560×640, shown at 1280×320) |
| X / Twitter header | `png/banner/banner-x.png` (1500×500) |
| LinkedIn banner | `png/banner/banner-linkedin.png` (1584×396) |
| Profile picture (crops to a circle safely) | `png/social/avatar-800.png` |
| Background texture | `svg/pattern/pattern-tile.svg` (repeats seamlessly) |
| Desktop wallpaper | `png/wallpaper/wallpaper-2560x1600.png` |

Suffixes: `color` = for dark backgrounds, `color-on-light` = for light backgrounds, `black` / `white` = one colour.

## Clear space and minimum size

- Keep empty space around the logo at least as wide as one blade's width (about a quarter of the mark's height).
- Minimum size: mark 16px, horizontal logo 96px wide, stacked logo 64px wide. Below those sizes, use the mark on its own.

## Regenerating

Everything in `svg/` and `png/` comes from `build.mjs`:

```sh
cd branding
npm i --no-save @resvg/resvg-js@2.6.2 opentype.js@1.3.4
node build.mjs fonts .
```

Change colours, the tagline or sizes at the top of `build.mjs`, then run it again.
