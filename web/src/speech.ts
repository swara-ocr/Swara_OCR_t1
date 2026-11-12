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

/**
 * Spoken guidance. A phrase is spoken only when the state has changed since the last phrase,
 * and never more than one phrase every few seconds. The latest state wins.
 */
export class Phraser {
  enabled = true;
  onSpoken: (text: string) => void = () => {};
  private spokenKey = "";
  private lastAt = -Infinity;
  voice: SpeechSynthesisVoice | undefined;
  rate = 1;
  pitch = 1;

  /** Call on every check; speaks when the state changed and the gap has passed. */
  update(key: string, text: string): void {
    if (key === this.spokenKey) return;
    const now = performance.now();
    if (now - this.lastAt < CONFIG.speech.minGapMs) return;
    this.spokenKey = key;
    this.lastAt = now;
    this.speak(text); // does nothing when the app voice is off
    this.onSpoken(text); // always: the page shows the phrase for screen readers when the app voice is off
  }

  /** Forget what was said, e.g. when the camera restarts. */
  reset(): void {
    this.spokenKey = "";
    this.lastAt = performance.now(); // the announcement that triggered the reset has just been spoken
  }

  /** Interrupts any phrase. Used for state announcements. */
  say(text: string): void {
    this.lastAt = performance.now();
    this.speak(text);
  }

  stop(): void {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  private speak(text: string): void {
    if (!this.enabled || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en";
    u.rate = Math.min(1.6, this.rate + 0.1); // short phrases a little quicker
    u.pitch = this.pitch;
    speechSynthesis.speak(u);
  }
}

export interface ReadOptions {
  voice?: SpeechSynthesisVoice;
  rate: number;
  pitch: number;
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
    const next = (i: number): void => {
      if (my !== this.token) return;
      if (i >= parts.length) return onEnd();
      const u = new SpeechSynthesisUtterance(parts[i]);
      if (o.voice) u.voice = o.voice;
      u.lang = o.voice?.lang ?? o.lang;
      u.rate = o.rate;
      u.pitch = o.pitch;
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

  async speak(text: string, lang: Lang, voice: string, rate: number, onEnd: (error?: string) => void): Promise<void> {
    this.stop();
    const my = ++this.token;
    const parts = chunkText(text, 250);
    try {
      for (const part of parts) {
        const r = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: part, lang, voice }),
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

/** Sample sentence for previewing a voice. */
export const SAMPLE: Record<Lang, string> = {
  en: "This is how this voice sounds.",
  si: "මෙය මෙම හඬේ නියැදියකි.",
};

export function previewVoice(voice: SpeechSynthesisVoice | undefined, lang: Lang, rate: number, pitch: number): void {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(SAMPLE[lang]);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? lang;
  u.rate = rate;
  u.pitch = pitch;
  speechSynthesis.speak(u);
}

export interface ReadItem {
  text: string;
  lang: Lang;
  label?: boolean; // short announcement such as "Left page", spoken with the English voice
}

export interface Narration {
  voices: Record<Lang, SpeechSynthesisVoice | undefined>;
  rate: number;
  pitch: number;
  online: { enabled: boolean; voice: string }; // used only for Sinhala without a device voice, and only when the person asked for it
}

/** Reads a list of items in order: labels, then text, using device voices or, on request, the online voice. */
export class Narrator {
  private token = 0;
  private browser = new BrowserReader();
  private online = new OnlineReader();

  play(items: ReadItem[], n: Narration, onItem: (i: number) => void, onEnd: (error?: string) => void): void {
    this.stop();
    const my = ++this.token;
    const next = (i: number): void => {
      if (my !== this.token) return;
      if (i >= items.length) return onEnd();
      const it = items[i];
      onItem(i);
      const done = (err?: string): void => (err ? onEnd(err) : next(i + 1));
      if (!it.text.trim()) return done();
      const lang: Lang = it.label ? "en" : it.lang;
      const voice = n.voices[lang];
      if (voice || (lang === "en" && !n.online.enabled)) {
        this.browser.speak(it.text, { voice, rate: n.rate, pitch: n.pitch, lang }, () => done());
      } else if (lang === "si" && n.online.enabled) {
        void this.online.speak(it.text, "si", n.online.voice, n.rate, (e) => done(e));
      } else {
        done(`No ${lang === "si" ? "Sinhala" : "English"} voice is available.`);
      }
    };
    next(0);
  }

  stop(): void {
    this.token++;
    this.browser.stop();
    this.online.stop();
  }
}
