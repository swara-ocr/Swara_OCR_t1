# TableTop Reader (web)

A browser app for reading printed pages and open books aloud, in English and Sinhala. It is built for blind and low-vision users: it guides the person to frame the page, checks that the image is clear, takes the photo automatically, reads the text and speaks it. Every state is spoken and also written to a live region for screen readers.

Everything runs in the browser. There are no per-frame server calls, no analytics and no API keys. The photo and the text never leave the device. The only exception is the optional online voice (see "Online voice"), which is off by default.

## Run it

```bash
cd web
npm install
npm run dev        # http://localhost:5173 (the camera works on localhost)
npm run build      # type-checks, then writes dist/
npm run preview    # serves dist/ on http://localhost:4173
npm test           # unit tests for the checks, book splitting and wording
```

`npm run dev` and `npm run build` first copy the Tesseract.js worker and WASM core from `node_modules` into `public/tesseract/` (generated, not committed). The English and Sinhala models are in `public/tessdata/` (`tessdata_fast`, about 5.6 MB), so OCR works without any third-party download.

## Two modes

**User mode** (the default) is what a blind person sees: one very large button, a short line of text announcing the current state, no numbers, and a collapsed Settings section.

| State | Big button says | What happens |
|---|---|---|
| Start | Start reading | first time only: a short spoken introduction, skippable by pressing the button or Escape |
| Camera | Take photo now | tones and short phrases guide the framing; the photo is taken automatically, or by the button or space bar |
| Reading | Reading. Please wait. | each page is read in turn |
| Result | Read aloud / Stop reading | the text is read aloud, page by page |

Focus moves to the big button at every change, labels are real `<label>`s and headings, the camera preview is hidden from assistive technology, and the page works with TalkBack and VoiceOver. If you use a screen reader, turn off "Speak instructions with the app voice" in Settings so the two do not talk over each other; guidance then goes to the live region only. Vibration patterns are used where the device supports them (most Android phones, not iPhone).

**Test mode** is `?debug=1`. It adds the live numbers under the camera (sharpness, brightness, glare, motion, text area, tilt, offset, fold, and which checks fail), the test-condition selector, a preview of the photo with the split drawn on it, buttons to mark the split and the attempt, and the CSV download.

## Finding the text

The old corner-based page detection was replaced because it could not handle open books. Now (`src/checks.ts`):

1. A **paper mask**: light pixels (Otsu threshold) with the text holes filled, table and background left out, edge pulled in a little.
2. **Ink** inside the paper: an adaptive threshold (pixels clearly darker than their local average).
3. **Morphology**: dilation joins letters into words and lines into blocks.
4. The **text block** is found from row and column profiles of the joined ink. It is checked against the frame: big enough, centred, margins, and not running into an edge (cut off).
5. **Tilt** is the angle at which the text lines pile up into the sharpest horizontal bands (a projection-profile search, about ±15 degrees).
6. Sharpness (variance of the Laplacian), lighting, glare and stability are measured on the text block, so the page edge and the table do not distort them.

Guidance is spoken only when the state changes, at most one phrase every 3 seconds, and every phrase is under five words ("Move phone left", "Straighten the page", "Hold steady", "Too dark", "Reduce glare", "Find the page"). A short tone repeats and its pitch rises as more checks pass. Two quick rising tones mean everything is right. Hints say "phone" when the rear camera is used, and "page" with a mirrored preview on a laptop webcam.

## Open books

In Settings choose **One page** or **Open book, two pages** (remembered), and for a book **Both** (default), **Left** or **Right**.

In open-book mode the photo is analysed again at capture time:

- The **fold** is a wide empty vertical band near the middle of the text block, and/or a dark vertical valley (the shadow in the fold). Either alone is accepted; both agreeing is more confident. The block must be wider than tall, so a portrait single page is never split.
- If a fold is found the photo is cut inside the empty gap into a left and a right crop. Each crop is read separately, left then right, and the app says "Left page" and "Right page", or "Page 82" if OCR finds a page number on that page.
- If no fold is found it says "Could not find the fold. Reading as one page." and reads the text block as one page.
- With Auto language, the first page decides the language for the second.

