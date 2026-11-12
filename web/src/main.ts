import { analyse, type Gray, type TextInfo } from "./checks";
import { buzz, errorTone, readyChime, shutterSound, ToneGuide, unlockAudio } from "./audio";
import { closeCamera, grabFrame, listCameras, openCamera } from "./camera";
import { CONFIG } from "./config";
import { evaluate, STATUS_LABEL, type Mode, type Status } from "./guidance";
import { cropCanvas, decideLayout, findPageNumber, type LayoutDecision, type PageId } from "./layout";
import { addAttempt, loadAttempts, toCsv, updateAttempt, type Attempt, type SplitMark } from "./log";
import { recognise } from "./ocr";
import { loadSettings, saveSettings, type Settings } from "./settings";
import {
  detectScriptLang, loadVoices, Narrator, Phraser, previewVoice, voicesFor,
  type Lang, type ReadItem,
} from "./speech";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TEST = new URLSearchParams(location.search).has("debug");
document.body.classList.toggle("test-mode", TEST);
if (TEST) document.querySelectorAll<HTMLElement>(".test-only").forEach((e) => { if (e.id !== "split-preview" && e.id !== "test-result") e.hidden = false; });

const el = {
  announce: $("announce"), primary: $<HTMLButtonElement>("primary"), cameraWrap: $("camera-wrap"),
  frame: $("frame"), video: $<HTMLVideoElement>("video"), overlay: $<HTMLCanvasElement>("overlay"),
  hint: $("hint"), debug: $("debug"), selCamera: $<HTMLSelectElement>("sel-camera"),
  result: $("result"), resultInfo: $("result-info"), progress: $("progress"), pages: $("pages"),
  btnOnline: $<HTMLButtonElement>("btn-online"), splitPreview: $<HTMLCanvasElement>("split-preview"),
  testResult: $("test-result"), splitNote: $("split-note"),
  selOcr: $<HTMLSelectElement>("sel-ocr"), selCond: $<HTMLSelectElement>("sel-cond"),
  selVoiceEn: $<HTMLSelectElement>("sel-voice-en"), selVoiceSi: $<HTMLSelectElement>("sel-voice-si"),
  infoEn: $("voice-info-en"), infoSi: $("voice-info-si"), selOnline: $<HTMLSelectElement>("sel-online"),
  rate: $<HTMLInputElement>("rng-rate"), pitch: $<HTMLInputElement>("rng-pitch"),
  rateOut: $("out-rate"), pitchOut: $("out-pitch"), logCount: $("log-count"),
  chkVoice: $<HTMLInputElement>("chk-voice"), chkTones: $<HTMLInputElement>("chk-tones"),
  chkVibrate: $<HTMLInputElement>("chk-vibrate"), chkAutoRead: $<HTMLInputElement>("chk-autoread"),
};

type State = "idle" | "intro" | "camera" | "reading" | "result";

interface PageResult {
  id: PageId;
  label: string;
  number: number | null;
  original: string;
  lang: Lang;
  confidence: number;
}

let settings: Settings = loadSettings();
let state: State = "idle";
const phraser = new Phraser();
const tones = new ToneGuide();
const narrator = new Narrator();
let voices: SpeechSynthesisVoice[] = [];
let stream: MediaStream | null = null;
let mode: Mode = "phone";
let loop: number | undefined;
let prevTiny: Gray | null = null;
let stillSince = 0;
let passSince = 0;
let startedAt = 0;
let capturing = false;
let readyAnnounced = false;
let spokenHints: string[] = [];
let pages: PageResult[] = [];
let decision: LayoutDecision | null = null;
let attemptId = 0;
let reading = false;
let introTimer: number | undefined;

const analysisCanvas = document.createElement("canvas");
const actx = analysisCanvas.getContext("2d", { willReadFrequently: true })!;

// ---------- state, announcements, button ----------

const PRIMARY_LABEL: Record<State, string> = {
  idle: "Start reading",
  intro: "Skip introduction",
  camera: "Take photo now",
  reading: "Reading. Please wait.",
  result: "Read aloud",
};

