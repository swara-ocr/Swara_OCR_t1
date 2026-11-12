# Setup guide

Step-by-step setup for Windows, macOS and Linux. Run all commands from the repository root.

A small local web app that extracts English or Sinhala text from an image and reads it aloud. Tesseract performs OCR on the computer running the app. Speech generation uses the selected online provider (Microsoft Edge TTS or Google TTS), so the extracted text is sent to that provider.

## Requirements

- Python 3.10 or newer
- Tesseract OCR installed on the computer and available on `PATH`
- Internet access for speech generation

The repository includes the English and Sinhala Tesseract model files in `tessdata_best/`.

## 1. Get the project

Clone the repository and enter its folder:

```bash
git clone https://github.com/swara-ocr/Swara_OCR_t1.git
cd Swara_OCR_t1
```

If you already have the repository, open a terminal in its root folder instead.

## Windows quick start in VS Code

1. Open the cloned repository folder in VS Code.
2. Open **Terminal > New Terminal** (or press **Ctrl+`**). The commands below use PowerShell in the VS Code integrated terminal.
3. Install Tesseract from that terminal:

	```powershell
	winget install --id UB-Mannheim.TesseractOCR --exact
	```

	If `winget` is unavailable or cannot find the package, use the Windows installer linked in the next section. After installing, close and reopen the VS Code terminal, then verify:

	```powershell
	tesseract --version
	```

4. Create the virtual environment, install dependencies, and start the app. These commands do not require activating the environment:

	```powershell
	py -m venv .venv
	.\.venv\Scripts\python.exe -m pip install --upgrade pip
	.\.venv\Scripts\python.exe -m pip install -r app/requirements.txt
	.\.venv\Scripts\python.exe -m streamlit run app/ocr_app.py
	```

5. Open the local URL printed in the terminal, usually <http://localhost:8501>.

## 2. Install Tesseract OCR

Install the system Tesseract program. The Python package alone does not include the Tesseract executable.

**Ubuntu or Debian**

```bash
sudo apt update
sudo apt install -y tesseract-ocr
```

**macOS with Homebrew**

```bash
brew install tesseract
```

**Windows**

Install Tesseract using the Windows installer linked from the [Tesseract documentation](https://tesseract-ocr.github.io/tessdoc/Installation.html). During setup, enable the option to add Tesseract to `PATH`, or add its installation folder to `PATH` afterwards. Restart the terminal after changing `PATH`.

Check that the command is available:

```bash
tesseract --version
```

## 3. Create a Python environment

**Ubuntu, Debian, or macOS**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows PowerShell**

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
```

**Windows Command Prompt**

```bat
py -m venv .venv
.venv\Scripts\activate.bat
```

## 4. Install Python dependencies

With the virtual environment activated, run:

```bash
python -m pip install --upgrade pip
python -m pip install -r app/requirements.txt
```

## 5. Start the app

From the repository root, run:

```bash
streamlit run app/ocr_app.py
```

Open the local URL printed by Streamlit, usually <http://localhost:8501>.

## 6. Use the app

1. Choose English or Sinhala and select a voice.
2. Upload a PNG, JPG, JPEG, WEBP, or TIFF image.
3. Select **Extract text**. Tesseract reads the image locally.
4. Review and, if needed, edit the recognized text.
5. Select **Generate audio**, then press play in the audio player. Use **Download audio** to save the MP3.

## Troubleshooting

- **`TesseractNotFoundError`**: Install the system Tesseract program, make sure `tesseract --version` works in the same terminal, then restart the app.
- **Missing `eng` or `sin` language data**: Confirm `tessdata_best/eng.traineddata` and `tessdata_best/sin.traineddata` are present. They are included in this repository.
- **Speech generation fails**: Check internet access and try another voice/provider. The speech providers are online services.
- **PowerShell blocks environment activation**: Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` in PowerShell, or use Command Prompt activation instead.

The `.venv/` environment and `.env` file are local and ignored by Git. Each collaborator creates their own environment; do not commit API keys or secrets.
