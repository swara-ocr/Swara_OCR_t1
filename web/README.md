# TableTop Reader (web)

A browser app for reading printed pages aloud, in English and Sinhala. It guides the user to frame the page, checks that the image is clear, takes the photo automatically, reads the text and speaks it. Every instruction is spoken as well as shown.

Everything runs in the browser. There are no per-frame server calls, no analytics and no API keys. The photo and the text never leave the device.

The only exception is the optional online Sinhala voice (see below), which is off by default and sends text to an online speech service when the person presses its button.

## Run it

```bash
cd web
npm install
npm run dev        # http://localhost:5173 (camera works on localhost)
npm run build      # type-checks, then writes dist/
npm run preview    # serves dist/ on http://localhost:4173
npm test           # unit tests for the image checks and the guidance wording
```

`npm run dev` and `npm run build` first copy the Tesseract.js worker and WASM core from `node_modules` into `public/tesseract/` (generated, not committed). The English and Sinhala models are in `public/tessdata/` (the `tessdata_fast` files, about 5.8 MB in total), so OCR works without any third-party download.

Add `?debug=1` to the URL to see the live numbers (sharpness, brightness, glare, motion, page area, tilt, offset and which checks fail) under the camera. Use it when tuning.

## What happens on screen

1. Start screen: a large **Start camera** button and a few options (text language, spoken instructions, beep, test condition).
2. Camera: the rear camera is used by default (any camera can be chosen). A coloured frame (red, amber, green) plus a word (Adjust, Almost, Ready) and a short hint are shown and spoken.
3. When every check has passed for 1 second the photo is taken from the full-resolution stream, a shutter sound plays and it says "Photo taken". The **Take photo** button and the space bar take a photo manually.
4. The photo is read with Tesseract.js ("Reading" is spoken, progress is shown).
5. The text appears in a large high-contrast box with **Copy**, **Restore original text**, voice and speed controls, and **Read aloud**.

## The live checks

Run about 8 times a second on a 640-pixel-wide copy of the frame, in plain canvas code (no OpenCV). See `src/checks.ts` and `src/guidance.ts`.

| Check | How | Spoken hint |
|---|---|---|
| Page found | blur, Otsu threshold, largest light region, its four extreme corners | "I cannot see the page" |
| Framing | page area, centre offset, corners near the frame edge | "Move the phone closer / further away / left / right / up / down", "Page is cut off" |
| Tilt | angle of the top and bottom page edges | "Straighten the page" |
| Sharpness | variance of the Laplacian over the middle of the page | "Too blurry. Hold still" |
| Lighting | mean brightness of the page, share of blown-out pixels | "Too dark", "Too bright", "Reduce glare" |
| Stability | mean difference between consecutive tiny frames over 1 second | "Hold still" |

Hints are spoken in priority order (page, light, framing, tilt, sharpness, stillness). The same hint is not repeated within 3 seconds. A soft beep gets faster as more checks pass.

On a phone the hints talk about moving the phone. On a laptop webcam the preview is mirrored and the hints talk about moving the page.

## Tuning the thresholds

Every threshold is in one object at the top of `src/config.ts`.

| Setting | Default | Meaning |
|---|---|---|
| `analysis.fps` | 8 | checks per second |
| `page.minAreaFrac` / `maxAreaFrac` | 0.28 / 0.92 | page must fill this share of the frame (a portrait page in a landscape frame tops out near 0.35) |
| `page.maxCentreOffset` | 0.12 | allowed offset of the page centre, as a share of the frame |
| `page.edgeMarginFrac` | 0.015 | corners this close to the edge count as cut off |
| `tilt.maxDegrees` | 6 | beyond this: "Straighten the page" |
| `sharpness.minLaplacianVariance` | 100 | below this: "Too blurry" (a sharp test page scored about 4000, a heavily blurred one about 7) |
| `light.minMeanBrightness` / `maxMeanBrightness` | 70 / 235 | too dark / too bright |
| `light.maxGlareFrac` | 0.06 | share of pixels at 250 or more inside the page |
| `stability.maxMeanDiff` / `holdMs` | 3.0 / 1000 | how still the picture must be, and for how long |
| `capture.autoHoldMs` | 1000 | all checks must pass this long before auto-capture |
| `speech.repeatGapMs` / `minGapMs` | 3000 / 1500 | repeat spacing for one hint / spacing between any two hints |
| `ocr.maxSide` | 2000 | long side of the photo sent to OCR |