function setState(s: State): void {
  state = s;
  document.body.dataset.state = s;
  el.cameraWrap.hidden = s !== "camera";
  el.result.hidden = !(s === "result" || s === "reading");
  updatePrimary();
}

function updatePrimary(): void {
  el.primary.textContent = state === "result" && reading ? "Stop reading" : PRIMARY_LABEL[state];
  el.primary.setAttribute("aria-disabled", String(state === "reading"));
}

function focusPrimary(): void {
  el.primary.focus({ preventScroll: false });
}

/** Announces a state change: always in the live region, and aloud unless the person uses a screen reader. */
function announce(msg: string, speakIt = true): void {
  el.announce.textContent = "";
  window.setTimeout(() => (el.announce.textContent = msg), 30); // re-set so screen readers repeat identical text
  if (speakIt && settings.appVoice) phraser.say(msg);
}

function vibrate(p: number[]): void {
  buzz(p, settings.vibrate);
}

// ---------- settings and voices ----------

function persist(): void {
  saveSettings(settings);
}

function bindSettings(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="layout"]').forEach((r) => {
    r.checked = r.value === settings.layout;
    r.addEventListener("change", () => { settings.layout = r.value as Settings["layout"]; persist(); });
  });
  document.querySelectorAll<HTMLInputElement>('input[name="which"]').forEach((r) => {
    r.checked = r.value === settings.which;
    r.addEventListener("change", () => { settings.which = r.value as Settings["which"]; persist(); });
  });
  el.selOcr.value = settings.ocr;
  el.selOcr.addEventListener("change", () => { settings.ocr = el.selOcr.value as Settings["ocr"]; persist(); });
  const bindCheck = (box: HTMLInputElement, key: "appVoice" | "tones" | "vibrate" | "autoRead", after?: () => void) => {
    box.checked = settings[key];
    box.addEventListener("change", () => { settings[key] = box.checked; persist(); after?.(); });
  };
  bindCheck(el.chkVoice, "appVoice", () => (phraser.enabled = settings.appVoice));
  bindCheck(el.chkTones, "tones", () => (tones.enabled = settings.tones));
  bindCheck(el.chkVibrate, "vibrate");
  bindCheck(el.chkAutoRead, "autoRead");
  phraser.enabled = settings.appVoice;
  tones.enabled = settings.tones;

  el.rate.value = String(settings.rate);
  el.pitch.value = String(settings.pitch);
  const showSpeed = () => {
    el.rateOut.textContent = settings.rate.toFixed(1);
    el.pitchOut.textContent = settings.pitch.toFixed(1);
    phraser.rate = settings.rate;
    phraser.pitch = settings.pitch;
  };
  showSpeed();
  el.rate.addEventListener("input", () => { settings.rate = Number(el.rate.value); persist(); showSpeed(); });
  el.pitch.addEventListener("input", () => { settings.pitch = Number(el.pitch.value); persist(); showSpeed(); });

  el.selOnline.value = settings.onlineVoice;
  el.selOnline.addEventListener("change", () => { settings.onlineVoice = el.selOnline.value as Settings["onlineVoice"]; persist(); });
  $("online-voice").hidden = !CONFIG.features.ttsFallback;
  $("privacy-online").hidden = !CONFIG.features.ttsFallback;

  el.selVoiceEn.addEventListener("change", () => { settings.voiceEn = el.selVoiceEn.value; persist(); applyVoices(); });
  el.selVoiceSi.addEventListener("change", () => { settings.voiceSi = el.selVoiceSi.value; persist(); applyVoices(); });
  $("btn-preview-en").addEventListener("click", () => previewVoice(chosenVoice("en"), "en", settings.rate, settings.pitch));
  $("btn-preview-si").addEventListener("click", () => {
    const v = chosenVoice("si");
    if (!v) announce("There is no Sinhala voice on this device.");
    else previewVoice(v, "si", settings.rate, settings.pitch);
  });
  $("btn-intro").addEventListener("click", () => { settings.introDone = false; persist(); void startReading(); });
}

function chosenVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const list = voicesFor(voices, lang);
  const uri = lang === "en" ? settings.voiceEn : settings.voiceSi;
  return list.find((v) => v.voiceURI === uri) ?? list[0];
}

function applyVoices(): void {
  phraser.voice = chosenVoice("en");
}

function fillVoices(lang: Lang): void {
  const select = lang === "en" ? el.selVoiceEn : el.selVoiceSi;
  const info = lang === "en" ? el.infoEn : el.infoSi;
  const list = voicesFor(voices, lang);
  const name = lang === "en" ? "English" : "Sinhala";
  select.replaceChildren(...list.map((v) => new Option(`${v.name} (${v.lang})`, v.voiceURI)));
  select.disabled = list.length === 0;
  const chosen = chosenVoice(lang);
  if (chosen) select.value = chosen.voiceURI;
  info.textContent =
    list.length === 0 ? `No ${name} voice is available on this device.`
    : list.length === 1 ? `Only one ${name} voice is available on this device.`
    : `${list.length} ${name} voices are available. Choose one below.`;
}

async function refreshVoices(): Promise<void> {
  voices = await loadVoices();
  fillVoices("en");
  fillVoices("si");
  applyVoices();
  if (state === "result") updateReadAvailability();
}

// ---------- start, introduction ----------

const INTRO =
  "Hold your phone flat above the page, about a hand's length away. " +
  "I will guide you with short tones and words. The photo is taken for you. " +
  "Press the big button to take it yourself. " +
  "If a screen reader is on, open Settings and turn off the app voice.";

async function startReading(): Promise<void> {
  unlockAudio();
  if (!settings.introDone && settings.appVoice && "speechSynthesis" in window) {
    setState("intro");
    focusPrimary();
    el.announce.textContent = "Introduction. Press the big button to skip.";
    phraser.say(INTRO);
    // finish when the speech ends, or after a fallback delay
    introTimer = window.setTimeout(() => finishIntro(), 22000);
    const t0 = performance.now();
    let started = false;
    const watch = window.setInterval(() => {
      if (state !== "intro") return window.clearInterval(watch);
      const busy = speechSynthesis.speaking || speechSynthesis.pending;
      if (busy) started = true;
      // done once speech has run and stopped, or if it never started
      if ((started && !busy) || (!started && performance.now() - t0 > 3000)) { window.clearInterval(watch); finishIntro(); }
    }, 400);
    return;
  }
  await startCamera();
}

function finishIntro(): void {
  if (state !== "intro") return;
  window.clearTimeout(introTimer);
  speechSynthesis.cancel();
  settings.introDone = true;
  persist();
  void startCamera();
}

// ---------- camera ----------

async function startCamera(deviceId?: string): Promise<void> {
  unlockAudio();
  closeCamera(stream);
  narrator.stop();
  reading = false;
  try {
    const cam = await openCamera(deviceId);
    stream = cam.stream;
    mode = cam.mode;
  } catch (e) {
    const name = (e as DOMException).name;
    const msg =
      name === "NotAllowedError" ? "Camera not allowed. Allow the camera in your browser settings."
      : name === "NotFoundError" ? "No camera found."
      : "The camera could not start.";
    setState("idle");
    vibrate(CONFIG.vibration.error);
    if (settings.tones) errorTone();
    announce(msg);
    focusPrimary();
    return;
  }
  el.video.srcObject = stream;
  await el.video.play().catch(() => {});
  await new Promise<void>((r) => (el.video.videoWidth ? r() : el.video.addEventListener("loadedmetadata", () => r(), { once: true })));
  el.frame.style.setProperty("--ar", `${el.video.videoWidth} / ${el.video.videoHeight}`);
  el.frame.classList.toggle("mirrored", mode === "webcam");
  analysisCanvas.width = CONFIG.analysis.width;
  analysisCanvas.height = Math.round((CONFIG.analysis.width * el.video.videoHeight) / el.video.videoWidth);

  const cams = await listCameras();
  const current = stream.getVideoTracks()[0].getSettings().deviceId;
  el.selCamera.replaceChildren(...cams.map((c, i) => new Option(c.label || `Camera ${i + 1}`, c.deviceId, false, c.deviceId === current)));

  prevTiny = null;
  stillSince = performance.now();
  passSince = 0;
  capturing = false;
  readyAnnounced = false;
  spokenHints = [];
  startedAt = performance.now();
  el.result.hidden = true;
  setState("camera");
  focusPrimary();
  announce(settings.layout === "book" ? "Camera on. Show both pages." : "Camera on. Show the page.");
  phraser.reset();
  tones.start();
  loop = window.setInterval(tick, 1000 / CONFIG.analysis.fps);
}

