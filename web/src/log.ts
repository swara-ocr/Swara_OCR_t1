const KEY = "tabletop-reader-attempts-v1";

export type Rating = "good_first_try" | "needed_help" | "";
export type SplitMark = "right" | "wrong" | "";

export interface Attempt {
  id: number;
  time: string; // ISO time of capture
  condition: string; // free label chosen by the tester: bright, dim, tilted, glare, other
  mode: string; // phone or webcam
  secondsToCapture: number;
  hintCount: number;
  hints: string[];
  capture: "auto" | "manual";
  ocrLangRequested: string;
  ocrLangUsed: string;
  ocrConfidence: number;
  ocrSeconds: number;
  chars: number;
  rating: Rating;
  layoutSetting: string; // single (one page) or book (open book), as set by the person
  decision: string; // single or spread, as decided from the photo
  gutterFound: boolean;
  gutterX: number; // photo pixels, 0 when none
  pagesRead: string; // page, left, right or both
  splitMark: SplitMark; // tester's verdict on the split
}

export function loadAttempts(): Attempt[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(all: Attempt[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage can be blocked (private window); the page still works without a log
  }
}

export function addAttempt(a: Omit<Attempt, "id">): Attempt {
  const all = loadAttempts();
  const full = { ...a, id: (all.at(-1)?.id ?? 0) + 1 };
  all.push(full);
  save(all);
  return full;
}

export function updateAttempt(id: number, patch: Partial<Attempt>): void {
  const all = loadAttempts();
  const i = all.findIndex((a) => a.id === id);
  if (i >= 0) {
    all[i] = { ...all[i], ...patch };
    save(all);
  }
}

const COLUMNS: (keyof Attempt)[] = [
  "id", "time", "condition", "mode", "secondsToCapture", "hintCount", "hints", "capture",
  "ocrLangRequested", "ocrLangUsed", "ocrConfidence", "ocrSeconds", "chars", "rating",
  "layoutSetting", "decision", "gutterFound", "gutterX", "pagesRead", "splitMark",
];

export function toCsv(all: Attempt[]): string {
  const cell = (v: unknown) => {
    const s = Array.isArray(v) ? v.join(" | ") : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [COLUMNS.join(","), ...all.map((a) => COLUMNS.map((c) => cell(a[c])).join(","))].join("\n");
}
