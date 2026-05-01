from __future__ import annotations

import argparse
import json
import os
import re
import uuid
import subprocess
import shutil
import base64
import mimetypes
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable


@dataclass
class TranscriptSegment:
    index: int
    start: float
    end: float
    text: str


@dataclass
class ItemPaths:
    root: Path
    video_dir: Path
    audio_dir: Path
    transcript_dir: Path
    article_dir: Path
    work_dir: Path


def build_item_paths(root: Path) -> ItemPaths:
    return ItemPaths(
        root=root,
        video_dir=root / "video",
        audio_dir=root / "audio",
        transcript_dir=root / "transcripts",
        article_dir=root / "articles",
        work_dir=root / "work",
    )


def sanitize_path_component(value: str, fallback: str = "item", max_length: int = 120) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1F]+', " ", str(value))
    cleaned = re.sub(r"\s+", " ", cleaned).strip().strip(".")
    if not cleaned:
        cleaned = fallback
    return cleaned[:max_length]


def extract_video_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    match = re.search(r"(?:video/|aweme_id=|modal_id=)(\d{6,})", url)
    if match:
        return match.group(1)
    return None


def derive_item_slug(url: str | None = None, input_file: Path | None = None, info: dict | None = None) -> str:
    if input_file is not None:
        return sanitize_path_component(input_file.stem, fallback="input")

    if info:
        video_id = info.get("id")
        if video_id:
            return sanitize_path_component(str(video_id), fallback="item")

    video_id = extract_video_id_from_url(url)
    if video_id:
        return sanitize_path_component(video_id, fallback="item")

    if info:
        title = info.get("title")
        if title:
            return sanitize_path_component(str(title), fallback="item")

    if url:
        return f"pending-{uuid.uuid4().hex[:8]}"

    return "item"


def allocate_unique_item_root(items_dir: Path, slug: str) -> Path:
    candidate = items_dir / slug
    suffix = 2
    while candidate.exists():
        candidate = items_dir / f"{slug}-{suffix}"
        suffix += 1
    return candidate


def rebase_path(path: Path, old_root: Path, new_root: Path) -> Path:
    try:
        relative = path.relative_to(old_root)
    except ValueError:
        return path
    return new_root / relative


def move_item_root(item_root: Path, items_dir: Path, desired_slug: str) -> Path:
    if item_root.name == desired_slug:
        return item_root

    target_root = allocate_unique_item_root(items_dir, desired_slug)
    if target_root == item_root:
        return item_root

    shutil.move(str(item_root), str(target_root))
    return target_root


LogFn = Callable[[str], None]
URL_RE = re.compile(r"https?://[^\s<>\"']+")
TRAILING_URL_CHARS = "，。,.；;！!？?、）)]}】》"
TEXT_INPUT_SUFFIXES = {".txt", ".md", ".markdown", ".srt", ".vtt"}


def fail(message: str) -> None:
    raise SystemExit(f"\n{message}\n")


def extract_url(text: str) -> str:
    value = text.strip()
    match = URL_RE.search(value)
    if match:
        return match.group(0).rstrip(TRAILING_URL_CHARS)
    return value


def is_text_input_file(path: Path) -> bool:
    return path.suffix.lower() in TEXT_INPUT_SUFFIXES