function stopLoop(): void {
  if (loop !== undefined) window.clearInterval(loop);
  loop = undefined;
  tones.stop();
}

function tick(): void {
  if (capturing || el.video.readyState < 2) return;
  actx.drawImage(el.video, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const img = actx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const { metrics, tiny } = analyse(img.data, img.width, img.height, prevTiny, CONFIG);
  const now = performance.now();
  if (metrics.motion > CONFIG.stability.maxMeanDiff) stillSince = now;
  prevTiny = tiny;

  const ev = evaluate(metrics, CONFIG, mode, now - stillSince);
  el.hint.textContent = ev.hint;
  el.frame.classList.remove("red", "amber", "green");
  el.frame.classList.add(ev.status);
  drawOverlay(metrics.text, ev.status);
  tones.setScore(ev.score);
  phraser.update(ev.key, ev.hint);
  if (ev.status === "green" && !readyAnnounced) {
    readyAnnounced = true;
    if (settings.tones) readyChime();
    vibrate(CONFIG.vibration.ready);
  }
  if (ev.status !== "green") readyAnnounced = false;
  if (TEST) {
    const t = metrics.text;
    el.debug.textContent =
      `${STATUS_LABEL[ev.status]} | sharp ${metrics.sharpness.toFixed(0)} (min ${CONFIG.sharpness.minLaplacianVariance}) | bright ${metrics.meanBrightness.toFixed(0)} | glare ${(metrics.glareFrac * 100).toFixed(1)}% | motion ${metrics.motion.toFixed(1)}\n` +
      `text ${t.found ? "yes" : "no"} area ${(t.areaFrac * 100).toFixed(0)}% w ${(t.widthFrac * 100).toFixed(0)}% tilt ${t.tiltDeg.toFixed(1)}${t.tiltReliable ? "" : "?"} dx ${t.centreDx.toFixed(2)} dy ${t.centreDy.toFixed(2)} cut ${(["left", "right", "top", "bottom"] as const).filter((s) => t.touches[s]).join(",") || "-"}\n` +
      `fold ${t.gutter.found ? `${t.gutter.kind} at ${t.gutter.x.toFixed(0)} (conf ${t.gutter.confidence})` : "none"} | failing: ${ev.failing.join(",") || "none"} | key ${ev.key}`;
  }

  if (ev.status === "green") {
    if (!passSince) passSince = now;
    if (now - passSince >= CONFIG.capture.autoHoldMs) void capture("auto");
  } else {
    passSince = 0;
  }
}

const COLOURS: Record<Status, string> = { red: "#ff4d4d", amber: "#ffb000", green: "#35e06f" };

function drawOverlay(t: TextInfo, status: Status): void {
  const c = el.overlay;
  const w = (c.width = el.frame.clientWidth);
  const h = (c.height = el.frame.clientHeight);
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  if (!t.found) return;
  const kx = w / analysisCanvas.width;
  const ky = h / analysisCanvas.height;
  g.strokeStyle = COLOURS[status];
  g.lineWidth = 5;
  g.strokeRect(t.box.x0 * kx, t.box.y0 * ky, (t.box.x1 - t.box.x0) * kx, (t.box.y1 - t.box.y0) * ky);
  if (settings.layout === "book" && t.gutter.found) {
    g.setLineDash([10, 8]);
    g.beginPath();
    g.moveTo(t.gutter.x * kx, t.box.y0 * ky);
    g.lineTo(t.gutter.x * kx, t.box.y1 * ky);
    g.stroke();
    g.setLineDash([]);
  }
}

// ---------- capture and reading ----------

async function capture(how: "auto" | "manual"): Promise<void> {
  if (capturing || !stream) return;
  capturing = true;
  const secondsToCapture = (performance.now() - startedAt) / 1000;
  const photo = grabFrame(el.video);
  stopLoop();
  closeCamera(stream);
  stream = null;
  if (settings.tones) shutterSound();
  vibrate(CONFIG.vibration.captured);
  setState("reading");
  announce("Photo taken. Reading.");
  focusPrimary();

  el.pages.replaceChildren();
  el.progress.textContent = "";
  pages = [];
  decision = decideLayout(photo, settings.layout, settings.which);
  if (decision.note) announce(decision.note);

  let langChoice = settings.ocr;
  let confidenceSum = 0;
  let seconds = 0;
  const labelOf = (id: PageId) => (id === "left" ? "Left page" : id === "right" ? "Right page" : "Text");
  try {
    for (const crop of decision.crops) {
      if (decision.kind === "spread") announce(`Reading ${labelOf(crop.id).toLowerCase()}.`);
      const r = await recognise(cropCanvas(photo, crop.box), langChoice, (m) => (el.progress.textContent = m));
      langChoice = r.langUsed; // the second page of a book is in the same language
      confidenceSum += r.confidence;
      seconds += r.seconds;
      const number = findPageNumber(r.text);
      pages.push({
        id: crop.id,
        label: number !== null ? `Page ${number}` : labelOf(crop.id),
        number,
        original: r.text,
        lang: r.text ? detectScriptLang(r.text) : r.langUsed === "sin" ? "si" : "en",
        confidence: r.confidence,
      });
    }
  } catch {
    setState("idle");
    if (settings.tones) errorTone();
    vibrate(CONFIG.vibration.error);
    announce("Reading failed. Try again.");
    focusPrimary();
    return;
  }

  el.progress.textContent = "";
  renderPages();
  const totalChars = pages.reduce((n, p) => n + p.original.length, 0);
  const summary =
    totalChars === 0 ? "No text found. Try again with better light."
    : decision.kind === "spread" && pages.length === 2 ? "Done. Two pages."
    : "Done.";
  el.resultInfo.textContent = TEST ? `${decision.kind}, ${pages.length} page(s), ${totalChars} characters, ${seconds.toFixed(1)} seconds` : "";
  setState("result");
  vibrate(CONFIG.vibration.done);
  updateReadAvailability();
  announce(totalChars ? `${summary} Press the big button to read aloud.` : summary);
  focusPrimary();

  const record: Omit<Attempt, "id"> = {
    time: new Date().toISOString(),
    condition: el.selCond.value,
    mode,
    secondsToCapture: Math.round(secondsToCapture * 10) / 10,
    hintCount: spokenHints.length,
    hints: spokenHints,
    capture: how,
    ocrLangRequested: settings.ocr,
    ocrLangUsed: langChoice,
    ocrConfidence: Math.round(confidenceSum / Math.max(1, pages.length)),
    ocrSeconds: Math.round(seconds * 10) / 10,
    chars: totalChars,
    rating: "",
    layoutSetting: settings.layout,
    decision: decision.kind,
    gutterFound: decision.gutterFound,
    gutterX: decision.gutterX,
    pagesRead: decision.kind === "spread" ? settings.which : "page",
    splitMark: "",
  };
  attemptId = addAttempt(record).id;
  updateLogCount();
  if (TEST) showTestResult(photo);
  if (settings.autoRead && totalChars && canSpeak()) window.setTimeout(() => readAloud(), 2200);
}

function renderPages(): void {
  el.pages.replaceChildren();
  pages.forEach((p, i) => {
    const sec = document.createElement("section");
    sec.className = "page";
    sec.setAttribute("aria-labelledby", `ph-${i}`);
    const h = document.createElement("h3");
    h.id = `ph-${i}`;
    h.textContent = p.label;
    const ta = document.createElement("textarea");
    ta.id = `pt-${i}`;
    ta.value = p.original;
    ta.lang = p.lang === "si" ? "si" : "en";
    ta.setAttribute("aria-labelledby", `ph-${i}`);
    ta.rows = 8;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Read ${p.label.toLowerCase()} only`;
    btn.addEventListener("click", () => readAloud([i]));
    if (pages.length > 1) sec.append(h, ta, btn);
    else sec.append(h, ta);
    el.pages.append(sec);
  });
}

const pageText = (i: number) => (document.getElementById(`pt-${i}`) as HTMLTextAreaElement | null)?.value ?? pages[i].original;

function canSpeak(): boolean {
  return pages.some((p) => !!chosenVoice(p.lang) && p.original.trim());
}

function updateReadAvailability(): void {
  const noVoicePages = pages.filter((p) => p.original.trim() && !chosenVoice(p.lang));
  const si = noVoicePages.some((p) => p.lang === "si");
  el.btnOnline.hidden = !(CONFIG.features.ttsFallback && si);
  el.primary.setAttribute("aria-disabled", String(state === "reading" || !canSpeak()));
  if (state === "result" && noVoicePages.length) {
    el.resultInfo.textContent = si
      ? "No Sinhala voice on this device. The text can be read on screen." + (CONFIG.features.ttsFallback ? " You can try the online voice." : "")
      : "No English voice on this device. The text can be read on screen.";
  } else if (!TEST) {
    el.resultInfo.textContent = "";
  }
}

function itemsFor(indices: number[]): ReadItem[] {
  const items: ReadItem[] = [];
  for (const i of indices) {
    const p = pages[i];
    if (pages.length > 1) items.push({ text: `${p.label}.`, lang: "en", label: true });
    items.push({ text: pageText(i), lang: p.lang });
  }
  return items;
}

function narration(online: boolean) {
  return {
    voices: { en: chosenVoice("en"), si: chosenVoice("si") },
    rate: settings.rate,
    pitch: settings.pitch,
    online: { enabled: online, voice: settings.onlineVoice },
  };
}

function readAloud(indices: number[] = pages.map((_, i) => i), online = false): void {
  if (!pages.length) return;
  if (!online && !canSpeak() && !indices.some((i) => chosenVoice(pages[i].lang))) {
    announce(pages.some((p) => p.lang === "si") ? "No Sinhala voice on this device." : "No voice on this device.");
    return;
  }
  reading = true;
  updatePrimary();
  narrator.play(itemsFor(indices), narration(online), () => {}, (err) => {
    reading = false;
    updatePrimary();
    if (err) {
      if (settings.tones) errorTone();
      vibrate(CONFIG.vibration.error);
      announce(`Could not read aloud. ${err}`, false);
    } else {
      vibrate(CONFIG.vibration.done);
      announce("Finished reading.", false);
    }
  });
}

function stopReading(): void {
  narrator.stop();
  reading = false;
  updatePrimary();
  announce("Stopped.", false);
}

// ---------- test mode ----------

function showTestResult(photo: HTMLCanvasElement): void {
  el.testResult.hidden = false;
  el.splitPreview.hidden = false;
  for (const id of ["btn-good", "btn-help", "btn-split-right", "btn-split-wrong"]) $(id).setAttribute("aria-pressed", "false");
  const d = decision!;
  el.splitNote.textContent = `Setting: ${d.setting}. Decision: ${d.kind}${d.gutterFound ? `, fold at x=${d.gutterX} of ${photo.width}` : ""}. Reading: ${d.kind === "spread" ? settings.which : "page"}.${d.note ? " " + d.note : ""}`;
  const k = Math.min(1, 900 / photo.width);
  const c = el.splitPreview;
  c.width = photo.width * k;
  c.height = photo.height * k;
  const g = c.getContext("2d")!;
  g.drawImage(photo, 0, 0, c.width, c.height);
  g.lineWidth = 3;
  d.crops.forEach((crop, i) => {
    g.strokeStyle = i ? "#ff4d4d" : "#35e06f";
    g.strokeRect(crop.box.x0 * k, crop.box.y0 * k, (crop.box.x1 - crop.box.x0) * k, (crop.box.y1 - crop.box.y0) * k);
  });
  if (d.gutterFound) {
    g.strokeStyle = "#ffd400";
    g.beginPath();
    g.moveTo(d.gutterX * k, 0);
    g.lineTo(d.gutterX * k, c.height);
    g.stroke();
  }
}

function mark(kind: "good_first_try" | "needed_help"): void {
  updateAttempt(attemptId, { rating: kind });
  $("btn-good").setAttribute("aria-pressed", String(kind === "good_first_try"));
  $("btn-help").setAttribute("aria-pressed", String(kind === "needed_help"));
}

function markSplit(kind: Exclude<SplitMark, "">): void {
  updateAttempt(attemptId, { splitMark: kind });
  $("btn-split-right").setAttribute("aria-pressed", String(kind === "right"));
  $("btn-split-wrong").setAttribute("aria-pressed", String(kind === "wrong"));
}

function updateLogCount(): void {
  const n = loadAttempts().length;
  el.logCount.textContent = `${n} attempt${n === 1 ? "" : "s"} saved in this browser.`;
}

function downloadCsv(): void {
  const blob = new Blob([toCsv(loadAttempts())], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tabletop-reader-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyText(): Promise<void> {
  const text = pages.map((p, i) => (pages.length > 1 ? `${p.label}\n${pageText(i)}` : pageText(i))).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  announce("Copied.", false);
}

// ---------- wiring ----------

phraser.onSpoken = (t) => {
  spokenHints.push(t);
  if (!settings.appVoice) announce(t, false); // screen-reader mode: the live region carries the guidance
};

el.primary.addEventListener("click", () => {
  unlockAudio();
  if (state === "idle") void startReading();
  else if (state === "intro") finishIntro();
  else if (state === "camera") void capture("manual");
  else if (state === "reading") announce("Still reading. Please wait.", false);
  else if (state === "result") {
    if (reading) stopReading();
    else readAloud();
  }
});

el.btnOnline.addEventListener("click", () => {
  announce("Getting the online voice.", false);
  const idx = pages.map((_, i) => i).filter((i) => pages[i].lang === "si" && !chosenVoice("si"));
  readAloud(idx.length ? idx : undefined, true);
});
$("btn-again").addEventListener("click", () => {
  narrator.stop();
  el.testResult.hidden = true;
  el.splitPreview.hidden = true;
  void startCamera();
});
$("btn-copy").addEventListener("click", () => void copyText());
$("btn-original").addEventListener("click", () => {
  pages.forEach((p, i) => ((document.getElementById(`pt-${i}`) as HTMLTextAreaElement).value = p.original));
  announce("Original text restored.", false);
});
el.selCamera.addEventListener("change", () => { stopLoop(); void startCamera(el.selCamera.value); });
$("btn-csv").addEventListener("click", downloadCsv);
$("btn-good").addEventListener("click", () => mark("good_first_try"));
$("btn-help").addEventListener("click", () => mark("needed_help"));
$("btn-split-right").addEventListener("click", () => markSplit("right"));
$("btn-split-wrong").addEventListener("click", () => markSplit("wrong"));

document.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (state === "intro") finishIntro();
    else if (reading) stopReading();
    return;
  }
  if (e.code !== "Space" || state !== "camera") return;
  if ((e.target as HTMLElement).closest("input, textarea, select, summary")) return;
  e.preventDefault();
  void capture("manual");
});

bindSettings();
updateLogCount();
void refreshVoices();
setState("idle");
if (!navigator.mediaDevices?.getUserMedia) {
  el.primary.setAttribute("aria-disabled", "true");
  el.announce.textContent = "This browser cannot use the camera. Use a recent Chrome, Edge, Safari or Firefox over HTTPS.";
}
