import { CONFIG } from "./config";

let ctx: AudioContext | null = null;

/** Must be called from a click or key press so the browser lets us make sound. */
export function unlockAudio(): void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, ms: number, volume: number, type: OscillatorType = "sine", delayMs = 0) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + delayMs / 1000;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

/** A short tone at a steady rhythm whose pitch rises as the framing improves. */
export class ToneGuide {
  enabled = true;
  private timer: number | undefined;
  private score = 0;

  start(): void {
    this.stop();
    const tick = () => {
      if (this.enabled) {
        const hz = CONFIG.tones.minHz + this.score * (CONFIG.tones.maxHz - CONFIG.tones.minHz);
        tone(hz, 80, CONFIG.tones.volume);
      }
      this.timer = window.setTimeout(tick, CONFIG.tones.intervalMs);
    };
    tick();
  }

  setScore(score: number): void {
    this.score = Math.max(0, Math.min(1, score));
  }

  stop(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** Two quick rising tones: everything is right, hold still. */
export function readyChime(): void {
  tone(700, 90, 0.12);
  tone(1000, 120, 0.12, "sine", 110);
}

/** Short camera-shutter click. */
export function shutterSound(): void {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.35;
  src.connect(gain).connect(ctx.destination);
  src.start();
  tone(1200, 50, 0.12, "square");
}

/** Three falling tones: something went wrong. */
export function errorTone(): void {
  tone(500, 120, 0.12);
  tone(380, 120, 0.12, "sine", 140);
  tone(280, 200, 0.12, "sine", 280);
}

/** Vibration where the device supports it (most Android phones; not iPhone). */
export function buzz(pattern: number[], enabled: boolean): void {
  if (enabled && "vibrate" in navigator) navigator.vibrate(pattern);
}