In test mode the split is drawn on the photo (green left crop, red right crop, yellow fold) and **Split was right / Split was wrong** record your verdict.

## Voices

- Speech uses the browser's `speechSynthesis`. Settings lists **every** voice the device has for English and for Sinhala, with a Preview button each, plus speed and pitch sliders. If only one voice exists it says so; if none exists it says so and the text stays on screen. The chosen voices are remembered.
- Spoken labels such as "Left page" use the English voice.

### Online voice (optional, off by default)

If the device has no Sinhala voice, a **Read with online voice** button can appear. It is never used automatically: the text is sent only when the person presses it, in pieces of at most 300 characters, and nothing is stored or cached.

`api/tts.ts` is a small Vercel function with two possible routes:

| Route | Turned on by | Notes |
|---|---|---|
| Azure Speech (si-LK Thilini and Sameera) | `AZURE_SPEECH_ENABLED=1`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | official, uses your own Azure resource |
| Microsoft Edge read-aloud, then Google Translate speech | `TTS_FALLBACK=1` | **unofficial**: not a public API with a service agreement, can change or block requests without notice, and may go against the providers' terms of use. Fine for testing, unreliable for production. |

With none of these set the function answers 404 and nothing is sent anywhere. The button only appears if the site was also built with `VITE_TTS_FALLBACK=1`. Azure is tried first when it is configured. Speed applies to online audio; pitch does not.

For local testing: `VITE_TTS_FALLBACK=1 TTS_FALLBACK=1 npm run dev`.

**Enabling Azure Speech (optional)**

1. In the Azure portal create a **Speech** resource and open **Keys and Endpoint**. Note one key and the region (for example `southeastasia`).
2. In Vercel open the project, then **Settings > Environment Variables**, and add `AZURE_SPEECH_ENABLED=1`, `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`. Add `VITE_TTS_FALLBACK=1` so the button shows. Do not give the key a `VITE_` prefix: it must stay on the server.
3. Redeploy (the `VITE_` variable only applies to a new build). In Settings the "Online Sinhala voice" choice then lets you pick Sameera or Thilini.
4. Check what it costs before you use it. Azure may offer a limited free tier and charges beyond it, and I did not verify the current limits or prices. Set a spending alert in Azure. Nothing here is enabled, and nothing costs money, unless you set these variables. Never put the key in the repository.

## Tuning the thresholds

Everything is in one object at the top of `src/config.ts`. The main ones:

| Setting | Default | Meaning |
|---|---|---|
| `analysis.fps` / `width` | 8 / 640 | checks per second, and the width the frame is analysed at |
| `text.windowRadius`, `text.contrast` | 8, 12 | adaptive threshold: window and how much darker than average counts as ink |
| `text.joinX`, `text.joinY` | 5, 1 | morphology: how far letters and lines are joined |
| `text.cutShare` | 0.2 | text counts as cut off when this share of lines reach the frame edge |
| `framing.minAreaFrac` / `maxWidthFrac` | 0.25 / 0.97 | text block must fill this share of the frame, and not be wider than this |
| `framing.maxCentreOffset` | 0.12 | allowed offset of the text block from the centre |
| `tilt.maxDegrees` | 5 | beyond this: "Straighten the page" |
| `gutter.minAspect` | 1.05 | text block width / height needed before a fold is looked for |
| `gutter.emptyFrac`, `gutter.minBandFrac` | 0.25, 0.02 | how empty and how wide the gap must be |
| `gutter.shadowDepth` | 0.07 | how much darker than both sides the fold shadow must be |
| `sharpness.minLaplacianVariance` | 100 | below this: "Hold steady" (a sharp test page scored about 2000 to 4000, a heavily blurred one about 7) |
| `light.minMeanBrightness` / `maxMeanBrightness` / `maxGlareFrac` | 70 / 235 / 0.06 | too dark, too bright, share of blown-out pixels |
| `stability.maxMeanDiff` / `holdMs` | 3.0 / 1000 | how still the picture must be, for how long |
| `capture.autoHoldMs` | 1000 | all checks must pass this long before auto-capture |
| `speech.minGapMs` | 3000 | at most one guidance phrase this often |
| `tones.*`, `vibration.*` | | tone pitch range and interval, vibration patterns |

