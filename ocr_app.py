from __future__ import annotations

import asyncio
import hashlib
from io import BytesIO
from pathlib import Path

import edge_tts
import streamlit as st
import pytesseract
from gtts import gTTS
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parent
TESSDATA_DIR = ROOT / "tessdata_best"
LANGUAGES = {
    "English": {
        "tesseract": "eng",
        "voices": {
            "Jenny (Edge TTS)": ("edge", "en-US-JennyNeural"),
            "Ava (Edge TTS)": ("edge", "en-US-AvaNeural"),
            "Google TTS": ("google", "en"),
        },
    },
    "Sinhala": {
        "tesseract": "sin",
        "voices": {
            "Sameera (Edge TTS)": ("edge", "si-LK-SameeraNeural"),
            "Thilini (Edge TTS)": ("edge", "si-LK-ThiliniNeural"),
            "Google TTS": ("google", "si"),
        },
    },
}


async def edge_audio(text: str, voice: str) -> bytes:
    chunks = []
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    if not chunks:
        raise RuntimeError("The selected voice returned no audio.")
    return b"".join(chunks)


def generate_audio(text: str, provider: str, voice: str) -> bytes:
    if provider == "edge":
        return asyncio.run(edge_audio(text, voice))
    audio_buffer = BytesIO()
    gTTS(text=text, lang=voice, timeout=30).write_to_fp(audio_buffer)
    return audio_buffer.getvalue()

st.set_page_config(page_title="Read it back", page_icon=":material/graphic_eq:", layout="wide")
st.markdown(
    """
    <style>
    :root {
        --ink: #17241d;
        --muted: #64736a;
        --paper: #f4f6ef;
        --panel: #ffffff;
        --line: #dce4da;
        --green: #245c43;
        --lime: #d5f36a;
    }
    [data-testid="stAppViewContainer"] { background: var(--paper); color: var(--ink); }
    [data-testid="stHeader"] { background: transparent; }
    .block-container { max-width: 1180px; padding-top: 2rem; padding-bottom: 4rem; }
    h1, h2, h3 { color: var(--ink); }
    h1 { font-family: Georgia, "Times New Roman", serif; font-size: 3rem; font-weight: 500; }
    [data-testid="stCaptionContainer"] p { color: var(--muted); }
    [data-testid="stFileUploader"] section { background: var(--panel); border: 1px dashed #91a296; border-radius: 8px; }
    [data-testid="stButton"] button[kind="primary"] {
        background: var(--green); color: white; border: 0; border-radius: 6px; min-height: 3rem;
    }
    [data-testid="stButton"] button[kind="primary"]:hover { background: #193f2e; border: 0; }
    [data-testid="stAudio"] { margin-top: .5rem; }
    hr { border-color: var(--line); }
    </style>
    """,
    unsafe_allow_html=True,
)

st.caption("IMAGE  /  TEXT  /  SPEECH")
st.title("Read it back")
st.write("Upload a page to extract its text and hear it spoken aloud.")
st.divider()

upload_column, result_column = st.columns([0.95, 1.05], gap="large")

with upload_column:
    st.subheader("1. Choose an image")
    uploaded = st.file_uploader(
        "Upload a page or sign",
        type=["png", "jpg", "jpeg", "webp", "tif", "tiff"],
        accept_multiple_files=False,
        label_visibility="collapsed",
    )
    language_name = st.radio("Text language", options=list(LANGUAGES), horizontal=True)
    voice_name = st.selectbox("Voice", options=list(LANGUAGES[language_name]["voices"]))
    st.caption("OCR runs locally. Speech generation sends the text to the selected online TTS service.")

    if uploaded is not None:
        try:
            preview = ImageOps.exif_transpose(Image.open(BytesIO(uploaded.getvalue()))).convert("RGB")
            st.image(preview, caption=uploaded.name, use_container_width=True)
        except Exception as exc:
            st.error(f"Could not open this image: {exc}")
            uploaded = None

    extract_text = st.button(
        "Extract text",
        type="primary",
        icon=":material/document_scanner:",
        use_container_width=True,
        disabled=uploaded is None,
    )

with result_column:
    st.subheader("2. Text and audio")
    result_key = None
    if uploaded is not None:
        digest = hashlib.sha256(uploaded.getvalue()).hexdigest()
        result_key = f"{digest}:{language_name}"

    if extract_text and uploaded is not None and result_key is not None:
        language = LANGUAGES[language_name]
        try:
            image = ImageOps.exif_transpose(Image.open(BytesIO(uploaded.getvalue())))
            image = ImageOps.autocontrast(ImageOps.grayscale(image))
            with st.spinner("Reading the image..."):
                transcript = pytesseract.image_to_string(
                    image,
                    lang=language["tesseract"],
                    config=f'--tessdata-dir "{TESSDATA_DIR}" --psm 6',
                ).strip()
            st.session_state["ocr_result"] = {
                "key": result_key,
                "transcript": transcript,
                "audio": None,
                "audio_voice": None,
            }
        except Exception as exc:
            st.error(f"Could not process this image: {exc}")

    result = st.session_state.get("ocr_result")
    if result and result.get("key") == result_key:
        transcript = result["transcript"]
        if transcript:
            transcript = st.text_area(
                "Recognized text (edit before generating if needed)",
                value=transcript,
                height=300,
                key=f"transcript_{result_key}",
            )
            voice_provider, voice_id = LANGUAGES[language_name]["voices"][voice_name]
            generate = st.button(
                "Generate audio",
                type="primary",
                icon=":material/graphic_eq:",
                use_container_width=True,
                disabled=not transcript.strip(),
            )
            if generate:
                try:
                    with st.spinner(f"Generating audio with {voice_name}..."):
                        audio_data = generate_audio(transcript.strip(), voice_provider, voice_id)
                    result["audio"] = audio_data
                    result["audio_voice"] = voice_name
                except Exception as exc:
                    result["audio"] = None
                    st.error(f"Audio generation failed: {exc}")
            if result.get("audio") and result.get("audio_voice") == voice_name:
                st.audio(result["audio"], format="audio/mp3")
                st.download_button(
                    "Download audio",
                    data=result["audio"],
                    file_name="read-it-back.mp3",
                    mime="audio/mpeg",
                    icon=":material/download:",
                )
            elif result.get("audio"):
                st.info("Choose Generate audio to create a clip with the selected voice.")
        else:
            st.warning("No text was detected. Try a sharper image or check the selected language.")
    else:
        st.info("Your extracted text and audio will appear here.", icon=":material/hearing:")
