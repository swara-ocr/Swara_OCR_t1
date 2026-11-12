# TableTop Reader – OCR benchmark, run 3 (free options: Tesseract variants + Gemini free tier)

## What ran and what did not
| Provider | Status |
|---|---|
| tesseract (default models, as in the original script) | ran, 18/18 images |
| tesseract_best (`tessdata_best` eng + sin) | ran, 18/18 |
| tesseract_clean (`tessdata_best` + grayscale, auto-contrast, 2x upscale, denoise, adaptive threshold, deskew) | ran, 18/18 |
| gemini (`gemini-3.5-flash`, free tier) | ran on 15 of 17 textbook images. The first three keys tried returned 403 (free tier / billing unavailable, so Gemini was first dropped); the fourth key worked. `gemini-flash-latest` and `gemini-3.8-flash` kept returning 503 "high demand", so `gemini-3.5-flash` was used. No valid result for **en_textbook_07** (empty reply from the API; this is not an OCR error) or **sn_textbook_07** (429 rate limit, then the network dropped). Retries were stopped after that. |
| Surya OCR | **skipped.** Installed version 0.22.1 needs vLLM (Docker/GPU) or a `llama-server` binary plus a multi-GB model download. This machine has neither and the link is ~0.8 MB/s. I stopped after three install attempts. |
| Claude vision | not run (no API key; no paid APIs available). |

The receipt photo (`en_bill_01.jpeg`) was **not** sent to Gemini. The 15 textbook pages were sent to Google's Gemini API. CER and text normalisation are unchanged from the original script and the prompt is unchanged, so numbers are comparable.

## Test set
18 images in `benchmark/testset/` (the receipt photo is kept out of the repository): 11 English (10 textbook pages + 1 receipt photo) and 7 Sinhala textbook pages. `en_textbook_03` and `04` are identical, so there are 10 unique English images. Target was about 15 per language. All are screenshots of digital pages (696×908) except the receipt. The filenames do not say phone or webcam, so there is no device comparison.

## Results A – the 15 images where all four providers have a valid result
Mean CER (lower is better) and mean seconds. "Excl." drops the bar chart (`en_textbook_05`) and map page (`sn_textbook_05`), which are not running text.

| Language | Provider | Mean CER | Median CER | Mean sec | Excl. chart/map |
|---|---|---|---|---|---|
| English (n=9) | tesseract | **0.102** | 0.107 | **1.1** | **0.090** |
| English | tesseract_best | 0.111 | 0.099 | 2.3 | 0.101 |
| English | tesseract_clean | 0.174 | 0.132 | 4.9 | 0.165 |
| English | gemini | 0.258 | 0.197 | 13.5 | 0.265 |
| Sinhala (n=6) | tesseract | 0.101 | 0.069 | 1.9 | 0.059 |
| Sinhala | tesseract_best | 0.104 | 0.068 | 3.0 | 0.059 |
| Sinhala | tesseract_clean | 0.349 | 0.099 | 5.9 | 0.083 |
| Sinhala | gemini | 0.351 | **0.027** | 17.3 | **0.023** |

**Why Gemini's English number is poor.** Gemini formats its answer: it writes tables with `|` and `**`, bullets as `•`, and keeps dotted blanks ("........"). The unchanged CER counts all of these as errors, and `en_textbook_10` scores 1.13 almost entirely because of dotted blanks. As a **diagnostic only** (not used for the ranking), stripping those symbols from Gemini's output gives CER 0.038 on English text pages (vs 0.090 for plain Tesseract) and 0.010 on Sinhala (vs 0.059). So Gemini reads the text itself well; the penalty is mostly formatting. The raw numbers are the fair ones for "what comes out of the engine", unless a post-processing step removes the formatting.

On Sinhala, Gemini is clearly best on text pages even by the raw metric: 0.014–0.031 per page against 0.032–0.094 for plain Tesseract. The Sinhala mean (0.351) is dragged up by the map page, where Gemini correctly read the map labels (which the answer file leaves out) and scored 1.99.

## Results B – all 18 images, Tesseract variants only (from run 2)
| Language | Provider | Mean CER | Mean sec | Excl. chart/map/receipt |
|---|---|---|---|---|
| English (n=11) | tesseract | **0.106** | 1.2 | **0.083** |
| English | tesseract_best | 0.116 | 2.4 | 0.094 |
| English | tesseract_clean | 0.165 | 4.9 | 0.153 |
| Sinhala (n=7) | tesseract | **0.139** | 1.8 | 0.111 |
| Sinhala | tesseract_best | 0.142 | 2.9 | 0.111 |
| Sinhala | tesseract_clean | 0.312 | 5.8 | **0.084** |

## Five worst photos per language (CER: plain / best / clean / gemini)
**English** ("–" = no valid Gemini result)
| Photo | plain | best | clean | gemini |
|---|---|---|---|---|
| en_bill_01 (receipt) | 0.215 | 0.238 | 0.187 | not sent |
| en_textbook_05 | 0.201 | 0.193 | 0.247 | 0.197 |
| en_textbook_03 / 04 (identical) | 0.119 | 0.126 | 0.117 | 0.085 / 0.083 |
| en_textbook_01 | 0.116 | 0.099 | 0.201 | 0.024 |
| (worst for Gemini) en_textbook_10 | 0.093 | – | – | 1.128 |

