import { CONFIG, type Config } from "./config";
import { locateInPhoto, type Box, type TextInfo } from "./checks";
import type { LayoutSetting, WhichPage } from "./settings";

export type PageId = "page" | "left" | "right";

export interface PageCrop {
  id: PageId;
  box: Box; // in photo pixels
}

export interface LayoutDecision {
  kind: "single" | "spread";
  setting: LayoutSetting;
  which: WhichPage;
  gutterFound: boolean;
  gutterX: number; // photo pixels, 0 when none
  textBox: Box | null; // text block in photo pixels
  crops: PageCrop[]; // pages to read, left to right
  note: string; // plain-language reason, spoken when something was unexpected
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Decides single page or spread and where to cut. `text` is the detection result in a frame
 * `scale` times smaller than the photo.
 */
export function decideFromText(
  text: TextInfo,
  photoW: number,
  photoH: number,
  scale: number,
  setting: LayoutSetting,
  which: WhichPage,
  cfg: Config = CONFIG,
): LayoutDecision {
  const whole: Box = { x0: 0, y0: 0, x1: photoW, y1: photoH };
  const base = { setting, which, gutterFound: false, gutterX: 0, textBox: null as Box | null };
  if (!text.found) {
    return { ...base, kind: "single", crops: [{ id: "page", box: whole }], note: "No text block found. Reading the whole photo." };
  }
  const pad = Math.round(cfg.ocr.cropPadFrac * Math.max(photoW, photoH));
  const tb: Box = {
    x0: clamp(Math.round(text.box.x0 * scale) - pad, 0, photoW),
    y0: clamp(Math.round(text.box.y0 * scale) - pad, 0, photoH),
    x1: clamp(Math.round(text.box.x1 * scale) + pad, 0, photoW),
    y1: clamp(Math.round(text.box.y1 * scale) + pad, 0, photoH),
  };
  const found = { ...base, textBox: tb };

  if (setting === "book" && text.gutter.found) {
    const gx = Math.round(text.gutter.x * scale);
    const gap = Math.round(text.gutter.halfWidth * scale);
    const left: PageCrop = { id: "left", box: { ...tb, x1: clamp(gx - gap, tb.x0 + 1, tb.x1) } };
    const right: PageCrop = { id: "right", box: { ...tb, x0: clamp(gx + gap, tb.x0, tb.x1 - 1) } };
    const crops = which === "left" ? [left] : which === "right" ? [right] : [left, right];
    return { ...found, kind: "spread", gutterFound: true, gutterX: gx, crops, note: "" };
  }
  return {
    ...found,
    kind: "single",
    crops: [{ id: "page", box: tb }],
    note: setting === "book" ? "Could not find the fold. Reading as one page." : "",
  };
}

/** Runs detection on the photo itself, then decides. */
export function decideLayout(photo: HTMLCanvasElement, setting: LayoutSetting, which: WhichPage, cfg: Config = CONFIG): LayoutDecision {
  const w = cfg.analysis.width;
  const h = Math.round((w * photo.height) / photo.width);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const text = locateInPhoto(data, w, h, cfg);
  return decideFromText(text, photo.width, photo.height, photo.width / w, setting, which, cfg);
}

export function cropCanvas(photo: HTMLCanvasElement, box: Box): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, box.x1 - box.x0);
  c.height = Math.max(1, box.y1 - box.y0);
  c.getContext("2d")!.drawImage(photo, box.x0, box.y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/**
 * A page number printed on its own line at the top or bottom of the text (or at the start or end of a short line,
 * as in "82 Healthy Food"). Returns null when none is found.
 */
export function findPageNumber(text: string): number | null {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const candidates = [...lines.slice(0, 2), ...lines.slice(-2)];
  for (const l of candidates) {
    const alone = l.match(/^[\[(\-–\s]*(\d{1,4})[\])\-–\s]*$/);
    if (alone) return Number(alone[1]);
  }
  for (const l of candidates) {
    if (l.length > 32) continue;
    const edge = l.match(/^(\d{1,4})\s+\S/) ?? l.match(/\S\s+(\d{1,4})$/);
    if (edge) return Number(edge[1]);
  }
  return null;
}
