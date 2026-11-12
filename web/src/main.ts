import { analyse, type Gray } from "./checks";
import { Announcer, BrowserReader, OnlineReader, detectScriptLang, loadVoices, voicesFor, type Lang } from "./speech";
import { BeepLoop, shutterSound, unlockAudio } from "./audio";
import { closeCamera, grabFrame, listCameras, openCamera } from "./camera";
import { CONFIG } from "./config";
import { evaluate, HINTS, STATUS_LABEL, type Mode } from "./guidance";
import { addAttempt, loadAttempts, toCsv, updateAttempt, type Attempt } from "./log";
import { recognise, type OcrChoice } from "./ocr";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  start: $("screen-start"), camera: $("screen-camera"), result: $("screen-result"),
  status: $("status"), hint: $("hint"), badge: $("status-badge"), frame: $("frame"),
  video: $<HTMLVideoElement>("video"), overlay: $<HTMLCanvasElement>("overlay"),
  selCamera: $<HTMLSelectElement>("sel-camera"), selOcr: $<HTMLSelectElement>("sel-ocr"),
  selCond: $<HTMLSelectElement>("sel-cond"), chkSpeak: $<HTMLInputElement>("chk-speak"),
  chkBeep: $<HTMLInputElement>("chk-beep"), photo: $<HTMLImageElement>("photo"),
  text: $<HTMLTextAreaElement>("text"), ocrInfo: $("ocr-info"), voiceNote: $("voice-note"),
  selVoice: $<HTMLSelectElement>("sel-voice"), rate: $<HTMLInputElement>("rng-rate"),
  rateOut: $("out-rate"), btnOnline: $<HTMLButtonElement>("btn-online"),
  good: $<HTMLButtonElement>("btn-good"), help: $<HTMLButtonElement>("btn-help"),
  logCount: $("log-count"),
};

const announcer = new Announcer();
const beeps = new BeepLoop();
const reader = new BrowserReader();
const online = new OnlineReader();

let stream: MediaStream | null = null;
let mode: Mode = "phone";
let loop: number | undefined;
let prevTiny: Gray | null = null;
let stillSince = 0;
let passSince = 0;
let startedAt = 0;
let capturing = false;
let spokenHints: string[] = [];
let originalText = "";
let currentLang: Lang = "en";
let voices: SpeechSynthesisVoice[] = [];
let attemptId = 0;

const DEBUG = new URLSearchParams(location.search).has("debug");
const debugEl = $("debug");
debugEl.hidden = !DEBUG;

const analysisCanvas = document.createElement("canvas");
const actx = analysisCanvas.getContext("2d", { willReadFrequently: true })!;

function show(screen: "start" | "camera" | "result"): void {
  el.start.hidden = screen !== "start";
  el.camera.hidden = screen !== "camera";
  el.result.hidden = screen !== "result";
  (screen === "start" ? $("btn-start") : screen === "camera" ? $("btn-capture") : $("btn-copy")).focus({ preventScroll: false });
}

function setStatus(msg: string): void {
  el.status.textContent = msg;
}

function say(msg: string): void {
  setStatus(msg);
  if (el.chkSpeak.checked) announcer.say(msg);
}

// ---------- camera screen ----------

