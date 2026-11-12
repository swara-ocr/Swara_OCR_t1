import type { Config } from "./config";
import type { Metrics } from "./checks";

export type CheckId = "page" | "light" | "framing" | "tilt" | "sharp" | "still";
export type Status = "red" | "amber" | "green";
export type Mode = "phone" | "webcam";

export interface Evaluation {
  passed: Record<CheckId, boolean>;
  failing: CheckId[];
  hint: string;
  status: Status;
  score: number; // 0..1, share of checks passed (drives the beep speed)
}

const ORDER: CheckId[] = ["page", "light", "framing", "tilt", "sharp", "still"];

export const HINTS = {
  noPage: "I cannot see the page. Hold it in front of the camera.",
  dark: "Too dark. Move to a brighter place.",
  bright: "Too bright. Reduce the light on the page.",
  glare: "Reduce glare. Tilt the page a little.",
  straighten: "Straighten the page.",
  blurry: "Too blurry. Hold still.",
  still: "Hold still.",
  ok: "Good. Hold still.",
};

function frameHint(m: Metrics, cfg: Config, mode: Mode): string {
  const p = m.page;
  const who = mode === "phone" ? "the phone" : "the page";
  const t = p.touches;
  const mirror = mode === "webcam" ? -1 : 1; // webcam preview is mirrored
  // dx > 0: page sits right of centre in the image the user sees
  const dx = p.centreDx * mirror;
  const sideWord = (rightOfCentre: boolean) =>
    mode === "phone" ? (rightOfCentre ? "right" : "left") : rightOfCentre ? "left" : "right";
  const vertWord = (belowCentre: boolean) =>
    mode === "phone" ? (belowCentre ? "down" : "up") : belowCentre ? "up" : "down";

  if (p.areaFrac > cfg.page.maxAreaFrac || (t.left && t.right) || (t.top && t.bottom)) {
    return mode === "phone" ? "Move the phone further away." : "Move the page further away.";
  }
  // the page runs off one side, so the camera should move toward that side
  if (t.left || t.right) {
    const rightSide = t.right ? mirror > 0 : mirror < 0;
    return `Page is cut off. Move ${who} ${sideWord(rightSide)}.`;
  }
  if (t.top || t.bottom) return `Page is cut off. Move ${who} ${vertWord(t.bottom)}.`;
  if (p.areaFrac < cfg.page.minAreaFrac) return mode === "phone" ? "Move the phone closer." : "Move the page closer.";
  if (Math.abs(p.centreDx) > cfg.page.maxCentreOffset) return `Move ${who} ${sideWord(dx > 0)}.`;
  return `Move ${who} ${vertWord(p.centreDy > 0)}.`;
}

export function evaluate(m: Metrics, cfg: Config, mode: Mode, stillForMs: number): Evaluation {
  const p = m.page;
  const t = p.touches;
  const found = p.found;

  const tooDark = m.meanBrightness < cfg.light.minMeanBrightness;
  const tooBright = m.meanBrightness > cfg.light.maxMeanBrightness;
  const glare = m.glareFrac > cfg.light.maxGlareFrac;
  const cut = t.left || t.right || t.top || t.bottom;
  const centred = Math.abs(p.centreDx) <= cfg.page.maxCentreOffset && Math.abs(p.centreDy) <= cfg.page.maxCentreOffset;
  const sizeOk = p.areaFrac >= cfg.page.minAreaFrac && p.areaFrac <= cfg.page.maxAreaFrac;

  const passed: Record<CheckId, boolean> = {
    page: found,
    light: !tooDark && !tooBright && !glare,
    framing: found && !cut && centred && sizeOk,
    tilt: found && Math.abs(p.tiltDeg) <= cfg.tilt.maxDegrees,
    sharp: m.sharpness >= cfg.sharpness.minLaplacianVariance,
    still: stillForMs >= cfg.stability.holdMs,
  };
  const failing = ORDER.filter((id) => !passed[id]);

  let hint = HINTS.ok;
  const first = failing[0];
  if (first === "page") hint = HINTS.noPage;
  else if (first === "light") hint = tooDark ? HINTS.dark : tooBright ? HINTS.bright : HINTS.glare;
  else if (first === "framing") hint = frameHint(m, cfg, mode);
  else if (first === "tilt") hint = HINTS.straighten;
  else if (first === "sharp") hint = HINTS.blurry;
  else if (first === "still") hint = HINTS.still;

  const score = (ORDER.length - failing.length) / ORDER.length;
  const status: Status = failing.length === 0 ? "green" : found && failing.length <= 2 && !failing.includes("light") ? "amber" : "red";
  return { passed, failing, hint, status, score };
}

/** Label used next to the colour so status never relies on colour alone. */
export const STATUS_LABEL: Record<Status, string> = {
  green: "Ready",
  amber: "Almost",
  red: "Adjust",
};
