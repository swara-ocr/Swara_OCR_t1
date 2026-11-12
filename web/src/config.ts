// All tunable values live here. See README.md ("Tuning the thresholds").
export const CONFIG = {
  analysis: {
    fps: 8, // live checks per second (5 to 10)
    width: 640, // analysis frame width in pixels; height follows the video aspect ratio (sharpness is measured at this size)
  },
  page: {
    minAreaFrac: 0.28, // page must fill at least this share of the frame (a portrait page in a landscape frame tops out near 0.35)
    maxAreaFrac: 0.92, // above this the page is too close
    foundAreaFrac: 0.04, // below this no page is reported at all
    minSolidity: 0.75, // blob area / corner-quad area; low values mean "not a page-like shape"
    maxCentreOffset: 0.12, // allowed centre offset, as a share of frame width / height
    edgeMarginFrac: 0.015, // corners closer than this to the frame edge count as cut off
  },
  tilt: {
    maxDegrees: 6, // page angle beyond this triggers "straighten"
  },
  sharpness: {
    minLaplacianVariance: 100, // variance of the Laplacian on the grey analysis frame
  },
  light: {
    minMeanBrightness: 70, // 0..255, below this is "too dark"
    maxMeanBrightness: 235, // above this is "too bright"
    glareLevel: 250, // a pixel at or above this counts as blown out
    maxGlareFrac: 0.06, // share of blown-out pixels inside the page that triggers "reduce glare"
  },
  stability: {
    maxMeanDiff: 3.0, // mean absolute difference (0..255) between consecutive tiny frames
    holdMs: 1000, // frame must stay still this long
  },
  capture: {
    autoHoldMs: 1000, // all checks must pass for this long before auto-capture
    idealWidth: 1920,
    idealHeight: 1080,
  },
  speech: {
    repeatGapMs: 3000, // same hint is not spoken again within this time
    minGapMs: 1500, // any two hints are at least this far apart
    defaultRate: 1,
  },
  beep: {
    slowMs: 1200, // beep interval when nothing is right
    fastMs: 180, // beep interval when everything is right
    volume: 0.05,
    frequency: 660,
  },
  ocr: {
    maxSide: 2000, // photo is scaled so its long side is at most this before OCR
  },
  features: {
    // Optional online Sinhala voice. Off unless the build sets VITE_TTS_FALLBACK=1.
    ttsFallback: import.meta.env?.VITE_TTS_FALLBACK === "1",
  },
};

export type Config = typeof CONFIG;