async function startCamera(deviceId?: string): Promise<void> {
  unlockAudio();
  announcer.enabled = el.chkSpeak.checked;
  beeps.enabled = el.chkBeep.checked;
  el.hint.setAttribute("aria-live", el.chkSpeak.checked ? "off" : "polite"); // avoid double speech with a screen reader
  closeCamera(stream);
  try {
    const cam = await openCamera(deviceId);
    stream = cam.stream;
    mode = cam.mode;
  } catch (e) {
    const name = (e as DOMException).name;
    const msg =
      name === "NotAllowedError" ? "Camera permission was refused. Allow the camera in your browser settings and try again."
      : name === "NotFoundError" ? "No camera was found on this device."
      : `The camera could not start: ${(e as Error).message}`;
    show("start");
    say(msg);
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
  el.selCamera.replaceChildren(
    ...cams.map((c, i) => new Option(c.label || `Camera ${i + 1}`, c.deviceId, false, c.deviceId === current)),
  );

  prevTiny = null;
  stillSince = performance.now();
  passSince = 0;
  capturing = false;
  spokenHints = [];
  startedAt = performance.now();
  setStatus("");
  show("camera");
  say(mode === "phone" ? "Camera on. Point the phone at the page." : "Camera on. Hold the page in front of the camera.");
  beeps.start();
  loop = window.setInterval(tick, 1000 / CONFIG.analysis.fps);
}

function stopLoop(): void {
  if (loop !== undefined) window.clearInterval(loop);
  loop = undefined;
  beeps.stop();
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
  el.badge.textContent = STATUS_LABEL[ev.status];
  el.badge.className = `badge ${ev.status}`;
  el.frame.classList.remove("red", "amber", "green");
  el.frame.classList.add(ev.status);
  drawOverlay(metrics.page.corners, ev.status);
  beeps.setScore(ev.score);
  if (DEBUG) {
    const p = metrics.page;
    debugEl.textContent = `sharp ${metrics.sharpness.toFixed(0)} (min ${CONFIG.sharpness.minLaplacianVariance}) | bright ${metrics.meanBrightness.toFixed(0)} | glare ${(metrics.glareFrac * 100).toFixed(1)}% | motion ${metrics.motion.toFixed(1)} | page ${p.found ? "yes" : "no"} area ${(p.areaFrac * 100).toFixed(0)}% tilt ${p.tiltDeg.toFixed(1)} dx ${p.centreDx.toFixed(2)} dy ${p.centreDy.toFixed(2)} | failing: ${ev.failing.join(",") || "none"}`;
  }
  announcer.hint(ev.hint);

  if (ev.status === "green") {
    if (!passSince) passSince = now;
    if (now - passSince >= CONFIG.capture.autoHoldMs) void capture("auto");
  } else {
    passSince = 0;
  }
}

const COLOURS = { red: "#ff4d4d", amber: "#ffb000", green: "#35e06f" };

function drawOverlay(corners: { x: number; y: number }[], status: "red" | "amber" | "green"): void {
  const c = el.overlay;
  const w = (c.width = el.frame.clientWidth);
  const h = (c.height = el.frame.clientHeight);
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  // target area: where the page should sit
  g.setLineDash([12, 10]);
  g.strokeStyle = "rgba(255,255,255,.8)";
  g.lineWidth = 3;
  const m = 0.1;
  g.strokeRect(w * m, h * m, w * (1 - 2 * m), h * (1 - 2 * m));
  g.setLineDash([]);
  if (corners.length === 4) {
    const k = w / analysisCanvas.width; // corners are in analysis-frame pixels
    const ky = h / analysisCanvas.height;
    g.strokeStyle = COLOURS[status];
    g.lineWidth = 6;
    g.beginPath();
    corners.forEach((p, i) => (i ? g.lineTo(p.x * k, p.y * ky) : g.moveTo(p.x * k, p.y * ky)));
    g.closePath();
    g.stroke();
  }
}

async function capture(how: "auto" | "manual"): Promise<void> {
  if (capturing || !stream) return;
  capturing = true;
  const secondsToCapture = (performance.now() - startedAt) / 1000;
  const photo = grabFrame(el.video);
  stopLoop();
  closeCamera(stream);
  stream = null;
  shutterSound();
  say("Photo taken");
  el.photo.src = photo.toDataURL("image/jpeg", 0.85);
  el.text.value = "";
  el.ocrInfo.textContent = "";
  el.voiceNote.textContent = "";
  el.good.setAttribute("aria-pressed", "false");
  el.help.setAttribute("aria-pressed", "false");
  show("result");

  window.setTimeout(() => announcer.say("Reading"), 900); // after "Photo taken"
  setStatus("Reading");
  const requested = el.selOcr.value as OcrChoice;
  let result;
  try {
    result = await recognise(photo, requested, setStatus);
  } catch (e) {
    setStatus(`Reading failed: ${(e as Error).message}`);
    announcer.say("Reading failed. Please try again.");
    return;
  }

  originalText = result.text;
  el.text.value = originalText;
  currentLang = requested === "auto" ? detectScriptLang(originalText) : requested === "sin" ? "si" : "en";
  el.text.lang = currentLang;
  el.ocrInfo.textContent = `Read as ${result.langUsed === "sin" ? "Sinhala" : "English"}, confidence ${Math.round(result.confidence)}%, ${result.seconds.toFixed(1)} seconds, ${originalText.length} characters. ${how === "auto" ? "Photo taken automatically." : "Photo taken manually."}`;
  setStatus("");
  const spoken = originalText ? `Finished. ${originalText.length} characters found.` : "Finished. No text was found. Try again with better light.";
  announcer.say(spoken);

  const record: Omit<Attempt, "id"> = {
    time: new Date().toISOString(),
    condition: el.selCond.value,
    mode,
    secondsToCapture: Math.round(secondsToCapture * 10) / 10,
    hintCount: spokenHints.length,
    hints: spokenHints,
    capture: how,
    ocrLangRequested: requested,
    ocrLangUsed: result.langUsed,
    ocrConfidence: Math.round(result.confidence),
    ocrSeconds: Math.round(result.seconds * 10) / 10,
    chars: originalText.length,
    rating: "",
  };
  attemptId = addAttempt(record).id;
  updateLogCount();
  refreshVoices();
}

// ---------- result screen ----------

async function refreshVoices(): Promise<void> {
  voices = await loadVoices();
  const matching = voicesFor(voices, currentLang);
  el.selVoice.replaceChildren(...matching.map((v) => new Option(`${v.name} (${v.lang})`, v.voiceURI)));
  const wantOnline = CONFIG.features.ttsFallback && currentLang === "si" && matching.length === 0;
  el.btnOnline.hidden = !wantOnline;
  $("privacy-online").hidden = !CONFIG.features.ttsFallback;
  if (matching.length === 0) {
    el.voiceNote.textContent =
      currentLang === "si"
        ? "No Sinhala voice was found on this device, so the text can be read on screen but not spoken here." + (wantOnline ? " You can try the online voice below." : "")
        : "No English voice was found on this device.";
    if (el.chkSpeak.checked) announcer.say(currentLang === "si" ? "No Sinhala voice on this device. Text only." : "No English voice on this device.");
  } else {
    el.voiceNote.textContent = `${matching.length} ${currentLang === "si" ? "Sinhala" : "English"} voice${matching.length > 1 ? "s" : ""} available.`;
  }
  ($("btn-read") as HTMLButtonElement).disabled = matching.length === 0;
}

function selectedVoice(): SpeechSynthesisVoice | undefined {
  return voices.find((v) => v.voiceURI === el.selVoice.value);
}

function updateLogCount(): void {
  const n = loadAttempts().length;
  el.logCount.textContent = `${n} attempt${n === 1 ? "" : "s"} saved in this browser.`;
}

function rate(r: "good_first_try" | "needed_help"): void {
  updateAttempt(attemptId, { rating: r });
  el.good.setAttribute("aria-pressed", String(r === "good_first_try"));
  el.help.setAttribute("aria-pressed", String(r === "needed_help"));
  setStatus(r === "good_first_try" ? "Marked: good first try." : "Marked: needed help.");
}

async function copyText(): Promise<void> {
  try {
    await navigator.clipboard.writeText(el.text.value);
  } catch {
    el.text.select();
    document.execCommand("copy");
  }
  setStatus("Copied.");
}

function downloadCsv(): void {
  const blob = new Blob([toCsv(loadAttempts())], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tabletop-reader-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- wiring ----------

announcer.onSpoken = (t) => {
  if (t !== HINTS.ok) spokenHints.push(t);
};

$("btn-start").addEventListener("click", () => void startCamera());
$("btn-capture").addEventListener("click", () => void capture("manual"));
$("btn-stop").addEventListener("click", () => {
  stopLoop();
  closeCamera(stream);
  stream = null;
  show("start");
  say("Camera stopped.");
});
el.selCamera.addEventListener("change", () => {
  stopLoop();
  void startCamera(el.selCamera.value);
});
el.chkSpeak.addEventListener("change", () => (announcer.enabled = el.chkSpeak.checked));
el.chkBeep.addEventListener("change", () => (beeps.enabled = el.chkBeep.checked));
$("btn-copy").addEventListener("click", () => void copyText());
$("btn-original").addEventListener("click", () => {
  el.text.value = originalText;
  setStatus("Original text restored.");
});
$("btn-read").addEventListener("click", () => {
  online.stop();
  reader.speak(el.text.value, { voice: selectedVoice(), rate: Number(el.rate.value), lang: currentLang }, () => {});
});
el.btnOnline.addEventListener("click", () => {
  reader.stop();
  setStatus("Getting the online voice.");
  void online.speak(el.text.value, currentLang, Number(el.rate.value), (err) =>
    setStatus(err ? `Online voice failed: ${err}` : "Finished reading."),
  );
});
$("btn-read-stop").addEventListener("click", () => {
  reader.stop();
  online.stop();
});
el.rate.addEventListener("input", () => (el.rateOut.textContent = Number(el.rate.value).toFixed(1)));
el.good.addEventListener("click", () => rate("good_first_try"));
el.help.addEventListener("click", () => rate("needed_help"));
$("btn-csv").addEventListener("click", downloadCsv);
$("btn-again").addEventListener("click", () => {
  reader.stop();
  online.stop();
  void startCamera();
});

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || el.camera.hidden) return;
  const t = e.target as HTMLElement;
  if (t.closest("input, textarea, select")) return;
  e.preventDefault();
  void capture("manual");
});

if (!navigator.mediaDevices?.getUserMedia) {
  $("btn-start").setAttribute("disabled", "");
  setStatus("This browser cannot use the camera. Use a recent Chrome, Edge, Safari or Firefox over HTTPS.");
}
updateLogCount();