def read_text_input(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            text = path.read_text(encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        fail(f"Could not read text file with UTF-8 or GB18030 encoding: {path}")

    suffix = path.suffix.lower()
    if suffix in {".srt", ".vtt"}:
        return clean_subtitle_text(text)
    return text.strip()


def clean_subtitle_text(text: str) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.upper() == "WEBVTT":
            continue
        if line.isdigit():
            continue
        if "-->" in line:
            continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if not line or line in seen:
            continue
        seen.add(line)
        lines.append(line)
    return "\n".join(lines).strip()


def require_dependencies() -> None:
    missing: list[str] = []
    for module_name, package_name in (
        ("yt_dlp", "yt-dlp"),
        ("faster_whisper", "faster-whisper"),
        ("imageio_ffmpeg", "imageio-ffmpeg"),
    ):
        try:
            __import__(module_name)
        except ImportError:
            missing.append(package_name)

    if missing:
        fail(
            "Missing dependencies: "
            + ", ".join(missing)
            + "\nInstall them with: python -m pip install -r requirements.txt"
        )


def get_ffmpeg_exe() -> str:
    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    if not Path(ffmpeg_exe).exists():
        fail("Could not find ffmpeg. Try reinstalling imageio-ffmpeg.")
    return ffmpeg_exe


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download a video from a link, extract audio, and transcribe it to text."
    )
    parser.add_argument("url", nargs="?", help="Video URL to download and transcribe.")
    parser.add_argument(
        "-o",
        "--output-dir",
        default="outputs",
        help="Folder for downloaded videos, audio, and transcripts. Default: outputs",
    )
    parser.add_argument(
        "--model",
        default="small",
        help="Local Whisper model size, or a remote model name when using --backend mimo. Common values: tiny, base, small, medium, large-v3.",
    )
    parser.add_argument(
        "--backend",
        default="local",
        choices=("local", "mimo"),
        help="Transcription backend. local uses faster-whisper, mimo uses your Xiaomi MiMo API.",
    )
    parser.add_argument(
        "--mimo-api-key",
        default=os.environ.get("MIMO_API_KEY"),
        help="Xiaomi MiMo API key. Defaults to the MIMO_API_KEY environment variable.",
    )
    parser.add_argument(
        "--mimo-base-url",
        default=None,
        help=(
            "Xiaomi MiMo API base URL. Leave empty to auto-detect from the key prefix. "
            "Pay-as-you-go keys use https://api.xiaomimimo.com/v1; token plan keys use https://token-plan-cn.xiaomimimo.com/v1"
        ),
    )
    parser.add_argument(
        "--mimo-model",
        default="mimo-v2.5",
        help="MiMo model for audio understanding. Supported: mimo-v2.5, mimo-v2-omni.",
    )
    parser.add_argument(
        "--generate-articles",
        action="store_true",
        help="After transcription, ask an LLM to write article drafts from the transcript.",
    )
    parser.add_argument(
        "--article-styles",
        default="xiaohongshu,professional",
        help="Comma-separated article styles to generate. Available: xiaohongshu, professional.",
    )
    parser.add_argument(
        "--article-length",
        default="long",
        choices=("standard", "long", "deep"),
        help="How expanded generated articles should be. Default: long.",
    )
    parser.add_argument(
        "--llm-api-key",
        default=os.environ.get("LLM_API_KEY") or os.environ.get("MIMO_API_KEY"),
        help="API key for article generation. Defaults to LLM_API_KEY, then MIMO_API_KEY.",
    )
    parser.add_argument(
        "--llm-base-url",
        default=os.environ.get("LLM_BASE_URL") or os.environ.get("MIMO_BASE_URL"),
        help="OpenAI-compatible base URL for article generation. Defaults to LLM_BASE_URL, then MIMO_BASE_URL.",
    )
    parser.add_argument(
        "--llm-model",
        default=os.environ.get("LLM_MODEL") or "mimo-v2.5",
        help="LLM model used for article generation. Default: mimo-v2.5.",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="Spoken language code, such as zh, en, ja. Leave empty for auto-detect.",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        choices=("cpu", "cuda", "auto"),
        help="Run transcription on cpu, cuda, or auto. Default: cpu",
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="faster-whisper compute type. Use int8 for CPU, float16 for CUDA.",
    )
    parser.add_argument(
        "--cookies",
        type=Path,
        help="Path to a Netscape-format cookies.txt file for sites that require login.",
    )
    parser.add_argument(
        "--cookies-from-browser",
        help=(
            "Read cookies from a browser profile, useful for login-protected videos. "
            "Examples: edge, edge:Default, chrome:Profile 1, firefox"
        ),
    )
    parser.add_argument(
        "--input-file",
        type=Path,
        help="Transcribe a local video/audio file instead of downloading from a URL.",
    )
    parser.add_argument(
        "--keep-audio-only",
        action="store_true",
        help="Extract audio and stop before transcription.",
    )
    parser.add_argument(
        "--browser-download",
        action="store_true",
        help="Use a real browser to capture media streams when yt-dlp cannot download the URL.",
    )
    parser.add_argument(
        "--browser-profile",
        default=str(Path("cookies") / "browser-profile"),
        help="Browser profile folder used by --browser-download. Default: cookies/browser-profile",
    )
    parser.add_argument(
        "--browser-channel",
        default="msedge",
        help="Playwright browser channel for --browser-download. Use bundled for Playwright Chromium.",
    )
    return parser


def download_video(
    url: str,
    video_dir: Path,
    ffmpeg_exe: str,
    cookies: Path | None = None,
    cookies_from_browser: str | None = None,
) -> tuple[Path, dict]:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    video_dir.mkdir(parents=True, exist_ok=True)
    options: dict = {
        "format": "bv*+ba/best",
        "merge_output_format": "mp4",
        "ffmpeg_location": ffmpeg_exe,
        "noplaylist": True,
        "outtmpl": str(video_dir / "%(title).180B [%(id)s].%(ext)s"),
        "windowsfilenames": True,
    }
    if cookies:
        options["cookiefile"] = str(cookies)
    if cookies_from_browser:
        options["cookiesfrombrowser"] = parse_browser_cookie_spec(cookies_from_browser)

    with YoutubeDL(options) as ydl:
        try:
            info = ydl.extract_info(url, download=True)
        except DownloadError as error:
            if cookies_from_browser and is_browser_cookie_error(error):
                fail(browser_cookie_error_message(cookies_from_browser, error))
            fail(f"Download failed.\n\nOriginal error:\n{error}")
        if "entries" in info:
            info = next(entry for entry in info["entries"] if entry)

        downloaded = find_downloaded_file(ydl.prepare_filename(info), info, video_dir)
        if not downloaded:
            fail("The video was downloaded, but the output file could not be located.")

        return downloaded, info


def browser_download_video(
    url: str,
    video_dir: Path,
    ffmpeg_exe: str,
    browser_profile: Path,
    browser_channel: str,
    mode: str = "audio",
) -> tuple[Path, dict]:
    node = shutil.which("node")
    if not node:
        fail("Node.js is required for --browser-download. Please install Node.js and run npm install.")

    script = Path(__file__).resolve().parent / "scripts" / "browser_download.mjs"
    if not script.exists():
        fail(f"Browser download helper is missing: {script}")

    video_dir.mkdir(parents=True, exist_ok=True)
    command = [
        node,
        str(script),
        "--url",
        url,
        "--output-dir",
        str(video_dir),
        "--profile",
        str(browser_profile),
        "--channel",
        browser_channel,
        "--ffmpeg",
        ffmpeg_exe,
        "--mode",
        mode,
    ]

    result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    payload_line = next(
        (line for line in reversed(result.stdout.splitlines()) if line.startswith("BROWSER_DOWNLOAD_RESULT=")),
        None,
    )
    if not payload_line:
        fail(f"Browser download did not return a result.\n\nOutput:\n{result.stdout}\n{result.stderr}")

    payload = json.loads(payload_line.split("=", 1)[1])
    video_path = Path(payload["output"]).resolve()
    if not video_path.exists():
        fail(f"Browser download reported a file that does not exist: {video_path}")

    return video_path, {
        "title": payload.get("title") or video_path.stem,
        "webpage_url": url,
        "download_method": "browser",
    }


def parse_browser_cookie_spec(spec: str) -> tuple[str, str | None, str | None, str | None]:
    browser_and_keyring, _, container = spec.partition("::")
    browser_and_keyring, _, profile = browser_and_keyring.partition(":")
    browser, _, keyring = browser_and_keyring.partition("+")
    return (
        browser.strip(),
        profile.strip() or None,
        keyring.strip() or None,
        container.strip() or None,
    )


def is_browser_cookie_error(error: Exception) -> bool:
    message = str(error).lower()
    markers = (
        "could not copy chrome cookie database",
        "failed to decrypt with dpapi",
        "failed to load cookies",
        "permission denied",
    )
    return any(marker in message for marker in markers)


def browser_cookie_error_message(cookies_from_browser: str, error: Exception) -> str:
    message = str(error)
    browser = cookies_from_browser.split(":", 1)[0].split("+", 1)[0]
    return (
        f"Could not read cookies from browser: {cookies_from_browser}\n\n"
        "This is common on Windows when the browser is still running, or when "
        "Chromium/Edge cookies cannot be decrypted through DPAPI.\n\n"
        "Try these fixes:\n"
        f"1. Close every {browser} window, then also end any remaining {browser} process in Task Manager.\n"
        "2. Run this tool again from the same Windows user account that is logged into the browser.\n"
        "3. If it still fails, export a Netscape-format cookies.txt file with this project's helper:\n"
        "   npm install\n"
        "   npm run export:cookies -- --url https://www.douyin.com --output .\\cookies\\douyin.txt\n"
        "   python .\\video_to_text.py \"VIDEO_URL\" --language zh --model tiny --cookies .\\cookies\\douyin.txt\n"
        "4. You can also try another logged-in browser, for example:\n"
        '   python .\\video_to_text.py "VIDEO_URL" --language zh --model tiny --cookies-from-browser chrome\n\n'
        "For Douyin, fresh cookies are usually required, so removing cookies may still fail.\n\n"
        f"Original yt-dlp error:\n{message}"
    )


def find_downloaded_file(prepared_filename: str, info: dict, video_dir: Path) -> Path | None:
    prepared_path = Path(prepared_filename)
    candidates = [prepared_path]

    if prepared_path.suffix.lower() != ".mp4":
        candidates.append(prepared_path.with_suffix(".mp4"))

    requested_downloads = info.get("requested_downloads") or []
    for item in requested_downloads:
        filepath = item.get("filepath") or item.get("_filename")
        if filepath:
            candidates.append(Path(filepath))

    for candidate in candidates:
        if candidate.exists():
            return candidate

    video_id = info.get("id")
    if video_id:
        matches = sorted(video_dir.glob(f"*[{video_id}].*"), key=lambda path: path.stat().st_mtime)
        if matches:
            return matches[-1]

    media_files = [
        path
        for path in video_dir.iterdir()
        if path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".wav"}
    ]
    if media_files:
        return sorted(media_files, key=lambda path: path.stat().st_mtime)[-1]

    return None


