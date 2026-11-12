import type { Config } from "./config";

export interface Gray {
  data: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GutterInfo {
  found: boolean;
  x: number; // centre of the gutter, in the pixels of the frame that was analysed
  halfWidth: number;
  kind: "none" | "band" | "shadow" | "both";
  confidence: number; // 0..1
}

export interface TextInfo {
  found: boolean;
  box: Box; // text block, in the pixels of the frame that was analysed
  areaFrac: number; // box area / frame area
  widthFrac: number;
  heightFrac: number;
  centreDx: number; // -0.5..0.5, positive = text block centre is right of the frame centre
  centreDy: number; // positive = below
  tiltDeg: number; // text-line angle; positive = lines slope down to the right
  tiltReliable: boolean;
  touches: { left: boolean; right: boolean; top: boolean; bottom: boolean }; // text runs into that edge
  runs: number; // separate bands of text lines
  gutter: GutterInfo;
}

export interface Metrics {
  text: TextInfo;
  sharpness: number;
  meanBrightness: number;
  glareFrac: number;
  motion: number; // mean abs difference to the previous tiny frame, 255 if unknown
}

export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return { data, w, h };
}

export function downscale(g: Gray, factor: number): Gray {
  if (factor <= 1) return g;
  const w = Math.floor(g.w / factor);
  const h = Math.floor(g.h / factor);
  const out = new Uint8ClampedArray(w * h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * g.w + x * factor;
        for (let dx = 0; dx < factor; dx++) s += g.data[row + dx];
      }
      out[y * w + x] = s / n;
    }
  }
  return { data: out, w, h };
}

export function boxBlur(g: Gray): Gray {
  const out = new Uint8ClampedArray(g.data.length);
  const { w, h, data } = g;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += data[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return { data: out, w, h };
}

export function otsu(g: Gray): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Variance of the Laplacian, optionally limited to a region (so edges outside the text do not hide blur). */
export function laplacianVariance(g: Gray, region?: Box): number {
  const { w, h, data } = g;
  const x0 = Math.max(1, Math.round(region?.x0 ?? 1));
  const x1 = Math.min(w - 1, Math.round(region?.x1 ?? w - 1));
  const y0 = Math.max(1, Math.round(region?.y0 ?? 1));
  const y1 = Math.min(h - 1, Math.round(region?.y1 ?? h - 1));
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      const v = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function regionStats(g: Gray, region: Box | undefined, glareLevel: number): { mean: number; glare: number } {
  const x0 = Math.max(0, Math.round(region?.x0 ?? 0));
  const x1 = Math.min(g.w, Math.round(region?.x1 ?? g.w));
  const y0 = Math.max(0, Math.round(region?.y0 ?? 0));
  const y1 = Math.min(g.h, Math.round(region?.y1 ?? g.h));
  let s = 0;
  let hit = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = g.data[y * g.w + x];
      s += v;
      if (v >= glareLevel) hit++;
      n++;
    }
  }
  return n ? { mean: s / n, glare: hit / n } : { mean: 0, glare: 0 };
}

export function motion(a: Gray | null, b: Gray): number {
  if (!a || a.data.length !== b.data.length) return 255;
  let s = 0;
  for (let i = 0; i < b.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / b.data.length;
}

// ---------- text region ----------

const NO_GUTTER: GutterInfo = { found: false, x: 0, halfWidth: 0, kind: "none", confidence: 0 };

function emptyText(): TextInfo {
  return {
    found: false,
    box: { x0: 0, y0: 0, x1: 0, y1: 0 },
    areaFrac: 0,
    widthFrac: 0,
    heightFrac: 0,
    centreDx: 0,
    centreDy: 0,
    tiltDeg: 0,
    tiltReliable: false,
    touches: { left: false, right: false, top: false, bottom: false },
    runs: 0,
    gutter: NO_GUTTER,
  };
}

/** Summed-area table, one extra row and column of zeros. */
function integral(src: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint32Array {
  const W = w + 1;
  const t = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      t[(y + 1) * W + x + 1] = t[y * W + x + 1] + row;
    }
  }
  return t;
}

function windowSum(t: Uint32Array, w: number, h: number, x: number, y: number, rx: number, ry: number): number {
  const W = w + 1;
  const x0 = Math.max(0, x - rx);
  const x1 = Math.min(w, x + rx + 1);
  const y0 = Math.max(0, y - ry);
  const y1 = Math.min(h, y + ry + 1);
  return t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
}

/**
 * The paper: light pixels, holes (the text) filled, table and background left out.
 * Regions that touch the frame edge but are small (letters cut by the edge) count as paper.
 */