The defaults were set on synthetic frames and on a fake camera playing test scenes. Real cameras add noise, so expect to adjust sharpness, brightness and stability. Use `?debug=1` and the test checklist below.

## Language and speech

- OCR language: English, Sinhala or Auto. Auto reads with both and keeps the more confident result, so it takes about twice as long.
- Speech uses the browser's `speechSynthesis` by default. The voice list is filtered to the text's language, and there is a speed slider.
- If the device has no Sinhala voice, the page says so and offers text only. Many desktop browsers have no Sinhala voice, so test on the real phone.
- Spoken instructions are in English. The strings are in `src/guidance.ts` if you want to translate them.

### Optional online Sinhala voice (unofficial)

This follows the Streamlit app in `app/`, which uses Microsoft Edge TTS (`si-LK-SameeraNeural`) with Google TTS as the second option. `api/tts.ts` is a small Vercel function that tries the Edge voice first and Google second, and returns MP3.

It is **off by default**. To turn it on:

- on the server, set the environment variable `TTS_FALLBACK=1` (Vercel project settings), and
- at build time, set `VITE_TTS_FALLBACK=1`.

For local testing: `VITE_TTS_FALLBACK=1 TTS_FALLBACK=1 npm run dev`.

When on, and only if the browser has no Sinhala voice, an extra button appears. The text is sent to the online service only when the person presses it, in pieces of at most 300 characters, and nothing is stored.

**Risk:** both routes are unofficial. They are not public APIs with a service agreement, they can change or block requests without notice, and using them may go against the providers' terms of use. They are fine for testing and unreliable for production. For a real release, use a licensed speech service or a Sinhala voice installed on the device.

## Deploy on Vercel

1. Push the repository to GitHub.
2. In Vercel choose **Add New Project** and import the repository.
3. Set **Root Directory** to `web`.
4. Framework preset: **Vite** (build command `npm run build`, output `dist`).
5. No environment variables are needed for the base app. Deploy.

Vercel serves the site over HTTPS, which the camera needs. Add the two variables above only if you want to try the online Sinhala voice.

## Test log

Every captured attempt is stored in the browser's `localStorage`: time, test condition, camera mode (phone or webcam), seconds from start to capture, number and text of hints spoken, auto or manual capture, OCR language requested and used, OCR confidence and time, characters returned, and a rating. After each attempt press **Good first try** or **Needed help**. **Download log (CSV)** saves everything. The log stays on the device, and clearing the browser's site data deletes it, so download it after each session.

### Test checklist

Do 10 attempts in each condition: **bright light, dim light, tilted page, glare**. Choose the condition on the start screen before each attempt, use a different printed page now and then, and do not coach the person. Count an attempt as a good first try if the photo was taken without anyone stepping in and the text was usable.

For each condition note:

- first-try success rate (good first tries out of 10)
- median and range of seconds to capture
- number of spoken hints per attempt, and which hints came up most
- auto against manual capture
- OCR confidence and whether the text was readable (read it against the page)
- anything the hints got wrong (for example, "Too blurry" on a sharp page, or an unreachable "Ready")

If a check fails too often or never fires, change the matching threshold, reload, and note the value you used.

## Tested and not tested

Tested:

- Unit tests (`npm test`) of every check and hint on synthetic frames: framing, off-centre, cut off, tilt, blur, dark, glare and stability.
- Headless Chrome with a fake camera playing scenes made from the test pages: auto-capture of a well-framed page in under 3 seconds, English, Sinhala and Auto OCR in the browser using the self-hosted worker and models, and hints for a small, tilted, blurred, dark and off-centre page.
- The no-Sinhala-voice message, the text-only mode, the CSV log, the rating buttons and the optional online voice (flag off and on).

Not tested:

- The phone rear camera, real phone orientation, autofocus and exposure behaviour.
- A real laptop webcam (only a fake camera was used).
- Real speech voices, including whether a Sinhala voice exists on target phones, and spoken-hint timing with a screen reader.
- Safari and Firefox.
- The deployed Vercel build.
- Real glare on glossy paper (glare was only tested with synthetic highlights).

## Design notes

- Page detection is hand-written canvas code (threshold plus largest region) instead of OpenCV.js, which keeps the app small and fast. It expects a light page on a darker background and a roughly rectangular page. A dark page on a light table is not handled.
- `tessdata_fast` models are used for speed in the browser. The Streamlit app uses `tessdata_best`; accuracy in the browser has not been compared.
