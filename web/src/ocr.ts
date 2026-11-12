import { createWorker, type Worker } from "tesseract.js";
import { CONFIG } from "./config";

export type OcrChoice = "auto" | "eng" | "sin";

export interface OcrResult {
  text: string;
  confidence: number;
  langUsed: "eng" | "sin";
  seconds: number;
}

const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
const workers = new Map<string, Promise<Worker>>();
let onProgress: (message: string) => void = () => {};

function getWorker(lang: "eng" | "sin"): Promise<Worker> {
  let w = workers.get(lang);
  if (!w) {
    w = createWorker(lang, 1, {
      workerPath: `${base}tesseract/worker.min.js`,
      corePath: `${base}tesseract`,
      langPath: `${base}tessdata`, // models are served from this site, not a CDN
      gzip: false,
      logger: (m) => {
        if (m.status === "recognizing text") onProgress(`Reading ${Math.round(m.progress * 100)}%`);
        else if (m.status) onProgress(`Reading: ${m.status}`);
      },
    });
    workers.set(lang, w);
  }
  return w;
}

function scaled(src: HTMLCanvasElement): HTMLCanvasElement {
  const long = Math.max(src.width, src.height);
  if (long <= CONFIG.ocr.maxSide) return src;
  const k = CONFIG.ocr.maxSide / long;
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function run(img: HTMLCanvasElement, lang: "eng" | "sin") {
  const w = await getWorker(lang);
  const { data } = await w.recognize(img);
  return { text: data.text.trim(), confidence: data.confidence };
}

/** Reads the photo. "auto" tries English and Sinhala and keeps the more confident result. */
export async function recognise(photo: HTMLCanvasElement, choice: OcrChoice, progress: (m: string) => void): Promise<OcrResult> {
  onProgress = progress;
  const t0 = performance.now();
  const img = scaled(photo);
  const langs: ("eng" | "sin")[] = choice === "auto" ? ["eng", "sin"] : [choice];
  let best: OcrResult | null = null;
  for (const lang of langs) {
    progress(langs.length > 1 ? `Reading, trying ${lang === "eng" ? "English" : "Sinhala"}` : "Reading");
    const r = await run(img, lang);
    if (!best || r.confidence > best.confidence) best = { ...r, langUsed: lang, seconds: 0 };
  }
  best!.seconds = (performance.now() - t0) / 1000;
  return best!;
}
