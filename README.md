# Swara OCR

Reads text from a photo of a printed page, in English or Sinhala, and speaks it aloud. It is part of TableTop Reader, a reading assistant for blind and low-vision people.

## Layout

| Folder | Contents |
|---|---|
| `app/` | Streamlit app: upload an image, run Tesseract locally, edit the text, generate speech |
| `benchmark/` | OCR benchmark scripts, test photos with answer text, `results.csv` and `ocr_report.md` |
| `docs/` | Setup guide and text-to-speech notes |
| `tessdata_best/` | English and Sinhala Tesseract models, shared by the app and the benchmark |

## Quick start (app)

Needs Python 3.10+ and the Tesseract program on your `PATH` (see [docs/setup.md](docs/setup.md)).

```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\Activate.ps1
python -m pip install -r app/requirements.txt
streamlit run app/ocr_app.py
```

Open <http://localhost:8501>. OCR runs on your computer. Speech generation sends the text to the chosen online service (Microsoft Edge TTS or Google TTS), so an internet connection is needed for audio.

## Benchmark

Compares Tesseract variants and, if you provide a key, Gemini and Claude on the photos in `benchmark/testset/`. Each photo `name.png` has an answer file `name.txt`; the prefix sets the language (`en_` English, `sn_` or `si_` Sinhala). The metric is character error rate (CER), lower is better.

```bash
python -m pip install -r benchmark/requirements.txt
python benchmark/ocr_benchmark_run.py benchmark/testset --providers tesseract,tesseract_best,tesseract_clean --out benchmark/results.csv
```

Providers: `tesseract`, `tesseract_best` (uses `tessdata_best`), `tesseract_clean` (adds image clean-up), `gemini` and `claude` (need `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` set in your shell; they upload the photos to those services). `benchmark/ocr_benchmark.py` is the original script. Copy `.env.example` to `.env` for local keys; `.env` is ignored by Git and must never be committed.

Results and conclusions are in [benchmark/ocr_report.md](benchmark/ocr_report.md). The test set is small and mostly clean screenshots, and the answer text was not typed by hand, so treat the numbers as early results. A receipt photo used in testing is kept out of the repository.

## Troubleshooting

See [docs/setup.md](docs/setup.md) for installing Tesseract on each system and for common problems.