def extract_audio(input_file: Path, audio_dir: Path, ffmpeg_exe: str) -> Path:
    audio_dir.mkdir(parents=True, exist_ok=True)
    if input_file.suffix.lower() == ".wav":
        audio_path = audio_dir / input_file.name
        if input_file.resolve() == audio_path.resolve():
            return input_file
        shutil.copy2(input_file, audio_path)
        return audio_path

    audio_path = audio_dir / f"{input_file.stem}.wav"
    command = [
        ffmpeg_exe,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_file),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(audio_path),
    ]

    subprocess.run(command, check=True)
    return audio_path


def copy_media_to_dir(input_file: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / input_file.name
    if input_file.resolve() == output_path.resolve():
        return input_file
    shutil.copy2(input_file, output_path)
    return output_path


def format_timestamp(seconds: float, separator: str = ",") -> str:
    milliseconds = round(seconds * 1000)
    hours = milliseconds // 3_600_000
    milliseconds %= 3_600_000
    minutes = milliseconds // 60_000
    milliseconds %= 60_000
    secs = milliseconds // 1000
    milliseconds %= 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{milliseconds:03d}"


def transcribe_audio(
    audio_path: Path,
    model_name: str,
    language: str | None,
    device: str,
    compute_type: str,
) -> tuple[list[TranscriptSegment], dict]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    segments = [
        TranscriptSegment(
            index=index,
            start=segment.start,
            end=segment.end,
            text=segment.text.strip(),
        )
        for index, segment in enumerate(segments_iter, start=1)
    ]

    metadata = {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
    }
    return segments, metadata


def transcribe_audio_mimo(
    audio_path: Path,
    api_key: str,
    base_url: str | None,
    mimo_model: str,
    language: str | None,
    log: LogFn = print,
    chunk_seconds: int = 240,
) -> tuple[list[TranscriptSegment], dict]:
    try:
        from openai import OpenAI
    except ImportError as error:
        fail("Missing dependency: openai. Install it with: python -m pip install -r requirements.txt")

    if not api_key:
        fail("Missing MiMo API key. Set MIMO_API_KEY or pass --mimo-api-key.")

    client = OpenAI(api_key=api_key, base_url=resolve_mimo_base_url(api_key, base_url))
    chunks = split_wav_for_mimo(audio_path, chunk_seconds=chunk_seconds)
    log("Transcribing audio with MiMo...")

    segments: list[TranscriptSegment] = []
    usages: list[dict] = []
    for index, (chunk_path, start, end) in enumerate(chunks, start=1):
        log(f"MiMo chunk {index}/{len(chunks)}: {format_timestamp(start, '.')} - {format_timestamp(end, '.')}")
        text, usage = transcribe_mimo_chunk(
            client=client,
            audio_path=chunk_path,
            mimo_model=mimo_model,
            language=language,
        )
        if usage:
            usages.append(usage)
        if text:
            segments.append(TranscriptSegment(index=len(segments) + 1, start=start, end=end, text=text.strip()))

    if not segments:
        fail(
            "MiMo did not return transcript text. "
            "It returned no usable transcription content for the audio chunks."
        )

    metadata = {
        "backend": "mimo",
        "model": mimo_model,
        "language": language,
        "chunk_seconds": chunk_seconds,
        "chunks": len(chunks),
        "usage": merge_usage(usages),
        "chunk_usage": usages,
    }
    return segments, metadata


def transcribe_mimo_chunk(
    *,
    client: object,
    audio_path: Path,
    mimo_model: str,
    language: str | None,
) -> tuple[str, dict | None]:
    mime_type = mimetypes.guess_type(audio_path.name)[0] or "audio/wav"
    audio_bytes = audio_path.read_bytes()
    data_url = f"data:{mime_type};base64,{base64.b64encode(audio_bytes).decode('ascii')}"

    prompt = "请将音频逐字转写成文本，只输出转写结果，不要总结，不要解释。"
    if language:
        if language.lower().startswith("zh"):
            prompt = "请将音频逐字转写成中文文本，只输出转写结果，不要总结，不要解释。"
        else:
            prompt = f"Please transcribe the audio into {language} text. Output only the transcription."

    try:
        completion = client.chat.completions.create(
            model=mimo_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": data_url,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }
            ],
            max_completion_tokens=4096,
            temperature=0.0,
        )
    except Exception as error:
        message = str(error)
        if getattr(error, "status_code", None) == 401 or "401" in message or "Invalid API Key" in message:
            fail(
                "MiMo rejected the API key.\n\n"
                "Check these two things:\n"
                "1. Token Plan keys start with `tp-` and must use `https://token-plan-cn.xiaomimimo.com/v1`.\n"
                "2. Pay-as-you-go keys start with `sk-` and must use `https://api.xiaomimimo.com/v1`.\n\n"
                "Your key was not accepted by the selected base URL, or the key itself is no longer valid.\n"
                "Because the key was shared in chat, please rotate it in the MiMo console before trying again."
            )
        raise

    message = completion.choices[0].message
    text = extract_mimo_text(message).strip()
    if is_mimo_non_transcript(text):
        text = ""
    usage = completion.usage.model_dump() if getattr(completion, "usage", None) else None
    return text, usage