function paperMask(g: Gray, cfg: Config): Uint8Array {
  const { w, h } = g;
  const blurred = boxBlur(g);
  const t = otsu(blurred);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < bright.length; i++) bright[i] = blurred.data[i] > t ? 1 : 0;

  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seeds: number[] = [];
  for (let x = 0; x < w; x++) seeds.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) seeds.push(y * w, y * w + w - 1);
  const maxSmall = w * h * cfg.text.smallRegionFrac;
  for (const s of seeds) {
    if (bright[s] || outside[s]) continue;
    const region: number[] = [];
    outside[s] = 2; // 2 = visited in this pass
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && !bright[i - 1] && !outside[i - 1]) { outside[i - 1] = 2; stack.push(i - 1); }
      if (x < w - 1 && !bright[i + 1] && !outside[i + 1]) { outside[i + 1] = 2; stack.push(i + 1); }
      if (y > 0 && !bright[i - w] && !outside[i - w]) { outside[i - w] = 2; stack.push(i - w); }
      if (y < h - 1 && !bright[i + w] && !outside[i + w]) { outside[i + w] = 2; stack.push(i + w); }
    }
    const keep = region.length >= maxSmall ? 1 : 0; // big = background, small = part of the page
    for (const i of region) outside[i] = keep;
  }
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < paper.length; i++) paper[i] = outside[i] ? 0 : 1;

  // pull the mask in from the page edge so the edge itself is not read as text (frame borders are not edges)
  const r = cfg.text.paperErode;
  if (r > 0) {
    const eroded = new Uint8Array(paper);
    const ti = integral(paper, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!paper[y * w + x]) continue;
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w, x + r + 1);
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h, y + r + 1);
        // window cells that lie outside the frame count as paper
        const inside = (x1 - x0) * (y1 - y0);
        const full = (2 * r + 1) * (2 * r + 1);
        if (windowSum(ti, w, h, x, y, r, r) + (full - inside) < full) eroded[y * w + x] = 0;
      }
    }
    return eroded;
  }
  return paper;
}

/** Ink = pixels clearly darker than their surroundings, on paper only. */
function inkMask(g: Gray, paper: Uint8Array, cfg: Config): Uint8Array {
  const { w, h } = g;
  const ti = integral(g.data, w, h);
  const r = cfg.text.windowRadius;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!paper[i]) continue;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h, y + r + 1);
      const mean = windowSum(ti, w, h, x, y, r, r) / ((x1 - x0) * (y1 - y0));
      if (mean > cfg.text.minLocalMean && g.data[i] < mean - cfg.text.contrast) ink[i] = 1;
    }
  }
  return ink;
}

function dilate(mask: Uint8Array, w: number, h: number, rx: number, ry: number): Uint8Array {
  const ti = integral(mask, w, h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (windowSum(ti, w, h, x, y, rx, ry) > 0) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Text-line angle: the rotation at which the ink piles up into the sharpest horizontal bands. */
function lineAngle(ink: Uint8Array, w: number, box: Box, cfg: Config): { deg: number; reliable: boolean } {
  const pts: number[] = [];
  const stride = Math.max(1, Math.floor(((box.x1 - box.x0) * (box.y1 - box.y0)) / 6000));
  let k = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (ink[y * w + x] && k++ % stride === 0) pts.push(x - box.x0, y - box.y0);
    }
  }
  if (pts.length < 200) return { deg: 0, reliable: false };
  const span = cfg.tilt.searchDegrees;
  const energies: number[] = [];
  const size = Math.ceil((box.x1 - box.x0 + box.y1 - box.y0) * 1.2) + 4;
  const offset = Math.floor(size / 2);
  for (let a = -span; a <= span; a++) {
    const rad = (a * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const bins = new Float32Array(size);
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.round(pts[i + 1] * c - pts[i] * s) + offset;
      if (yy >= 0 && yy < size) bins[yy]++;
    }
    let e = 0;
    for (let b = 0; b < size; b++) e += bins[b] * bins[b];
    energies.push(e);
  }
  let best = 0;
  for (let i = 1; i < energies.length; i++) if (energies[i] > energies[best]) best = i;
  const mean = energies.reduce((p, c) => p + c, 0) / energies.length;
  let deg = best - span;
  if (best > 0 && best < energies.length - 1) {
    const a = energies[best - 1];
    const b = energies[best];
    const c = energies[best + 1];
    const denom = a - 2 * b + c;
    if (denom < 0) deg += (0.5 * (a - c)) / denom; // parabola through the three points
  }
  return { deg, reliable: (energies[best] - mean) / mean > cfg.tilt.minPeakContrast };
}

