import { CONFIG } from "./config";

export type LayoutSetting = "single" | "book";
export type WhichPage = "both" | "left" | "right";

export interface Settings {
  layout: LayoutSetting; // one page, or an open book (two pages)
  which: WhichPage; // for an open book: which page to read
  ocr: "auto" | "eng" | "sin";
  appVoice: boolean; // speak instructions with the app's own voice (turn off to rely on a screen reader)
  tones: boolean;
  vibrate: boolean;
  autoRead: boolean; // start reading aloud as soon as the text is ready
  introDone: boolean;
  rate: number;
  pitch: number;
  voiceEn: string; // voiceURI, "" = browser default
  voiceSi: string;
  onlineVoice: "sameera" | "thilini";
}

const KEY = "tabletop-reader-settings-v1";

export const DEFAULTS: Settings = {
  layout: "single",
  which: "both",
  ocr: "auto",
  appVoice: true,
  tones: true,
  vibrate: true,
  autoRead: true,
  introDone: false,
  rate: CONFIG.speech.defaultRate,
  pitch: CONFIG.speech.defaultPitch,
  voiceEn: "",
  voiceSi: "",
  onlineVoice: "sameera",
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage can be blocked; settings then last only for this visit
  }
}