def split_wav_for_mimo(audio_path: Path, chunk_seconds: int) -> list[tuple[Path, float, float]]:
    with wave.open(str(audio_path), "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        frame_rate = source.getframerate()
        total_frames = source.getnframes()
        frames_per_chunk = max(1, int(frame_rate * chunk_seconds))
        duration = total_frames / frame_rate

        if duration <= chunk_seconds:
            return [(audio_path, 0.0, duration)]

        chunk_dir = audio_path.parent / f"{audio_path.stem}_mimo_chunks"
        chunk_dir.mkdir(parents=True, exist_ok=True)
        chunks: list[tuple[Path, float, float]] = []
        chunk_index = 1
        while source.tell() < total_frames:
            start_frame = source.tell()
            data = source.readframes(frames_per_chunk)
            if not data:
                break
            end_frame = source.tell()
            chunk_path = chunk_dir / f"{audio_path.stem}_part{chunk_index:03d}.wav"
            with wave.open(str(chunk_path), "wb") as target:
                target.setnchannels(channels)
                target.setsampwidth(sample_width)
                target.setframerate(frame_rate)
                target.writeframes(data)
            chunks.append((chunk_path, start_frame / frame_rate, end_frame / frame_rate))
            chunk_index += 1
        return chunks


def merge_usage(usages: list[dict]) -> dict | None:
    if not usages:
        return None

    merged: dict = {}
    for usage in usages:
        for key, value in usage.items():
            if isinstance(value, int):
                merged[key] = merged.get(key, 0) + value
            elif isinstance(value, dict):
                current = merged.setdefault(key, {})
                for nested_key, nested_value in value.items():
                    if isinstance(nested_value, int):
                        current[nested_key] = current.get(nested_key, 0) + nested_value
            elif key not in merged:
                merged[key] = value
    return merged


def resolve_mimo_base_url(api_key: str, requested_base_url: str | None) -> str:
    if requested_base_url:
        return requested_base_url

    if api_key.startswith("tp-"):
        return "https://token-plan-cn.xiaomimimo.com/v1"
    return "https://api.xiaomimimo.com/v1"


def extract_mimo_text(message: object) -> str:
    content = getattr(message, "content", None)

    if isinstance(content, str) and content.strip():
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
        joined = "\n".join(part.strip() for part in parts if part and part.strip())
        if joined:
            return joined
    return ""


def is_mimo_non_transcript(text: str) -> bool:
    if not text:
        return False
    markers = (
        "我是MiMo",
        "小米大模型Core团队",
        "响应风格",
        "安全与合规",
        "100万token的上下文窗口",
    )
    return sum(marker in text for marker in markers) >= 2


def write_transcripts(
    segments: Iterable[TranscriptSegment],
    metadata: dict,
    output_base: Path,
    log: LogFn = print,
) -> dict[str, Path]:
    segments = list(segments)
    output_base.parent.mkdir(parents=True, exist_ok=True)

    txt_path = output_base.with_suffix(".txt")
    srt_path = output_base.with_suffix(".srt")
    json_path = output_base.with_suffix(".json")

    txt_path.write_text("\n".join(segment.text for segment in segments) + "\n", encoding="utf-8")

    srt_blocks = []
    for segment in segments:
        srt_blocks.append(
            "\n".join(
                [
                    str(segment.index),
                    f"{format_timestamp(segment.start)} --> {format_timestamp(segment.end)}",
                    segment.text,
                ]
            )
        )
    srt_path.write_text("\n\n".join(srt_blocks) + "\n", encoding="utf-8")

    json_path.write_text(
        json.dumps(
            {
                "metadata": metadata,
                "segments": [asdict(segment) for segment in segments],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    log("\nTranscript files:")
    log(f"- Text: {txt_path}")
    log(f"- Subtitles: {srt_path}")
    log(f"- JSON: {json_path}")
    return {"txt": txt_path, "srt": srt_path, "json": json_path}


ARTICLE_STYLE_ALIASES = {
    "xhs": "xiaohongshu",
    "redbook": "xiaohongshu",
    "xiaohongshu": "xiaohongshu",
    "小红书": "xiaohongshu",
    "professional": "professional",
    "pro": "professional",
    "专业": "professional",
    "专业风格": "professional",
}

ARTICLE_STYLE_LABELS = {
    "xiaohongshu": "小红书风格",
    "professional": "专业风格",
}


def parse_article_styles(value: str | Iterable[str] | None) -> list[str]:
    if not value:
        return []

    if isinstance(value, str):
        raw_styles = re.split(r"[,，\s]+", value)
    else:
        raw_styles = list(value)

    styles: list[str] = []
    for raw_style in raw_styles:
        normalized = ARTICLE_STYLE_ALIASES.get(str(raw_style).strip().lower())
        if not normalized:
            if str(raw_style).strip():
                fail(f"Unsupported article style: {raw_style}")
            continue
        if normalized not in styles:
            styles.append(normalized)
    return styles


def resolve_llm_base_url(api_key: str, requested_base_url: str | None) -> str:
    if requested_base_url:
        return requested_base_url
    return resolve_mimo_base_url(api_key, None)


def build_article_prompt(style: str, transcript_text: str, article_length: str = "long") -> str:
    label = ARTICLE_STYLE_LABELS.get(style, style)
    length_rules = {
        "standard": (
            "文章长度要求：写成一篇完整文章，不要只写摘要。"
            "如果素材足够，正文建议 1200 到 1800 中文字。"
        ),
        "long": (
            "文章长度要求：写成较充分展开的长文，不要只提炼要点。"
            "如果素材足够，正文建议 2200 到 3500 中文字；短视频素材不足时，也要尽量展开背景、逻辑和启发。"
        ),
        "deep": (
            "文章长度要求：写成详细长文，尽量接近深度稿。"
            "如果素材足够，正文建议 4000 到 6000 中文字；保留细节、推理链、例子和转折，不要压缩成摘要。"
        ),
    }.get(article_length, "")
    common_rules = (
        "你只能根据转写稿写作，不要编造转写稿里没有的信息。\n"
        "如果转写稿有口误或重复，请自然整理，但不要改变原意。\n"
        "不要过度压缩内容；优先保留信息密度、细节、例子、论证过程和原作者表达的层次。\n"
        "如果转写稿本身信息量很大，请分段展开，不要只列核心观点。\n"
        f"{length_rules}\n"
        "输出 Markdown，不要解释你的写作过程。\n"
    )

    if style == "xiaohongshu":
        style_rules = (
            "请生成一篇小红书风格文章，要求：\n"
            "1. 标题抓人，但不要标题党。\n"
            "2. 开头要像笔记一样有代入感，快速抛出痛点或反差。\n"
            "3. 正文用短段落，口语化、有节奏，适合手机阅读。\n"
            "4. 每个关键观点都要展开成 2 到 4 段，包含解释、例子、适用场景或反直觉点。\n"
            "5. 保留原视频里的关键观点、例子、结论和有记忆点的表达。\n"
            "6. 正文之后给出 3 个备选标题、1 段封面文案、5 到 8 个话题标签。\n"
            "7. 不使用表情符号。\n"
        )
    elif style == "professional":
        style_rules = (
            "请生成一篇专业风格文章，要求：\n"
            "1. 结构清晰，适合公众号、知识库或业务报告阅读。\n"
            "2. 使用准确、克制、可信的表达。\n"
            "3. 包含摘要、背景、核心观点、详细分析、案例或例子、可执行建议和结论。\n"
            "4. 每个核心观点都要解释“为什么重要、依据是什么、适合什么场景、有什么限制”。\n"
            "5. 对观点进行归纳整理，但不要把文章写成短摘要，也不要夸大原视频内容。\n"
        )
    else:
        style_rules = f"请生成一篇{label}文章。"

    return (
        f"{common_rules}\n"
        f"{style_rules}\n"
        "转写稿如下：\n"
        "---\n"
        f"{transcript_text.strip()}\n"
        "---\n"
    )


def generate_article(
    *,
    transcript_text: str,
    style: str,
    api_key: str,
    base_url: str | None,
    model: str,
    article_length: str,
) -> tuple[str, dict | None]:
    try:
        from openai import OpenAI
    except ImportError:
        fail("Missing dependency: openai. Install it with: python -m pip install -r requirements.txt")

    if not api_key:
        fail("Missing LLM API key. Set LLM_API_KEY or MIMO_API_KEY, or fill it in the Web page.")

    client = OpenAI(api_key=api_key, base_url=resolve_llm_base_url(api_key, base_url))
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是一名中文内容编辑，擅长把视频转写稿整理成可发布文章。"
                    "你重视事实准确、结构清晰和可读性。"
                ),
            },
            {
                "role": "user",
                "content": build_article_prompt(style, transcript_text, article_length),
            },
        ],
        temperature=0.65 if style == "xiaohongshu" else 0.35,
        max_completion_tokens=8192,
    )
    message = completion.choices[0].message
    text = extract_mimo_text(message).strip()
    usage = completion.usage.model_dump() if getattr(completion, "usage", None) else None
    return text, usage


