import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { analyse, boxBlur, type Gray } from "../src/checks";
import { evaluate } from "../src/guidance";

const W = 320;
const H = 240;

interface Opts {
  cx?: number; cy?: number; pw?: number; ph?: number; angle?: number;
  page?: number; bg?: number; blur?: number; glare?: number; // glare = share of page area, as a bright patch
}

/** Dark table with a light page covered in horizontal text-like stripes. */
function frame(o: Opts = {}): Uint8ClampedArray {
  const { cx = W / 2, cy = H / 2, pw = 230, ph = 180, angle = 0, page = 225, bg = 35, blur = 0, glare = 0 } = o;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const g = new Uint8ClampedArray(W * H);
  const glareHalf = glare > 0 ? Math.sqrt(glare * pw * ph) / 2 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      let val = bg;
      if (Math.abs(u) <= pw / 2 && Math.abs(v) <= ph / 2) {
        val = Math.floor((v + ph) / 3) % 2 === 0 && Math.abs(u) < pw / 2 - 12 && Math.abs(v) < ph / 2 - 12 ? page - 150 : page;
        if (glare > 0 && Math.abs(u - pw / 4) < glareHalf && Math.abs(v - ph / 4) < glareHalf) val = 255;
      }
      g[y * W + x] = val;
    }
  }
  let gray: Gray = { data: g, w: W, h: H };
  for (let i = 0; i < blur; i++) gray = boxBlur(gray);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray.data[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

const run = (o?: Opts, still = 2000, mode: "phone" | "webcam" = "phone") => {
  const a = analyse(frame(o), W, H, null, CONFIG);
  return { m: a.metrics, e: evaluate(a.metrics, CONFIG, mode, still) };
};

describe("live checks", () => {
  it("accepts a well framed, sharp, level page", () => {
    const { m, e } = run();
    expect(m.page.found).toBe(true);
    expect(m.page.areaFrac).toBeGreaterThan(0.45);
    expect(e.failing).toEqual([]);
    expect(e.status).toBe("green");
  });

  it("reports no page on an empty scene", () => {
    const { e } = run({ pw: 0, ph: 0 });
    expect(e.failing).toContain("page");
    expect(e.hint).toMatch(/cannot see the page/i);
    expect(e.status).toBe("red");
  });

  it("asks to move closer when the page is small", () => {
    const { e } = run({ pw: 130, ph: 100 });
    expect(e.hint).toMatch(/closer/i);
  });

  it("asks to move further when the page fills the frame", () => {
    const { e } = run({ pw: 330, ph: 250 });
    expect(e.hint).toMatch(/further|cut off/i);
  });

  it("gives a direction hint when the page is off centre", () => {
    const right = run({ cx: 200, pw: 215, ph: 175 });
    expect(right.e.hint).toMatch(/right/i); // phone: move phone right, toward the page
    const left = run({ cx: 120, pw: 215, ph: 175 });
    expect(left.e.hint).toMatch(/left/i);
    const low = run({ cy: 155, pw: 220, ph: 160 });
    expect(low.e.hint).toMatch(/down/i);
  });

  it("flips left and right wording for a mirrored webcam", () => {
    const { e } = run({ cx: 200, pw: 215, ph: 175 }, 2000, "webcam");
    expect(e.hint).toMatch(/page right/i); // page sits left in the mirrored preview
  });

  it("says the page is cut off when it leaves the frame", () => {
    const { e } = run({ cx: 230, pw: 230, ph: 180 });
    expect(e.hint).toMatch(/cut off/i);
  });

  it("estimates tilt and asks to straighten", () => {
    const { m, e } = run({ angle: 14, pw: 220, ph: 170 });
    expect(Math.abs(m.page.tiltDeg - 14)).toBeLessThan(4);
    expect(e.failing).toContain("tilt");
    expect(e.hint).toMatch(/straighten/i);
    const level = run({ angle: 3, pw: 220, ph: 170 });
    expect(level.e.failing).not.toContain("tilt");
  });

  it("detects blur", () => {
    const sharp = run();
    const blurred = run({ blur: 6 });
    expect(blurred.m.sharpness).toBeLessThan(sharp.m.sharpness / 4);
    expect(blurred.e.failing).toContain("sharp");
    expect(blurred.e.hint).toMatch(/blurry/i);
  });

  it("detects a dark scene", () => {
    const { e } = run({ page: 100, bg: 15 }); // stripes clamp to 0, so the page mean is low
    expect(e.failing).toContain("light");
    expect(e.hint).toMatch(/dark/i);
  });

  it("detects glare", () => {
    const { m, e } = run({ glare: 0.15 });
    expect(m.glareFrac).toBeGreaterThan(CONFIG.light.maxGlareFrac);
    expect(e.hint).toMatch(/glare/i);
  });

  it("measures stability between frames", () => {
    const first = analyse(frame(), W, H, null, CONFIG);
    const same = analyse(frame(), W, H, first.tiny, CONFIG);
    const moved = analyse(frame({ cx: 170 }), W, H, first.tiny, CONFIG);
    expect(same.metrics.motion).toBeLessThan(CONFIG.stability.maxMeanDiff);
    expect(moved.metrics.motion).toBeGreaterThan(CONFIG.stability.maxMeanDiff);
    expect(evaluate(same.metrics, CONFIG, "phone", 200).failing).toContain("still");
  });

  it("runs fast enough for 8 checks per second", () => {
    const f = frame();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) analyse(f, W, H, null, CONFIG);
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(60);
  });
});
