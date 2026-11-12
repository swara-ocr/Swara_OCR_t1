// All tunable values live here. See README.md ("Tuning the thresholds").
export const CONFIG = {
  analysis: {
    fps: 8, // live checks per second (5 to 10)
    width: 640, // analysis frame width in pixels; sharpness is measured at this size
  },
  text: {
    detectWidth: 320, // text detection runs on a frame about this wide
    paperErode: 2, // pixels pulled in from the page edge so the edge is not read as text
    smallRegionFrac: 0.01, // dark regions at the frame edge smaller than this share are letters, not background
    minPaperFrac: 0.05, // light area needed before looking for text
    windowRadius: 8, // adaptive threshold: radius of the local average
    contrast: 12, // ink is this much darker than its local average (0..255)
    minLocalMean: 60, // ignore very dark surroundings
    joinX: 5, // morphology: letters and words are joined into lines across this many pixels
    joinY: 1, // ... and lines into blocks across this many
    minRowFrac: 0.02, // a row counts as text when this share of its width is ink
    minRuns: 1, // separate text bands needed (dense pages merge into one band)
    minInkFrac: 0.02, // share of ink pixels inside the text block
    cutShare: 0.2, // text counts as cut off when this share of lines reach the frame edge
  },
  framing: {
    foundAreaFrac: 0.04, // text block smaller than this share of the frame is not reported at all
    minAreaFrac: 0.25, // text block must fill at least this share of the frame
    maxWidthFrac: 0.97, // wider than this is too close
    maxCentreOffset: 0.12, // allowed offset of the text block centre, as a share of the frame
    edgeMarginFrac: 0.015, // text closer than this to the frame edge counts as cut off
  },
  tilt: {
    maxDegrees: 5, // text-line angle beyond this triggers "Straighten the page"
    searchDegrees: 15, // angles searched either side of level
    minPeakContrast: 0.08, // how clearly lines must stand out before the angle is trusted
  },
  gutter: {
    minAspect: 1.05, // text block width / height; a taller block is one page
    searchFrom: 0.35, // gutter is looked for between these shares of the block width
    searchTo: 0.65,
    emptyFrac: 0.25, // a column is empty when its ink is below this share of the median column
    minBandFrac: 0.02, // empty band must be at least this share of the block width
    shadowDepth: 0.07, // fold shadow must be this much darker than both sides
    shadowSideFrac: 0.1, // ... compared at this share of the block width either side
    minConfidence: 0.5, // 0.5 = band or shadow alone, 1 = both agree
  },
  sharpness: {
    minLaplacianVariance: 100, // variance of the Laplacian over the text block
  },
  light: {
    minMeanBrightness: 70, // 0..255, below this is "too dark"
    veryDarkMean: 30, // when no text is found and the whole frame is darker than this, say "too dark" instead of "find the page"
    maxMeanBrightness: 235, // above this is "too bright"
    glareLevel: 250, // a pixel at or above this counts as blown out
    maxGlareFrac: 0.06, // share of blown-out pixels in the text block that triggers "reduce glare"
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
    minGapMs: 3000, // at most one guidance phrase this often; phrases are only spoken when the state changes
    defaultRate: 1,
    defaultPitch: 1,
  },
  tones: {
    intervalMs: 450, // gap between guidance tones
    minHz: 300, // pitch when nothing is right
    maxHz: 900, // pitch when everything is right
    volume: 0.06,
  },
  vibration: {
    state: [15], // framing state changed
    ready: [40, 40, 40], // all checks passed
    captured: [120], // photo taken
    done: [60, 60, 60], // finished reading
    error: [250, 120, 250],
  },
  ocr: {
    maxSide: 2000, // each crop is scaled so its long side is at most this before OCR
    cropPadFrac: 0.02, // padding around the text block when cropping, as a share of the photo size
  },
  features: {
    // Optional online voice. Off unless the build sets VITE_TTS_FALLBACK=1 (see README).
    ttsFallback: import.meta.env?.VITE_TTS_FALLBACK === "1",
  },
};

export type Config = typeof CONFIG;