**Sinhala**
| Photo | plain | best | clean | gemini |
|---|---|---|---|---|
| sn_textbook_07 | 0.368 | 0.369 | **0.093** | – |
| sn_textbook_05 (map) | 0.310 | 0.328 | 1.681 | 1.991 |
| sn_textbook_03 | 0.094 | 0.094 | 0.127 | 0.031 |
| sn_textbook_04 | 0.074 | 0.073 | 0.071 | 0.017 |
| sn_textbook_02 | 0.064 | 0.062 | 0.171 | 0.024 |

## Likely causes
- **en_bill_01** (real photo): small, low-contrast receipt print on a tinted background. Plain Tesseract misread "0112" as "One", a name as "lrangani", "Tel 00" as "Tel 60" and "1000.0" as "10000". Preprocessing helped a little (0.215 to 0.187). Gemini was not tested on it, because it shows a restaurant name, phone number and invoice ID.
- **en_textbook_05** (bar chart) and **sn_textbook_05** (map): the engines also read axis numbers or map labels, which the answer file leaves out, so they count as insertions. Test-design effect, not a reading failure.
- **en_textbook_01, 02, 03/04** for Tesseract: the activity icon is read as stray symbols such as "®)". Multi-column text wrapped around photos and tables add errors. `tesseract_clean` made several of these worse because thresholding pictures and coloured headings creates noise.
- **sn_textbook_07**: a coloured teal box and a table. Plain and best Tesseract skipped or garbled the box (0.37). Thresholding removed the coloured background and fixed it (0.09).
- **Gemini on en_textbook_02, 06, 09, 10**: formatting characters (tables, bullets, dotted blanks), not wrong letters. This is a formatting effect.
- **sn_textbook_02/03**: Tesseract's small Sinhala vowel-sign and word-ending errors (for example "ක්‍රියාකාරීත්වය" vs "ක්‍රියාකාරිත්වය") and stray quote marks. Some of these may be mistakes in the answer file.
- Tilt, glare and shadow did not play a role because the pages are screenshots, except possibly the receipt.

## Improvement over plain Tesseract
- **tesseract_best:** no real gain (English slightly worse, Sinhala unchanged) and about 2x slower.
- **tesseract_clean:** better on only 4 of 11 English and 4 of 7 Sinhala pages; much worse on pages with pictures, charts and maps. On Sinhala text pages (excl. map) it is better than plain (0.084 vs 0.111) and rescues the coloured-box page. About 4x slower.
- **gemini (Sinhala text pages):** about 60% lower CER than plain Tesseract (0.023 vs 0.059), at 8 to 10x the time.
- **gemini (English):** worse by the raw metric (0.265 vs 0.090 excl. chart), but roughly 2x better if formatting characters are stripped (0.038 vs 0.090, diagnostic only).

## Recommendation (free options)
- **Sinhala:** **Gemini free tier** (`gemini-3.5-flash`), by a large margin on text pages. It needs internet, uploads the page to Google, takes 10 to 20 s per page, and the free tier is rate-limited and often returns 503/429, so it needs retries.
- **English:** **plain Tesseract** by the raw metric (fast, offline, 0.090). Gemini reads English text well too, but its output must be cleaned of formatting first. With that clean-up it would likely be best, which was not tested end to end.
- **Fallback for both:** plain **Tesseract**, which works offline and has no limits. For Sinhala pages with coloured boxes or tables use `tesseract_clean` as the offline fallback. A rule for switching was not tested.
- These conclusions come from clean screenshots only. Real phone photos were not tested.

## Limits of this test
- Small sample: 9 valid English and 6 valid Sinhala images for the Gemini comparison (10 and 7 unique for Tesseract), below the ~15 target.
- Almost all images are clean screenshots from one textbook, not phone or webcam photos, so tilt, blur and glare are untested. The one real photo (receipt) was not tested with Gemini.
- **The answer text was transcribed by Claude from the images, not hand-typed.** It may contain mistakes, mainly in Sinhala, and it leaves out text inside charts, maps and photos and dotted blanks. It was not written by Gemini, but it was made by a different AI model, which can favour AI-style output over Tesseract. Check it by hand before using the numbers.
- Gemini's free tier was unstable (503, 429, a dropped connection, one empty reply), and `gemini-3.5-flash` was used only because the other models were overloaded. Results could differ on another day or model.
- One preprocessing recipe with fixed parameters and no tuning. `--psm 6` for all Tesseract variants.
- The prompt asks for a plain transcription, but Gemini still returned Markdown. The metric was not changed, so formatting counts as error.
- Surya and Claude vision are not included.

## Viva lines
1. We tested which free OCR setup reads Sinhala and English pages best (Tesseract with default models, better models and image cleaning, and Google's Gemini on its free tier), because a blind or low-vision user needs the text read correctly.
2. We scored each setup on the same textbook pages against reference text, with identical rules for every engine.
3. CER (character error rate) = (substitutions + deletions + insertions) ÷ characters in the reference, using edit distance after Unicode and whitespace normalisation.
4. A CER of 0.10 means about 1 in 10 characters is wrong; on Sinhala text pages Gemini scored about 0.02 and Tesseract about 0.06, while on English plain Tesseract scored 0.09 and Gemini's raw score was hurt by Markdown formatting.
5. The sample is small, mostly clean screenshots with Claude-made reference text, and Gemini's free tier is rate-limited, so these are early results, not a final ranking.

## Suggestions
Hand-check the answer files; test on real phone photos; test Gemini again with output clean-up (and a different model if 3.5-flash is unavailable); and, if budget ever allows, Google Cloud Vision or Azure Document Intelligence. No engine beyond the ones you asked for was added.
