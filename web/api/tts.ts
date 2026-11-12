// Optional online voice, used only when the browser has no voice for the text's language.
// Unofficial routes (Microsoft Edge read-aloud and Google Translate speech): fine for testing,
// unreliable for production. Disabled unless the environment variable TTS_FALLBACK=1 is set.
import type { IncomingMessage, ServerResponse } from "node:http";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const VOICES: Record<string, string> = {
  si: "si-LK-SameeraNeural",
  en: "en-US-JennyNeural",
};
const MAX_CHARS = 300;

type Req = IncomingMessage & { body?: unknown };

async function viaEdge(text: string, lang: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 15000 });
  try {
    await tts.setMetadata(VOICES[lang], OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    for await (const c of audioStream) chunks.push(Buffer.from(c));
    const out = Buffer.concat(chunks);
    if (!out.length) throw new Error("empty audio from Edge");
    return out;
  } finally {
    tts.close();
  }
}

async function viaGoogle(text: string, lang: string): Promise<Buffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Google TTS HTTP ${r.status}`);
  const out = Buffer.from(await r.arrayBuffer());
  if (!out.length) throw new Error("empty audio from Google");
  return out;
}

function send(res: ServerResponse, code: number, body: string) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: body }));
}

async function readBody(req: Req): Promise<{ text?: string; lang?: string }> {
  if (req.body && typeof req.body === "object") return req.body as { text?: string; lang?: string };
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export default async function handler(req: Req, res: ServerResponse) {
  if (process.env.TTS_FALLBACK !== "1") return send(res, 404, "online voice is turned off");
  if (req.method !== "POST") return send(res, 405, "use POST");
  let text: string;
  let lang: string;
  try {
    const body = await readBody(req);
    text = String(body.text ?? "").trim();
    lang = body.lang === "en" ? "en" : "si";
  } catch {
    return send(res, 400, "bad request");
  }
  if (!text) return send(res, 400, "no text");
  if (text.length > MAX_CHARS) return send(res, 413, `send at most ${MAX_CHARS} characters at a time`);

  let audio: Buffer;
  let source = "edge";
  try {
    audio = await viaEdge(text, lang);
  } catch {
    try {
      source = "google";
      audio = await viaGoogle(text, lang);
    } catch (e) {
      return send(res, 502, `online voice failed: ${(e as Error).message}`);
    }
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-store"); // text must not be cached
  res.setHeader("X-Tts-Source", source);
  res.end(audio);
}
