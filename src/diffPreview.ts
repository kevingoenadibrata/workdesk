// Dev-only: the real Changes page fed a mock patch, for checking the diff
// view in a browser. Open /diff-preview.html on the dev server.
import "./styles.css";
import { DiffSheet } from "./diffview";
import { THEMES, currentTheme, loadTheme, setTheme } from "./themes";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 3b18e51..a1c2d3f 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,9 +1,12 @@
 import { format } from "./format";
 
-export function greet(name: string) {
-  return "Hello, " + name;
+export function greet(name: string, excited = false) {
+  const text = \`Hello, \${name}\`;
+  return excited ? text + "!" : text;
 }
 
 export function farewell(name: string) {
   return format("Goodbye, %s", name);
 }
+
+export const DEFAULT_NAME = "world"; // used whenever a caller passes no name at all, which happens more than you'd think in the old CLI paths
@@ -40,7 +43,6 @@ export function shout(text: string) {
   const upper = text.toUpperCase();
-  console.log("shouting", upper);
   return upper;
 }
 
\\ No newline at end of file
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/README.md
@@ -0,0 +1,3 @@
+# Greeter
+
+Says hello.
diff --git a/old/legacy.js b/old/legacy.js
deleted file mode 100644
index 1111111..0000000
--- a/old/legacy.js
+++ /dev/null
@@ -1,2 +0,0 @@
-var x = 1;
-module.exports = x;
diff --git a/src/util.ts b/src/lib/util.ts
similarity index 90%
rename from src/util.ts
rename to src/lib/util.ts
index 2222222..3333333 100644
--- a/src/util.ts
+++ b/src/lib/util.ts
@@ -1,3 +1,3 @@
-export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
+export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
 export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
 export const noop = () => {};
diff --git a/assets/logo.png b/assets/logo.png
index 4444444..5555555 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

// A lockfile-sized change, to show the "Large diff hidden" state.
const BIG =
  "diff --git a/package-lock.json b/package-lock.json\nindex 6666666..7777777 100644\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1,0 +1,50000 @@\n" +
  Array.from({ length: 50000 }, (_, i) => `+    "node_modules/pkg-${i}": { "version": "1.0.${i}" },`).join("\n") +
  "\n";

// Stands in for Tauri, which the page asks for the patch.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => (cmd === "git_diff" ? PATCH + BIG : null),
  transformCallback: () => 0,
};

const view = new URLSearchParams(location.search).get("view");
if (view) {
  try {
    localStorage.setItem("workdesk.diffView", view);
  } catch {}
}

loadTheme();
const sheet = new DiffSheet();
void sheet.show("/mock", "greeter", "feature/excited-greetings");

const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
for (const t of THEMES) themeSelect.add(new Option(t.name, t.name, false, t.name === currentTheme().name));
themeSelect.addEventListener("change", () => setTheme(THEMES.find((t) => t.name === themeSelect.value)!));
const themeAsked = new URLSearchParams(location.search).get("theme");
if (themeAsked) {
  const t = THEMES.find((t) => t.name === themeAsked);
  if (t) setTheme(t);
}

// ?scrollx=N scrolls every file sideways, for checking long lines.
const scrollx = Number(new URLSearchParams(location.search).get("scrollx"));
if (scrollx) setTimeout(() => document.querySelectorAll(".diff-grid").forEach((g) => (g.scrollLeft = scrollx)), 400);
// ?file=path scrolls to that file.
const file = new URLSearchParams(location.search).get("file");
if (file) setTimeout(() => document.querySelector(`[data-path="${CSS.escape(file)}"]`)?.scrollIntoView(), 400);
// ?scrolly=N scrolls the sheet down, for checking rows draw as they come into view.
const scrolly = Number(new URLSearchParams(location.search).get("scrolly"));
if (scrolly)
  setTimeout(() => {
    const t = performance.now();
    document.querySelector(".diff-scroll")!.scrollTop = scrolly;
    requestAnimationFrame(() => (document.title = `${document.querySelectorAll(".diff-line").length} rows drawn, ${Math.round(performance.now() - t)}ms`));
  }, 600);
// ?show=1 clicks "Show N lines" on large files.
if (new URLSearchParams(location.search).get("show"))
  setTimeout(() => document.querySelectorAll<HTMLElement>(".diff-show").forEach((b) => b.click()), 450);