def write_article_metadata(
    output_path: Path,
    *,
    title: str,
    style: str,
    model: str,
    article_length: str,
    usage: dict | None,
) -> None:
    metadata_path = output_path.with_suffix(".json")
    metadata_path.write_text(
        json.dumps(
            {
                "title": title,
                "style": style,
                "style_label": ARTICLE_STYLE_LABELS.get(style, style),
                "model": model,
                "article_length": article_length,
                "usage": usage,
                "article": str(output_path),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def generate_articles(
    *,
    transcript_text: str,
    title: str,
    output_base: Path,
    styles: list[str],
    api_key: str | None,
    base_url: str | None,
    model: str,
    article_length: str = "long",
    log: LogFn = print,
) -> dict[str, Path]:
    if not transcript_text.strip():
        fail("Cannot generate articles because the transcript is empty.")
    if not styles:
        return {}

    output_base.parent.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, Path] = {}
    log("\nGenerating articles with LLM...")

    for style in styles:
        label = ARTICLE_STYLE_LABELS.get(style, style)
        log(f"- {label}")
        article_text, usage = generate_article(
            transcript_text=transcript_text,
            style=style,
            api_key=api_key or "",
            base_url=base_url,
            model=model,
            article_length=article_length,
        )
        if not article_text:
            fail(f"The LLM did not return article text for style: {label}")
        article_path = output_base.with_suffix(f".{style}.md")
        article_path.write_text(article_text.rstrip() + "\n", encoding="utf-8")
        write_article_metadata(
            article_path,
            title=title,
            style=style,
            model=model,
            article_length=article_length,
            usage=usage,
        )
        outputs[style] = article_path

    log("\nArticle files:")
    for style, path in outputs.items():
        log(f"- {ARTICLE_STYLE_LABELS.get(style, style)}: {path}")
    return outputs


def process_media(
    *,
    url: str | None = None,
    input_file: Path | None = None,
    output_dir: Path = Path("outputs"),
    model: str = "small",
    language: str | None = None,
    device: str = "cpu",
    compute_type: str = "int8",
    cookies: Path | None = None,
    cookies_from_browser: str | None = None,
    browser_download: bool = False,
    browser_profile: Path = Path("cookies") / "browser-profile",
    browser_channel: str = "msedge",
    backend: str = "local",
    mimo_api_key: str | None = None,
    mimo_base_url: str | None = None,
    mimo_model: str = "mimo-v2.5",
    save_video: bool = True,
    save_audio: bool = True,
    save_transcripts: bool = True,
    generate_article_outputs: bool = False,
    article_styles: str | Iterable[str] | None = None,
    article_length: str = "long",
    llm_api_key: str | None = None,
    llm_base_url: str | None = None,
    llm_model: str = "mimo-v2.5",
    log: LogFn = print,
) -> dict:
    if not url and not input_file:
        fail("Please provide a video URL or an input file.")
    if generate_article_outputs:
        save_transcripts = True
    if not (save_video or save_audio or save_transcripts):
        fail("Please select at least one output: video, audio, or subtitles.")
    if url:
        url = extract_url(url)
        if not URL_RE.fullmatch(url):
            fail("Could not find a valid video URL in the pasted text.")

    output_dir = output_dir.resolve()
    items_dir = output_dir / "items"
    items_dir.mkdir(parents=True, exist_ok=True)

    source_path: Path
    title: str
    item_slug: str
    item_root: Path
    item_paths: ItemPaths
    is_text_input = False
    ffmpeg_exe = ""
    video_output: Path | None = None
    audio_output: Path | None = None
    transcript_outputs: dict[str, Path] = {}
    article_outputs: dict[str, Path] = {}
    transcript_text = ""

    if input_file:
        source_path = input_file.resolve()
        if not source_path.exists():
            fail(f"Input file does not exist: {source_path}")
        title = source_path.stem
        item_slug = derive_item_slug(input_file=source_path)
        item_root = allocate_unique_item_root(items_dir, item_slug)
        item_paths = build_item_paths(item_root)
        item_root.mkdir(parents=True, exist_ok=True)
        is_text_input = is_text_input_file(source_path)
        if is_text_input:
            log("Reading local transcript text...")
            transcript_text = read_text_input(source_path)
            if not transcript_text:
                fail(f"Text file is empty: {source_path}")
            copied_text = copy_media_to_dir(source_path, item_paths.transcript_dir)
            transcript_outputs["txt"] = copied_text
            log(f"Transcript source saved: {copied_text}")
        elif save_video:
            video_output = copy_media_to_dir(source_path, item_paths.video_dir)
            log(f"Source saved: {video_output}")
    else:
        require_dependencies()
        ffmpeg_exe = get_ffmpeg_exe()
        log("Downloading media...")
        item_slug = derive_item_slug(url=url)
        item_root = allocate_unique_item_root(items_dir, item_slug)
        item_paths = build_item_paths(item_root)
        item_root.mkdir(parents=True, exist_ok=True)
        target_dir = item_paths.video_dir if save_video else item_paths.work_dir
        if browser_download:
            source_path, info = browser_download_video(
                url or "",
                target_dir,
                ffmpeg_exe,
                browser_profile=browser_profile.resolve(),
                browser_channel=browser_channel,
                mode="video" if save_video else "audio",
            )
        else:
            source_path, info = download_video(
                url or "",
                target_dir,
                ffmpeg_exe,
                cookies=cookies,
                cookies_from_browser=cookies_from_browser,
            )
        title = info.get("title") or source_path.stem
        final_slug = derive_item_slug(url=url, info=info)
        if final_slug != item_root.name:
            old_root = item_root
            item_root = move_item_root(item_root, items_dir, final_slug)
            item_paths = build_item_paths(item_root)
            source_path = rebase_path(source_path, old_root, item_root)
            if video_output:
                video_output = rebase_path(video_output, old_root, item_root)
        if save_video:
            video_output = source_path
            log(f"Video saved: {video_output}")

    audio_for_transcript: Path | None = None
    if not is_text_input and (save_audio or save_transcripts):
        if not ffmpeg_exe:
            require_dependencies()
            ffmpeg_exe = get_ffmpeg_exe()
        log("Extracting audio...")
        target_audio_dir = item_paths.audio_dir if save_audio else item_paths.work_dir
        audio_for_transcript = extract_audio(source_path, target_audio_dir, ffmpeg_exe)
        if save_audio:
            audio_output = audio_for_transcript
            log(f"Audio saved: {audio_output}")
        else:
            log(f"Prepared audio for transcription: {audio_for_transcript}")

    if save_transcripts and not is_text_input:
        if not audio_for_transcript:
            audio_for_transcript = extract_audio(source_path, item_paths.work_dir, ffmpeg_exe)
        log("Transcribing audio...")
        if backend == "mimo":
            segments, metadata = transcribe_audio_mimo(
                audio_for_transcript,
                api_key=mimo_api_key or "",
                base_url=mimo_base_url,
                mimo_model=mimo_model,
                language=language,
                log=log,
            )
        else:
            segments, metadata = transcribe_audio(
                audio_for_transcript,
                model_name=model,
                language=language,
                device=device,
                compute_type=compute_type,
            )
        output_base = item_paths.transcript_dir / audio_for_transcript.stem
        transcript_outputs = write_transcripts(segments, {"title": title, **metadata}, output_base, log=log)
        transcript_text = "\n".join(segment.text for segment in segments).strip()

    if generate_article_outputs:
        styles = parse_article_styles(article_styles or "xiaohongshu,professional")
        transcript_path = transcript_outputs.get("txt")
        if transcript_path and not transcript_text:
            transcript_text = transcript_path.read_text(encoding="utf-8").strip()
        output_base = item_paths.article_dir / sanitize_path_component(title or item_root.name, fallback="article")
        article_outputs = generate_articles(
            transcript_text=transcript_text,
            title=title,
            output_base=output_base,
            styles=styles,
            api_key=llm_api_key or mimo_api_key,
            base_url=llm_base_url or mimo_base_url,
            model=llm_model,
            article_length=article_length,
            log=log,
        )

    return {
        "title": title,
        "video": video_output,
        "audio": audio_output,
        "transcripts": transcript_outputs,
        "articles": article_outputs,
    }


def main() -> int:
    args = build_parser().parse_args()

    if not args.url and not args.input_file:
        fail("Please provide a video URL or use --input-file for a local file.")

    process_media(
        url=args.url,
        input_file=args.input_file,
        output_dir=Path(args.output_dir),
        model=args.model,
        language=args.language,
        device=args.device,
        compute_type=args.compute_type,
        cookies=args.cookies,
        cookies_from_browser=args.cookies_from_browser,
        browser_download=args.browser_download,
        browser_profile=Path(args.browser_profile),
        browser_channel=args.browser_channel,
        backend=args.backend,
        mimo_api_key=args.mimo_api_key,
        mimo_base_url=args.mimo_base_url,
        mimo_model=args.mimo_model,
        save_video=True,
        save_audio=True,
        save_transcripts=not args.keep_audio_only,
        generate_article_outputs=args.generate_articles,
        article_styles=args.article_styles,
        article_length=args.article_length,
        llm_api_key=args.llm_api_key,
        llm_base_url=args.llm_base_url,
        llm_model=args.llm_model,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        fail(f"Command failed with exit code {error.returncode}: {' '.join(error.cmd)}")
    except KeyboardInterrupt:
        fail("Stopped by user.")
