import { CONFIG } from "./config";

export type Lang = "en" | "si";

/** "si" when most letters are Sinhala, otherwise "en". */
export function detectScriptLang(text: string): Lang {
  const sinhala = (text.match(/[඀-෿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return sinhala > latin ? "si" : "en";
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve([]);
    const have = speechSynthesis.getVoices();
    if (have.length) return resolve(have);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    window.setTimeout(done, 1500); // some browsers never fire the event when there are no voices
  });
}

export const voicesFor = (voices: SpeechSynthesisVoice[], lang: Lang) =>
  voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang));

/** Splits text into pieces short enough for speech engines, breaking at sentence ends and line breaks. */
export function chunkText(text: string, max: number): string[] {
  const pieces = text
    .replace(/\r/g, "")
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let cur = "";
  const push = (s: string) => {
    while (s.length > max) {
      let cut = s.lastIndexOf(" ", max);
      if (cut < max / 2) cut = max;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  };
  for (const p of pieces) {
    if ((cur + " " + p).trim().length <= max) cur = (cur + " " + p).trim();
    else {
      if (cur) push(cur);
      cur = p;
    }
  }
  if (cur) push(cur);
  return out;
}

/** Spoken guidance: the same hint is not repeated within a few seconds, and hints are spaced out. */
export class Announcer {
  enabled = true;
  onSpoken: (text: string) => void = () => {};
  private lastText = "";
  private lastAt = 0;
  private lastAnyAt = 0;

  hint(text: string): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < CONFIG.speech.repeatGapMs) return;
    if (now - this.lastAnyAt < CONFIG.speech.minGapMs) return;
    this.lastText = text;
    this.lastAt = this.lastAnyAt = now;
    this.speak(text);
    this.onSpoken(text);
  }

  /** Always spoken, interrupting any hint. */
  say(text: string): void {
    this.lastText = text;
    this.lastAt = this.lastAnyAt = performance.now();
    this.speak(text);
  }

  private speak(text: string): void {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en";
    speechSynthesis.speak(u);
  }
}

export interface ReadOptions {
  voice?: SpeechSynthesisVoice;
  rate: number;
  lang: Lang;
}

/** Reads long text with the browser's own voices, one piece at a time. */
export class BrowserReader {
  private token = 0;

  speak(text: string, o: ReadOptions, onEnd: () => void): void {
    this.stop();
    const my = ++this.token;
    const parts = chunkText(text, 180);
    if (!parts.length || !("speechSynthesis" in window)) return onEnd();
    const next = (i: number) => {
      if (my !== this.token) return;
      if (i >= parts.length) return onEnd();
      const u = new SpeechSynthesisUtterance(parts[i]);
      if (o.voice) u.voice = o.voice;
      u.lang = o.voice?.lang ?? o.lang;
      u.rate = o.rate;
      u.onend = () => next(i + 1);
      u.onerror = () => {
        if (my === this.token) onEnd();
      };
      speechSynthesis.speak(u);
    };
    next(0);
  }

  stop(): void {
    this.token++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}

/**
 * Optional online voice (see api/tts.ts). Only used when the person presses the button,
 * because it sends the text to an online speech service.
 */
export class OnlineReader {
  private token = 0;
  private audio: HTMLAudioElement | null = null;

  async speak(text: string, lang: Lang, rate: number, onEnd: (error?: string) => void): Promise<void> {
    this.stop();
    const my = ++this.token;
    const parts = chunkText(text, 250);
    try {
      for (const part of parts) {
        const r = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: part, lang }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
        const url = URL.createObjectURL(await r.blob());
        if (my !== this.token) return URL.revokeObjectURL(url);
        await new Promise<void>((resolve, reject) => {
          const a = new Audio(url);
          this.audio = a;
          a.playbackRate = rate;
          a.onended = () => resolve();
          a.onerror = () => reject(new Error("audio could not be played"));
          void a.play().catch(reject);
        }).finally(() => URL.revokeObjectURL(url));
        if (my !== this.token) return;
      }
      onEnd();
    } catch (e) {
      if (my === this.token) onEnd((e as Error).message);
    }
  }

  stop(): void {
    this.token++;
    this.audio?.pause();
    this.audio = null;
  }
}
