/**
 * The workdesk bot: a little terminal-headed mascot whose face says what an
 * agent is doing. Drawn on a 100×100 grid; styles.css animates each face.
 */

/** What the bot's face shows. */
export type BotFace = "idle" | "read" | "think" | "happy" | "ask" | "error" | "sleep";

const SMILE = "M42 53.5 Q50 59.5 58 53.5";

/** Shell, ears, the top bump, and the screen (x 21–79, y 20–68). */
const HEAD =
  '<rect class="bot-shell" x="10" y="38" width="8" height="20" rx="3"/>' +
  '<rect class="bot-shell" x="82" y="38" width="8" height="20" rx="3"/>' +
  '<path class="bot-shell" d="M41 16 C41 8.5 59 8.5 59 16 Z"/>' +
  '<rect class="bot-shell" x="13" y="14" width="74" height="72" rx="20"/>' +
  '<rect class="bot-screen" x="21" y="20" width="58" height="48" rx="13"/>';

const EYES =
  '<g class="bot-eyes"><rect class="bot-eye" x="32" y="28.5" width="8" height="15" rx="4"/>' +
  '<rect class="bot-eye" x="60" y="28.5" width="8" height="15" rx="4"/></g>';

/** A stroked line on the screen, in the face color. */
const line = (d: string, cls = "", w = 4.5) => `<path class="bot-line ${cls}" d="${d}" stroke-width="${w}"/>`;

/** Morphs the mouth through `shapes`, easing between each. */
function morph(shapes: string[], dur: string, keyTimes: string): string {
  const splines = keyTimes.split(";").slice(1).map(() => ".4 0 .2 1").join(";");
  return `<animate attributeName="d" values="${shapes.join(";")}" dur="${dur}" keyTimes="${keyTimes}" calcMode="spline" keySplines="${splines}" repeatCount="indefinite"/>`;
}

const mouth = (anim = "") => `<path class="bot-line" d="${SMILE}" stroke-width="4.5">${anim}</path>`;

const FACES: Record<BotFace, string> = {
  idle: EYES + mouth(),
  // Eyes scan along a line, then flick back: reading the code it's working on.
  read: EYES + mouth(),
  think:
    EYES +
    mouth(morph(["M45 56 Q50 56 55 56", "M47 56 Q52 56 57 56", "M45 56 Q50 56 55 56"], "2.4s", "0;0.5;1")),
  happy:
    EYES +
    line("M31 39 Q36 31 41 39", "bot-arc") +
    line("M59 39 Q64 31 69 39", "bot-arc") +
    mouth(morph([SMILE, SMILE, "M39 52.5 Q50 63.5 61 52.5", "M39 52.5 Q50 63.5 61 52.5", SMILE, SMILE], "3s", "0;0.2;0.32;0.7;0.82;1")),
  ask:
    `<g class="bot-sign">` +
    line("M43.5 32 Q43.5 25.5 50 25.5 Q56.5 25.5 56.5 32 Q56.5 36.5 50 39.5 V44", "", 5.5) +
    `<circle class="bot-dot" cx="50" cy="54" r="3.2"/></g>`,
  error: `<g class="bot-sign">${line("M50 27 V44", "", 5.5)}<circle class="bot-dot" cx="50" cy="54" r="3.2"/></g>`,
  sleep:
    line("M31 50 h7 l-7 7 h7", "bot-z bot-z1", 3.5) +
    line("M43 37 h9 l-9 9 h9", "bot-z bot-z2", 4) +
    line("M56 26 h11 l-11 11 h11", "bot-z bot-z3", 4.5),
};

/** The bot as an SVG string, showing `face`. Color it with `--bot` on an ancestor. */
export function botSvg(face: BotFace): string {
  let body = FACES[face];
  // CSS can't pause the mouth's SMIL morphs, so leave them out.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) body = body.replace(/<animate [^>]*\/>/g, "");
  return `<svg class="bot" data-face="${face}" viewBox="0 0 100 100" aria-hidden="true">${HEAD}${body}</svg>`;
}
