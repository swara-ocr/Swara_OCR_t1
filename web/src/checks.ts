import type { Config } from "./config";

export interface Gray {
  data: Uint8ClampedArray | Uint8Array;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PageInfo {
  found: boolean;
  corners: Point[]; // TL, TR, BR, BL; at detection resolution inside detectPage, analysis-frame pixels from analyse
  areaFrac: number;
  solidity: number;
  centreDx: number; // -0.5..0.5, positive = page centre is right of frame centre
  centreDy: number; // positive = below
  tiltDeg: number;
  touches: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

export interface Metrics {
  page: PageInfo;
  sharpness: number;
  meanBrightness: number;
  glareFrac: number;
  motion: number; // mean abs difference to previous tiny frame, 255 if unknown
}

export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return { data, w, h };
}

export function downscale(g: Gray, factor: number): Gray {
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

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Variance of the Laplacian, optionally limited to a region (so page edges do not hide blur). */
export function laplacianVariance(g: Gray, region?: Rect): number {
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

export function meanBrightness(g: Gray): number {
  let s = 0;
  for (let i = 0; i < g.data.length; i++) s += g.data[i];
  return s / g.data.length;
}

export function glareFraction(g: Gray, level: number, mask?: Uint8Array): number {
  let hit = 0;
  let n = 0;
  for (let i = 0; i < g.data.length; i++) {
    if (mask && !mask[i]) continue;
    n++;
    if (g.data[i] >= level) hit++;
  }
  return n === 0 ? 0 : hit / n;
}

export function motion(a: Gray | null, b: Gray): number {
  if (!a || a.data.length !== b.data.length) return 255;
  let s = 0;
  for (let i = 0; i < b.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / b.data.length;
}

const NO_PAGE: PageInfo = {
  found: false,
  corners: [],
  areaFrac: 0,
  solidity: 0,
  centreDx: 0,
  centreDy: 0,
  tiltDeg: 0,
  touches: { left: false, right: false, top: false, bottom: false },
};

function polygonArea(p: Point[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
}

export interface PageResult {
  info: PageInfo;
  mask: Uint8Array | null; // page mask at the detection resolution
  maskW: number;
  maskH: number;
}

/** Finds the largest light region (the page), then its four extreme corners. Works at g's resolution. */
export function detectPage(g: Gray, cfg: Config): PageResult {
  const { w, h } = g;
  const blurred = boxBlur(boxBlur(g));
  const t = otsu(blurred);
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < fg.length; i++) fg[i] = blurred.data[i] > t ? 1 : 0;

  // largest 4-connected component of light pixels
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best = 0;
  let bestId = 0;
  let id = 0;
  for (let s = 0; s < fg.length; s++) {
    if (!fg[s] || label[s]) continue;
    id++;
    let count = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && fg[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && fg[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && fg[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && fg[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
    }
    if (count > best) { best = count; bestId = id; }
  }
  if (best < w * h * cfg.page.foundAreaFrac * 0.5) return { info: NO_PAGE, mask: null, maskW: w, maskH: h };

  // page mask = the component plus any holes inside it (text, pictures)
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = label[i] === bestId ? 1 : 0;
  const outside = new Uint8Array(w * h);
  const seeds: number[] = [];
  for (let x = 0; x < w; x++) { seeds.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seeds.push(y * w, y * w + w - 1); }
  for (const s of seeds) {
    if (mask[s] || outside[s]) continue;
    outside[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && !mask[i - 1] && !outside[i - 1]) { outside[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !mask[i + 1] && !outside[i + 1]) { outside[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !mask[i - w] && !outside[i - w]) { outside[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !mask[i + w] && !outside[i + w]) { outside[i + w] = 1; stack.push(i + w); }
    }
  }
  let area = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!outside[i]) { mask[i] = 1; area++; }
  }

  // extreme corners
  let tl = { x: 0, y: 0, v: Infinity };
  let br = { x: 0, y: 0, v: -Infinity };
  let tr = { x: 0, y: 0, v: -Infinity };
  let bl = { x: 0, y: 0, v: Infinity };
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const s = x + y;
      const d = x - y;
      if (s < tl.v) tl = { x, y, v: s };
      if (s > br.v) br = { x, y, v: s };
      if (d > tr.v) tr = { x, y, v: d };
      if (d < bl.v) bl = { x, y, v: d };
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const corners: Point[] = [tl, tr, br, bl].map((p) => ({ x: p.x, y: p.y }));
  const quad = polygonArea(corners);
  const solidity = quad > 0 ? Math.min(1, area / quad) : 0;
  const areaFrac = quad / (w * h);
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const topAngle = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
  const botAngle = Math.atan2(corners[2].y - corners[3].y, corners[2].x - corners[3].x);
  let tilt = (((topAngle + botAngle) / 2) * 180) / Math.PI;
  while (tilt > 45) tilt -= 90;
  while (tilt < -45) tilt += 90;

  const mx = Math.max(1, Math.round(w * cfg.page.edgeMarginFrac));
  const my = Math.max(1, Math.round(h * cfg.page.edgeMarginFrac));
  const info: PageInfo = {
    found: areaFrac >= cfg.page.foundAreaFrac && solidity >= cfg.page.minSolidity,
    corners,
    areaFrac,
    solidity,
    centreDx: cx / w - 0.5,
    centreDy: cy / h - 0.5,
    tiltDeg: tilt,
    touches: {
      left: minX <= mx,
      right: maxX >= w - 1 - mx,
      top: minY <= my,
      bottom: maxY >= h - 1 - my,
    },
  };
  return { info, mask, maskW: w, maskH: h };
}

export interface Analysis {
  metrics: Metrics;
  tiny: Gray; // 40-pixel-wide frame, kept for the next call's motion estimate
}

/** Runs every live check on one RGBA frame (already downscaled to the analysis size). */
export function analyse(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, prevTiny: Gray | null, cfg: Config): Analysis {
  const gray = toGray(rgba, w, h);
  const f = Math.max(1, Math.round(w / 160)); // page detection runs on a frame about 160 pixels wide
  const half = downscale(gray, f);
  const { info, mask } = detectPage(half, cfg);

  let bright: number;
  let glare: number;
  if (info.found && mask) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < half.data.length; i++) {
      if (mask[i]) { s += half.data[i]; n++; }
    }
    bright = n ? s / n : meanBrightness(half);
    glare = glareFraction(half, cfg.light.glareLevel, mask);
  } else {
    bright = meanBrightness(half);
    glare = glareFraction(half, cfg.light.glareLevel);
  }

  // measure sharpness on the middle of the page, where the text is
  let region: Rect | undefined;
  if (info.found) {
    const xs = info.corners.map((c) => c.x * f);
    const ys = info.corners.map((c) => c.y * f);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const ix = (x1 - x0) * 0.2;
    const iy = (y1 - y0) * 0.2;
    region = { x0: x0 + ix, x1: x1 - ix, y0: y0 + iy, y1: y1 - iy };
  }

  info.corners = info.corners.map((c) => ({ x: c.x * f, y: c.y * f })); // report corners in analysis-frame pixels
  const tiny = downscale(gray, Math.max(1, Math.floor(w / 40)));
  return {
    metrics: {
      page: info,
      sharpness: laplacianVariance(gray, region),
      meanBrightness: bright,
      glareFrac: glare,
      motion: motion(prevTiny, tiny),
    },
    tiny,
  };
}
