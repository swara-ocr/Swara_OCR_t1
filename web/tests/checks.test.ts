import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { analyse, boxBlur, toGray, type Gray } from "../src/checks";
import { evaluate, PHRASES, type Mode } from "../src/guidance";

interface Img { rgba: Uint8ClampedArray; w: number; h: number }
const TABLE = [46, 41, 38];
const truth = JSON.parse(readFileSync(new URL("./fixtures/truth.json", import.meta.url), "utf8"));

function load(name: string): Img {
  const png = PNG.sync.read(readFileSync(new URL(`./fixtures/${name}.png`, import.meta.url)));
  return { rgba: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
}

function fromGray(g: Gray): Img {
  const rgba = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g.data[i]; rgba[i * 4 + 3] = 255; }
  return { rgba, w: g.w, h: g.h };
}

const blur = (im: Img, passes: number): Img => {
  let g = toGray(im.rgba, im.w, im.h);
  for (let i = 0; i < passes; i++) g = boxBlur(g);
  return fromGray(g);
};

const darken = (im: Img, k: number): Img => ({ ...im, rgba: im.rgba.map((v, i) => (i % 4 === 3 ? v : v * k)) as unknown as Uint8ClampedArray });

function shift(im: Img, dx: number, dy = 0): Img {
  const out = new Uint8ClampedArray(im.rgba.length);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const sx = x - dx, sy = y - dy, o = (y * im.w + x) * 4;
    const inside = sx >= 0 && sx < im.w && sy >= 0 && sy < im.h;
    for (let c = 0; c < 3; c++) out[o + c] = inside ? im.rgba[(sy * im.w + sx) * 4 + c] : TABLE[c];
    out[o + 3] = 255;
  }
  return { ...im, rgba: out };
}

function scaleDown(im: Img, k: number): Img {
  const out = new Uint8ClampedArray(im.rgba.length);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const sx = Math.round((x - im.w / 2) / k + im.w / 2), sy = Math.round((y - im.h / 2) / k + im.h / 2);
    const inside = sx >= 0 && sx < im.w && sy >= 0 && sy < im.h, o = (y * im.w + x) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = inside ? im.rgba[(sy * im.w + sx) * 4 + c] : TABLE[c];
    out[o + 3] = 255;
  }
  return { ...im, rgba: out };
}

function glarePatch(im: Img, x0: number, y0: number, x1: number, y1: number): Img {
  const rgba = new Uint8ClampedArray(im.rgba);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * im.w + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; }
  return { ...im, rgba };
}

const run = (im: Img, mode: Mode = "phone", still = 2000) => {
  const a = analyse(im.rgba, im.w, im.h, null, CONFIG);
  return { m: a.metrics, e: evaluate(a.metrics, CONFIG, mode, still) };
};

