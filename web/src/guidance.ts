import type { Config } from "./config";
import type { Metrics } from "./checks";

export type CheckId = "text" | "light" | "framing" | "tilt" | "sharp" | "still";
export type Status = "red" | "amber" | "green";
export type Mode = "phone" | "webcam";

export interface Evaluation {
  passed: Record<CheckId, boolean>;
  failing: CheckId[];
  key: string; // identifies the state; a phrase is spoken only when this changes
  hint: string; // spoken phrase, under five words
  status: Status;
  score: number; // 0..1, share of checks passed (drives the tone pitch)
}

const ORDER: CheckId[] = ["text", "light", "framing", "tilt", "sharp", "still"];

/** Every phrase is under five words so it can be heard quickly. */
export const PHRASES = {
  noText: "Find the page",
  dark: "Too dark",
  bright: "Too bright",
  glare: "Reduce glare",
  straighten: "Straighten the page",
  steady: "Hold steady",
  ready: "Ready",
};

function moveWord(mode: Mode, thing: "closer" | "back" | "left" | "right" | "up" | "down"): string {
  const who = mode === "phone" ? "phone" : "page";
  if (thing === "closer") return `Move ${who} closer`;
  if (thing === "back") return `Move ${who} back`;
  return `Move ${who} ${thing}`;
}

function framingPhrase(m: Metrics, cfg: Config, mode: Mode): { key: string; hint: string } {
  const t = m.text;
  const mirror = mode === "webcam" ? -1 : 1; // the webcam preview is mirrored
  const side = (rightOfCentre: boolean) =>
    mode === "phone" ? (rightOfCentre ? "right" : "left") : rightOfCentre ? "left" : "right";
  const vert = (belowCentre: boolean) =>
    mode === "phone" ? (belowCentre ? "down" : "up") : belowCentre ? "up" : "down";
  const k = (name: string, thing: Parameters<typeof moveWord>[1]) => ({ key: name, hint: moveWord(mode, thing) });

  if ((t.touches.left && t.touches.right) || (t.touches.top && t.touches.bottom) || t.widthFrac > cfg.framing.maxWidthFrac) {
    return k("back", "back");
  }
  // text runs off one side: the camera should move toward that side
  if (t.touches.left || t.touches.right) {
    const rightSide = t.touches.right ? mirror > 0 : mirror < 0;
    const w = side(rightSide);
    return k(`cut-${w}`, w as "left" | "right");
  }
  if (t.touches.top || t.touches.bottom) {
    const w = vert(t.touches.bottom);
    return k(`cut-${w}`, w as "up" | "down");
  }
  if (t.areaFrac < cfg.framing.minAreaFrac) return k("closer", "closer");
  if (Math.abs(t.centreDx) > cfg.framing.maxCentreOffset) {
    const w = side(t.centreDx * mirror > 0);
    return k(`off-${w}`, w as "left" | "right");
  }
  const w = vert(t.centreDy > 0);
  return k(`off-${w}`, w as "up" | "down");
}

export function evaluate(m: Metrics, cfg: Config, mode: Mode, stillForMs: number): Evaluation {
  const t = m.text;
  const found = t.found;

  const tooDark = m.meanBrightness < cfg.light.minMeanBrightness;
  const tooBright = m.meanBrightness > cfg.light.maxMeanBrightness;
  const glare = m.glareFrac > cfg.light.maxGlareFrac;
  const cut = t.touches.left || t.touches.right || t.touches.top || t.touches.bottom;
  const centred = Math.abs(t.centreDx) <= cfg.framing.maxCentreOffset && Math.abs(t.centreDy) <= cfg.framing.maxCentreOffset;
  const sizeOk = t.areaFrac >= cfg.framing.minAreaFrac && t.widthFrac <= cfg.framing.maxWidthFrac;

  const passed: Record<CheckId, boolean> = {
    text: found,
    light: !tooDark && !tooBright && !glare,
    framing: found && !cut && centred && sizeOk,
    tilt: found && (!t.tiltReliable || Math.abs(t.tiltDeg) <= cfg.tilt.maxDegrees),
    sharp: m.sharpness >= cfg.sharpness.minLaplacianVariance,
    still: stillForMs >= cfg.stability.holdMs,
  };
  const failing = ORDER.filter((id) => !passed[id]);

  let key = "ready";
  let hint = PHRASES.ready;
  const first = failing[0];
  if (first === "text") ({ key, hint } = m.meanBrightness < cfg.light.veryDarkMean ? { key: "dark", hint: PHRASES.dark } : { key: "no-text", hint: PHRASES.noText });
  else if (first === "light") ({ key, hint } = tooDark ? { key: "dark", hint: PHRASES.dark } : tooBright ? { key: "bright", hint: PHRASES.bright } : { key: "glare", hint: PHRASES.glare });
  else if (first === "framing") ({ key, hint } = framingPhrase(m, cfg, mode));
  else if (first === "tilt") ({ key, hint } = { key: "tilt", hint: PHRASES.straighten });
  else if (first === "sharp" || first === "still") ({ key, hint } = { key: "steady", hint: PHRASES.steady });

  const score = (ORDER.length - failing.length) / ORDER.length;
  const status: Status = failing.length === 0 ? "green" : found && failing.length <= 2 && !failing.includes("light") ? "amber" : "red";
  return { passed, failing, key, hint, status, score };
}

/** Label used next to the colour so status never relies on colour alone. */
export const STATUS_LABEL: Record<Status, string> = {
  green: "Ready",
  amber: "Almost",
  red: "Adjust",
};
