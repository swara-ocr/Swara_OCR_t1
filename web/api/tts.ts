// Optional online voice, used only when the browser has no voice for the text's language.
//
// Routes, tried in this order:
//   1. Azure Speech (official, needs your own key): only when AZURE_SPEECH_ENABLED=1 plus AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.
//   2. Microsoft Edge read-aloud, then Google Translate speech: unofficial, only when TTS_FALLBACK=1.
//      Fine for testing, unreliable for production.
// With none of these variables set the function answers 404 and nothing is sent anywhere.
import type { IncomingMessage, ServerResponse } from "node:http";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

const SI_VOICES: Record<string, string> = {
  sameera: "si-LK-SameeraNeural",
  thilini: "si-LK-ThiliniNeural",
};
const EN_VOICE = "en-US-JennyNeural";
const MAX_CHARS = 300;

type Req = IncomingMessage & { body?: unknown };

const azureOn = () =>
  process.env.AZURE_SPEECH_ENABLED === "1" && !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION;
const unofficialOn = () => process.env.TTS_FALLBACK === "1";

function voiceName(lang: string, voice: string): string {
  return lang === "en" ? EN_VOICE : SI_VOICES[voice] ?? SI_VOICES.sameera;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

async function viaAzure(text: string, lang: string, voice: string): Promise<Buffer> {
  const name = voiceName(lang, voice);
  const locale = name.split("-").slice(0, 2).join("-");
  const ssml = `<speak version="1.0" xml:lang="${locale}"><voice xml:lang="${locale}" name="${name}">${escapeXml(text)}</voice></speak>`;
  const r = await fetch(`https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "tabletop-reader",
    },
    body: ssml,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Azure Speech HTTP ${r.status}`);
  const out = Buffer.from(await r.arrayBuffer());
  if (!out.length) throw new Error("empty audio from Azure");
  return out;
}

async function viaEdge(text: string, lang: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 15000 });
  try {
    await tts.setMetadata(voiceName(lang, voice), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
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

function sendJson(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: Req): Promise<{ text?: string; lang?: string; voice?: string }> {
  if (req.body && typeof req.body === "object") return req.body as { text?: string; lang?: string; voice?: string };
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export default async function handler(req: Req, res: ServerResponse) {
  if (!azureOn() && !unofficialOn()) return sendJson(res, 404, { error: "online voice is turned off" });

  // what is available, without any secrets
  if (req.method === "GET") {
    return sendJson(res, 200, { provider: azureOn() ? "azure" : "unofficial", voices: Object.keys(SI_VOICES) });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "use POST" });

  let text: string;
  let lang: string;
  let voice: string;
  try {
    const body = await readBody(req);
    text = String(body.text ?? "").trim();
    lang = body.lang === "en" ? "en" : "si";
    voice = String(body.voice ?? "sameera").toLowerCase();
  } catch {
    return sendJson(res, 400, { error: "bad request" });
  }
  if (!text) return sendJson(res, 400, { error: "no text" });
  if (text.length > MAX_CHARS) return sendJson(res, 413, { error: `send at most ${MAX_CHARS} characters at a time` });

  const attempts: { source: string; run: () => Promise<Buffer> }[] = [];
  if (azureOn()) attempts.push({ source: "azure", run: () => viaAzure(text, lang, voice) });
  if (unofficialOn()) {
    attempts.push({ source: "edge", run: () => viaEdge(text, lang, voice) });
    attempts.push({ source: "google", run: () => viaGoogle(text, lang) });
  }

  let lastError = "";
  for (const a of attempts) {
    try {
      const audio = await a.run();
      res.statusCode = 200;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store"); // text must not be cached
      res.setHeader("X-Tts-Source", a.source);
      return res.end(audio);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return sendJson(res, 502, { error: `online voice failed: ${lastError}` });
}