The defaults were set on test frames and a fake camera, not on real phones. Expect to adjust sharpness, brightness, `text.contrast` and the fold settings. Use `?debug=1` while tuning.

## Test log

Every captured attempt is stored in the browser's `localStorage` and downloaded with **Download log (CSV)** in test mode. Columns: time, test condition, camera mode, seconds to capture, number and text of hints spoken, auto or manual capture, OCR language requested and used, OCR confidence and time, characters, rating, **layout setting** (one page or open book), **decision** (single or spread), **fold found** and its position, **which page was read** (page, left, right or both), and **your split verdict** (right, wrong or empty). The log stays on the device, and clearing the site data deletes it, so download it after each session.

### Test checklist

Do 10 attempts in each condition, choosing it in Settings (test mode) before each attempt: **bright light, dim light, tilted page, glare, open book**. Do not coach the person. An attempt is a good first try if the photo was taken without anyone stepping in and the text was usable.

For each condition note: first-try success rate, median and range of seconds to capture, hints per attempt and which came up most, auto against manual capture, OCR confidence and readability, and anything the hints got wrong.

For the **open book** condition also note, for each attempt: did it find the fold (single or spread as expected), was the split right (use the buttons), was each page read in the right order with the right label, and was any text lost at the cut. Try thick books, thin books, books that do not lie flat, text close to the fold, a pictures-only page, and a book on a white table.

## Tested and not tested

Tested:

- Unit tests (`npm test`, 22 tests) on real textbook pages and synthetic open books: text found, framing, off-centre, cut off, tilt, blur, darkness, glare, stability, the fold in four spreads (flat, shadowed and curled, rotated, Sinhala), no fold on single pages, cuts inside the gap, Left/Right/Both, page numbers, and phrases under five words.
- Headless Chrome with a fake camera playing full-size scenes: single page, open book (English and Sinhala), open-book setting with a single page, Left only, the introduction and its skip, state changes and focus, and hints for small, tilted, blurred, dark and off-centre pages. In the English open book both pages were read separately in order; the Sinhala spread found a page number.
- The online voice function: off by default (404), capabilities check, Sameera and Thilini, and the Azure route being tried first and failing cleanly with a fake key.

Not tested:

- **Real open-book photos.** The spreads are synthetic (two pages side by side with a fold shadow, text squeezed towards the fold, and a slight rotation). Real books have curved lines of text, perspective, hands, uneven light and thick page edges.
- The phone rear camera, autofocus, exposure, vibration, and a real laptop webcam.
- Real speech voices: whether target phones have a Sinhala voice, and whether the voice preview and the Sinhala sample sentence sound right.
- TalkBack and VoiceOver with the app (the markup follows the usual rules, but I have not used a screen reader on it).
- Safari and Firefox, the deployed Vercel build, and Azure Speech with a real key.

## Still weak

- Fold detection is the weakest part. It works on synthetic books but may fail on real ones (a tight gutter with no gap, a page full of pictures, text that curves into the fold). When it fails the app reads the book as one page and says so.
- A two-column single page can look like a spread in open-book mode, so use "One page" for those.
- The text block assumes light paper on a darker background. Dark paper, glossy pages and a white table (which hides the page edge) may confuse it. Handwriting is not supported.
- Reading quality: OCR on a skewed or curved page is worse than on a flat one, and the in-browser models are the smaller `tessdata_fast`.
- Sinhala voices depend on the device. Without one, the choices are text on screen or the unofficial online voice.
- Spoken instructions are English only (`src/guidance.ts` holds the phrases).

## Deploy on Vercel

1. Put the repository on GitHub (Vercel needs a Pro plan for private repositories owned by an organisation, so use a personal account or a public repository).
2. In Vercel choose **Add New Project** and import it.
3. Set **Root Directory** to `web`. Framework preset **Vite** (build `npm run build`, output `dist`).
4. No environment variables are needed for the base app. Deploy.

Vercel serves the site over HTTPS, which the camera needs. Add the optional online-voice variables only if you want them.