describe("single page", () => {
  it("is found, framed and accepted", () => {
    const { m, e } = run(load("single"));
    expect(m.text.found).toBe(true);
    expect(m.text.gutter.found).toBe(false); // portrait block: one page
    expect(e.failing).toEqual([]);
    expect(e.status).toBe("green");
  });

  it("reports no text on an empty table", () => {
    const { e } = run(shift(load("single"), 2000));
    expect(e.failing).toContain("text");
    expect(e.hint).toBe(PHRASES.noText);
    expect(e.status).toBe("red");
  });

  it("says the text is cut off when it runs past the edges", () => {
    const { m, e } = run(load("single_cut"));
    expect(m.text.touches.left && m.text.touches.right).toBe(true);
    expect(e.hint).toMatch(/back/i);
  });

  it("tells which way to move when the text is off centre", () => {
    const right = run(shift(load("single"), 110));
    expect(right.m.text.centreDx).toBeGreaterThan(CONFIG.framing.maxCentreOffset);
    expect(right.e.hint).toBe("Move phone right");
    expect(run(shift(load("single"), -110)).e.hint).toBe("Move phone left");
    expect(run(shift(load("single"), 110), "webcam").e.hint).toBe("Move page right"); // mirrored preview: it looks left, so move it right
  });

  it("asks to move closer when the text is small", () => {
    const { e } = run(scaleDown(load("single"), 0.6));
    expect(e.hint).toBe("Move phone closer");
  });

  it("measures the text-line angle", () => {
    const level = run(load("single"));
    expect(Math.abs(level.m.text.tiltDeg)).toBeLessThan(2);
    const tilted = run(load("single_tilt10"));
    expect(tilted.m.text.tiltReliable).toBe(true);
    expect(Math.abs(Math.abs(tilted.m.text.tiltDeg) - 10)).toBeLessThan(3);
    expect(tilted.e.failing).toContain("tilt");
    expect(tilted.e.hint).toBe(PHRASES.straighten);
  });

  it("detects blur, darkness and glare", () => {
    const sharp = run(load("single")).m.sharpness;
    const soft = run(blur(load("single"), 3));
    expect(soft.m.sharpness).toBeLessThan(sharp / 3);
    expect(soft.e.failing).toContain("sharp");
    expect(soft.e.hint).toBe(PHRASES.steady);

    const dark = run(darken(load("single"), 0.28));
    expect(dark.m.text.found).toBe(true);
    expect(dark.e.hint).toBe(PHRASES.dark);

    const g = run(glarePatch(load("single"), 220, 100, 420, 260));
    expect(g.m.glareFrac).toBeGreaterThan(CONFIG.light.maxGlareFrac);
    expect(g.e.hint).toBe(PHRASES.glare);
  });

  it("measures stability between frames", () => {
    const first = analyse(load("single").rgba, 640, 480, null, CONFIG);
    const same = analyse(load("single").rgba, 640, 480, first.tiny, CONFIG);
    const moved = analyse(shift(load("single"), 20).rgba, 640, 480, first.tiny, CONFIG);
    expect(same.metrics.motion).toBeLessThan(CONFIG.stability.maxMeanDiff);
    expect(moved.metrics.motion).toBeGreaterThan(CONFIG.stability.maxMeanDiff);
    expect(evaluate(same.metrics, CONFIG, "phone", 200).failing).toContain("still");
  });
});

describe("open book", () => {
  for (const name of ["spread_flat", "spread_shadow", "spread_tilt", "spread_si"]) {
    it(`finds the gutter in ${name}`, () => {
      const { m } = run(load(name));
      expect(m.text.found).toBe(true);
      expect(m.text.gutter.found).toBe(true);
      expect(Math.abs(m.text.gutter.x - truth[name].gutterX)).toBeLessThan(25); // any cut inside the empty gap loses no text
      expect(m.text.widthFrac / m.text.heightFrac).toBeGreaterThan(CONFIG.gutter.minAspect);
    });
  }

  it("accepts a well framed spread", () => {
    const { e } = run(load("spread_shadow"));
    expect(e.failing).toEqual([]);
  });

  it("does not invent a gutter on a single page", () => {
    for (const name of ["single", "single_tilt10"]) expect(run(load(name)).m.text.gutter.found).toBe(false);
  });
});

describe("speed and wording", () => {
  it("runs fast enough for 8 checks per second", () => {
    const im = load("spread_shadow");
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) analyse(im.rgba, im.w, im.h, null, CONFIG);
    expect((performance.now() - t0) / 10).toBeLessThan(80);
  });

  it("keeps every phrase under five words", () => {
    const phrases = [...Object.values(PHRASES)];
    for (const mode of ["phone", "webcam"] as Mode[]) {
      for (const im of [shift(load("single"), 110), shift(load("single"), -110), load("single_cut"), scaleDown(load("single"), 0.6), shift(load("single"), 0, 90), shift(load("single"), 0, -90)]) {
        phrases.push(run(im, mode).e.hint);
      }
    }
    for (const p of phrases) expect(p.split(/\s+/).length).toBeLessThan(5);
  });
});
