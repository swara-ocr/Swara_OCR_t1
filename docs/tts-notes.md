# Text-to-speech notes

Findings from an early OCR-to-speech check. The generated audio and per-run CSV files mentioned below were not kept in the repository.

## OCR-to-speech smoke test

The earlier short eSpeak demo used manually written prompts, not OCR output, so it did **not** test the requested OCR-to-speech flow. The following local smoke test does: image -> the benchmark's Tesseract function -> its unedited recognized text -> eSpeak NG -> WAV audio. No image was uploaded to a cloud API.

| Language | Image | OCR text | Preview audio | Full-page audio |
|---|---|---|---|---|
| English | `testset/en_textbook_07.png` | `tts_samples/ocr_pipeline/en_ocr.txt` (239 words) | `tts_samples/ocr_pipeline/en_preview_ocr_to_speech.wav` (5.73 s) | `tts_samples/ocr_pipeline/en_ocr_to_speech.wav` (76.16 s) |
| Sinhala | `testset/sn_textbook_01.png` | `tts_samples/ocr_pipeline/sn_ocr.txt` (232 words) | `tts_samples/ocr_pipeline/sn_preview_ocr_to_speech.wav` (8.20 s) | `tts_samples/ocr_pipeline/sn_ocr_to_speech.wav` (119.22 s) |

Both use local eSpeak NG 1.52.0 (`en-us` and `si` voices); the WAVs are mono, 22,050 Hz, 16-bit PCM and decoded successfully. The short previews are passages selected verbatim from the saved OCR output; the full-page files speak all of the recognized text. Timings and file metadata are in `tts_samples/ocr_pipeline/pipeline_results.csv` and `tts_samples/ocr_pipeline/preview_results.csv`.

This only verifies that recognized text is passed to a local speech engine and that audio is produced. It does **not** establish that the speech is understandable or suitable for a blind or low-vision reader. The Sinhala OCR has a likely character error (`චිචාරණය`), and TTS speaks the OCR result as-is; speech cannot fix recognition mistakes. A human should listen to the previews and judge intelligibility.

Gemini 3.8 Flash TTS was attempted but returned HTTP 403 because Gemini API free-tier access is unavailable for this Google project and billing is not enabled; it produced no audio. The earlier manually prompted clips are not OCR-to-speech test results. This workspace has no application implementation to test: the separate project repository tracks only a README and the OCR benchmark in `test.py`, with no app entry point or existing TTS integration. So this is a harness-level local pipeline test, not verification of the deployed app.

### Free platform voice availability check

| Platform available in this test environment | Result |
|---|---|
| Linux desktop | eSpeak NG generated and decoded the OCR-derived WAVs above; the user reports the voice is not understandable enough, so this is not a quality pass. |
| Web browser | No browser speech voices were available (`speechSynthesis.getVoices()` returned an empty list); a browser speech request failed with `synthesis-failed`. |
| Android | No Android bridge/device is connected, so the device's built-in TTS could not be invoked or recorded here. |

No paid service was used. To test the free Android voice, the same OCR transcript needs to be opened or pasted on an Android device with its preferred text-to-speech engine installed; that device is not accessible from this workspace.

### Python neural-voice comparison (English only)

With the user's permission, the 93-character English OCR preview in `tts_samples/ocr_pipeline/en_preview_ocr.txt` was sent as text (no page image) to Microsoft Edge's online TTS service using the Python `edge-tts` client. This generated two neural-voice MP3s without Google Cloud credentials or billing. The client is Python, but synthesis is online rather than offline.

| Voice | Duration | Output |
|---|---:|---|
| `en-US-JennyNeural` | 7.85 s | `tts_samples/ocr_pipeline/edge_tts/en-US-JennyNeural.mp3` |
| `en-US-AvaNeural` | 6.77 s | `tts_samples/ocr_pipeline/edge_tts/en-US-AvaNeural.mp3` |

Both files passed MP3 decoding checks. Only English was authorized; no Sinhala text was sent to the service. This checks speech generation, not whether a listener finds either voice understandable. Listen to both and choose based on actual clarity. Generation metadata is in `tts_samples/ocr_pipeline/edge_tts/results.csv`.