function findGutter(g: Gray, ink: Uint8Array, box: Box, cfg: Config): GutterInfo {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  if (bw / bh < cfg.gutter.minAspect || bw < 40) return NO_GUTTER;
  const { w } = g;

  // ink density per column, smoothed
  const dens = new Float32Array(bw);
  for (let x = 0; x < bw; x++) {
    let n = 0;
    for (let y = box.y0; y <= box.y1; y++) n += ink[y * w + box.x0 + x];
    dens[x] = n;
  }
  const sm = dens.map((_, x) => {
    let s = 0;
    let c = 0;
    for (let d = -1; d <= 1; d++) {
      if (x + d >= 0 && x + d < bw) { s += dens[x + d]; c++; }
    }
    return s / c;
  });
  const filled = Array.from(sm).filter((v) => v > 0).sort((a, b) => a - b);
  const median = filled.length ? filled[Math.floor(filled.length / 2)] : 0;
  if (median === 0) return NO_GUTTER;

  const lo = Math.round(bw * cfg.gutter.searchFrom);
  const hi = Math.round(bw * cfg.gutter.searchTo);

  // 1. a wide empty vertical band near the middle
  let bandStart = -1;
  let best = { len: 0, start: 0 };
  for (let x = lo; x <= hi; x++) {
    const empty = sm[x] < median * cfg.gutter.emptyFrac;
    if (empty && bandStart < 0) bandStart = x;
    if ((!empty || x === hi) && bandStart >= 0) {
      const len = (empty ? x + 1 : x) - bandStart;
      if (len > best.len) best = { len, start: bandStart };
      bandStart = -1;
    }
  }
  const bandOk = best.len >= Math.max(2, bw * cfg.gutter.minBandFrac);
  const bandX = best.start + best.len / 2;

  // 2. a dark vertical valley (the shadow in the fold)
  const colMean = new Float32Array(bw);
  for (let x = 0; x < bw; x++) {
    let s = 0;
    for (let y = box.y0; y <= box.y1; y++) s += g.data[y * w + box.x0 + x];
    colMean[x] = s / bh;
  }
  const side = Math.max(3, Math.round(bw * cfg.gutter.shadowSideFrac));
  const half = Math.max(1, Math.round(bw * 0.012));
  let valley = { depth: 0, x: 0 };
  for (let x = lo; x <= hi; x++) {
    let m = 0;
    let n = 0;
    for (let d = -half; d <= half; d++) { m += colMean[Math.min(bw - 1, Math.max(0, x + d))]; n++; }
    m /= n;
    const left = colMean[Math.max(0, x - side)];
    const right = colMean[Math.min(bw - 1, x + side)];
    const around = (left + right) / 2;
    const depth = (around - m) / Math.max(1, around);
    if (depth > valley.depth) valley = { depth, x };
  }
  const shadowOk = valley.depth >= cfg.gutter.shadowDepth;

  let kind: GutterInfo["kind"] = "none";
  let x = 0;
  let confidence = 0;
  if (bandOk && shadowOk && Math.abs(bandX - valley.x) <= bw * 0.08) {
    kind = "both";
    x = (bandX + valley.x) / 2;
    confidence = 1;
  } else if (bandOk) {
    kind = "band";
    x = bandX;
    confidence = 0.55;
  } else if (shadowOk) {
    kind = "shadow";
    x = valley.x;
    confidence = 0.5;
  }
  if (kind === "none") return NO_GUTTER;
  return {
    found: confidence >= cfg.gutter.minConfidence,
    x: box.x0 + x,
    halfWidth: Math.max(bw * 0.01, bandOk ? best.len / 2 : 0),
    kind,
    confidence,
  };
}

/** Finds the block of text on the page(s) in a grey frame about `cfg.text.detectWidth` pixels wide. */
export function detectText(g: Gray, cfg: Config): TextInfo {
  const { w, h } = g;
  const paper = paperMask(g, cfg);
  let paperPixels = 0;
  for (let i = 0; i < paper.length; i++) paperPixels += paper[i];
  if (paperPixels < w * h * cfg.text.minPaperFrac) return emptyText();

  const ink = inkMask(g, paper, cfg);
  const joined = dilate(ink, w, h, cfg.text.joinX, cfg.text.joinY);

  // rows that carry text, then columns inside those rows
  const rowThr = Math.max(3, w * cfg.text.minRowFrac);
  const rows = new Uint8Array(h);
  const rowCount = new Uint32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += joined[y * w + x];
    rowCount[y] = n;
    rows[y] = n >= rowThr ? 1 : 0;
  }
  // a text row must be part of a run of at least two rows
  let y0 = -1;
  let y1 = -1;
  let runs = 0;
  for (let y = 0; y < h; y++) {
    if (rows[y] && y + 1 < h && rows[y + 1]) {
      if (y0 < 0) y0 = y;
      y1 = y + 1;
    }
    if (rows[y] && (y === 0 || !rows[y - 1])) runs++;
  }
  if (y0 < 0) return emptyText();

  const colThr = 2;
  const cols = new Uint32Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) n += joined[y * w + x];
    cols[x] = n;
  }
  let x0 = -1;
  let x1 = -1;
  for (let x = 0; x < w - 2; x++) {
    if (cols[x] >= colThr && cols[x + 1] >= colThr && cols[x + 2] >= colThr) {
      if (x0 < 0) x0 = x;
      x1 = x + 2;
    }
  }
  if (x0 < 0) return emptyText();
  const box: Box = { x0, y0, x1, y1 };

  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  let inkInBox = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) inkInBox += ink[y * w + x];
  const inkFrac = inkInBox / (bw * bh);

  const mx = Math.max(2, Math.round(w * cfg.framing.edgeMarginFrac));
  const my = Math.max(2, Math.round(h * cfg.framing.edgeMarginFrac));
  const edgeShare = (from: number, to: number, axis: "x" | "y") => {
    let hitLines = 0;
    let lines = 0;
    if (axis === "x") {
      for (let y = y0; y <= y1; y++) {
        if (!rows[y]) continue;
        lines++;
        for (let x = from; x < to; x++) if (joined[y * w + x]) { hitLines++; break; }
      }
    } else {
      for (let x = x0; x <= x1; x++) {
        lines++;
        for (let y = from; y < to; y++) if (joined[y * w + x]) { hitLines++; break; }
      }
    }
    return lines ? hitLines / lines : 0;
  };
  const touches = {
    left: x0 <= mx || edgeShare(0, mx, "x") >= cfg.text.cutShare,
    right: x1 >= w - 1 - mx || edgeShare(w - mx, w, "x") >= cfg.text.cutShare,
    top: y0 <= my || edgeShare(0, my, "y") >= cfg.text.cutShare,
    bottom: y1 >= h - 1 - my || edgeShare(h - my, h, "y") >= cfg.text.cutShare,
  };

  const tilt = lineAngle(ink, w, box, cfg);
  const gutter = findGutter(g, ink, box, cfg);

  const areaFrac = (bw * bh) / (w * h);
  return {
    found: runs >= cfg.text.minRuns && inkFrac >= cfg.text.minInkFrac && areaFrac >= cfg.framing.foundAreaFrac,
    box,
    areaFrac,
    widthFrac: bw / w,
    heightFrac: bh / h,
    centreDx: (x0 + x1) / 2 / w - 0.5,
    centreDy: (y0 + y1) / 2 / h - 0.5,
    tiltDeg: tilt.deg,
    tiltReliable: tilt.reliable,
    touches,
    runs,
    gutter,
  };
}

export interface Analysis {
  metrics: Metrics;
  tiny: Gray; // 40-pixel-wide frame, kept for the next call's motion estimate
}

function scaleText(t: TextInfo, f: number): TextInfo {
  if (f === 1) return t;
  return {
    ...t,
    box: { x0: t.box.x0 * f, y0: t.box.y0 * f, x1: t.box.x1 * f, y1: t.box.y1 * f },
    gutter: { ...t.gutter, x: t.gutter.x * f, halfWidth: t.gutter.halfWidth * f },
  };
}

/** Runs every live check on one RGBA frame (already scaled to the analysis width). */
export function analyse(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, prevTiny: Gray | null, cfg: Config): Analysis {
  const gray = toGray(rgba, w, h);
  const f = Math.max(1, Math.round(w / cfg.text.detectWidth));
  const text = scaleText(detectText(downscale(gray, f), cfg), f); // box and gutter in analysis-frame pixels

  // sharpness, light and glare are measured on the text block, where it matters
  let region: Box | undefined;
  if (text.found) {
    const ix = (text.box.x1 - text.box.x0) * 0.1;
    const iy = (text.box.y1 - text.box.y0) * 0.1;
    region = { x0: text.box.x0 + ix, x1: text.box.x1 - ix, y0: text.box.y0 + iy, y1: text.box.y1 - iy };
  }
  const stats = regionStats(gray, text.found ? text.box : undefined, cfg.light.glareLevel);

  const tiny = downscale(gray, Math.max(1, Math.floor(w / 40)));
  return {
    metrics: {
      text,
      sharpness: laplacianVariance(gray, region),
      meanBrightness: stats.mean,
      glareFrac: stats.glare,
      motion: motion(prevTiny, tiny),
    },
    tiny,
  };
}

/** Text block and gutter of a finished photo, in the photo's own pixels. */
export function locateInPhoto(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, cfg: Config): TextInfo {
  const gray = toGray(rgba, w, h);
  const f = Math.max(1, Math.round(w / cfg.text.detectWidth));
  return scaleText(detectText(downscale(gray, f), cfg), f);
}
