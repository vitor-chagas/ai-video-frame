import cv2
import math
import mediapipe as mp
import os
import subprocess
import sys
import tempfile
import time

# --- CONFIGURATION ---
SELECTED_RATIO = "4:5" # Available Ratios: "9:16", "1:1", "4:5", "16:9", "2:3"
SMOOTHING_MIN = 0.10        # Smooth tracking when subject is centered
SMOOTHING_MAX = 0.30        # Responsive tracking when subject drifts to edge
DEAD_ZONE_FRACTION = 0.05   # Ignore movements smaller than 5% of crop size
MAX_SPEED_FRACTION = 0.02   # Max crop movement per frame = 2% of target dimension
OUTLIER_THRESHOLD = 0.30    # Ignore detection jumps > 30% of frame width
DETECT_EVERY_FPS_DIVISOR = 15
PROGRESS_REPORT_INTERVAL = 30
VERTICAL_BIAS_PORTRAIT = 0.12   # Shift crop down 12% for portrait (face in upper third)
VERTICAL_BIAS_LANDSCAPE = 0.05  # Slight shift for landscape/square
LANDMARK_VISIBILITY_THRESHOLD = 0.5  # Min visibility to include a landmark

AVAILABLE_RATIOS = {
    "9:16": (9, 16),
    "1:1": (1, 1),
    "4:5": (4, 5),
    "16:9": (16, 9),
    "2:3": (2, 3)
}
# ---------------------

# MediaPipe Tasks API (0.10.20+) — models are loaded per-video in process_video()
from mediapipe.tasks.python import vision
from mediapipe.tasks.python import BaseOptions

USE_POSE_FALLBACK = True  # Set False for face-only tracking (faster)
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
FACE_MODEL_PATH = os.path.join(MODELS_DIR, "blaze_face_short_range.tflite")
POSE_MODEL_PATH = os.path.join(MODELS_DIR, "pose_landmarker_lite.task")

def get_largest_face_tasks(face_result, frame_width, frame_height):
    """Return (center_x, center_y, area) of the largest detected face, or None."""
    if not face_result or not face_result.detections:
        return None

    largest = None
    largest_area = 0

    for detection in face_result.detections:
        bbox = detection.bounding_box
        area = bbox.width * bbox.height
        if area > largest_area:
            largest_area = area
            largest = bbox

    if largest is None:
        return None

    cx = largest.origin_x + largest.width / 2
    cy = largest.origin_y + largest.height / 2

    return (cx, cy, largest_area)

def format_time(seconds):
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}m {secs}s"


def wrap_srt_lines(srt_content, max_chars=42):
    """Split long subtitle lines at word boundaries while preserving SRT timing."""
    blocks = srt_content.strip().split("\n\n")
    result = []
    for block in blocks:
        lines = block.split("\n")
        if len(lines) < 3:
            result.append(block)
            continue
        # lines[0] = index, lines[1] = timing, lines[2:] = text
        index_line = lines[0]
        timing_line = lines[1]
        text_lines = lines[2:]
        text = " ".join(text_lines)
        # Split at word boundaries
        wrapped = []
        while len(text) > max_chars:
            split_at = text.rfind(" ", 0, max_chars)
            if split_at == -1:
                split_at = max_chars
            wrapped.append(text[:split_at].strip())
            text = text[split_at:].strip()
        if text:
            wrapped.append(text)
        result.append("\n".join([index_line, timing_line] + wrapped))
    return "\n\n".join(result)


def generate_subtitles(input_path, output_srt_path, target_language=None):
    """
    Transcribe audio using OpenAI Whisper API and optionally translate.
    target_language: None = keep source language, "en" = translate to English,
                     "pt-BR" or "es" = transcribe then GPT-translate.
    """
    try:
        import openai

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("SubtitleError: OPENAI_API_KEY is not set", flush=True)
            return False

        client = openai.OpenAI(api_key=api_key)

        # Extract audio to a temp file (WAV, max 25MB for Whisper)
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_audio:
            audio_path = tmp_audio.name

        extract_cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
            audio_path
        ]
        extract_result = subprocess.run(extract_cmd, capture_output=True, text=True)
        if extract_result.returncode != 0:
            print(f"SubtitleError: Audio extraction failed: {extract_result.stderr}", flush=True)
            return False

        print("SubtitleProgress: 30%", flush=True)

        srt_content = None
        detected_language = "unknown"

        with open(audio_path, "rb") as audio_file:
            # Translate directly to English using Whisper's built-in translate task
            if target_language == "en":
                response = client.audio.translations.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="verbose_json",
                )
                detected_language = getattr(response, "language", "unknown")
                # Re-request as SRT
                audio_file.seek(0)
                srt_response = client.audio.translations.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="srt",
                )
                srt_content = str(srt_response)
            else:
                # Transcribe in source language
                response = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="verbose_json",
                )
                detected_language = getattr(response, "language", "unknown")
                audio_file.seek(0)
                srt_response = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="srt",
                )
                srt_content = str(srt_response)

        print(f"DetectedLanguage: {detected_language}", flush=True)
        print("SubtitleProgress: 60%", flush=True)

        # If target is PT-BR or ES (non-English target), translate the SRT via GPT
        if target_language and target_language not in (None, "en", detected_language):
            lang_names = {
                "pt-BR": "Brazilian Portuguese",
                "pt":    "European Portuguese",
                "es":    "Spanish",
                "fr":    "French",
                "de":    "German",
                "it":    "Italian",
                "nl":    "Dutch",
                "ru":    "Russian",
                "pl":    "Polish",
                "tr":    "Turkish",
                "zh":    "Simplified Chinese",
                "ja":    "Japanese",
                "ko":    "Korean",
                "id":    "Indonesian",
                "sv":    "Swedish",
                "da":    "Danish",
                "no":    "Norwegian",
                "fi":    "Finnish",
                "uk":    "Ukrainian",
                "ar":    "Arabic",
                "hi":    "Hindi",
            }
            lang_name = lang_names.get(target_language, target_language)
            gpt_response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"You are a professional subtitle translator. "
                            f"Translate the following SRT file content to {lang_name}. "
                            f"Preserve all SRT index numbers and timing lines exactly as-is. "
                            f"Only translate the text lines. Return only valid SRT format, no other text."
                        ),
                    },
                    {"role": "user", "content": srt_content},
                ],
                temperature=0.1,
            )
            srt_content = gpt_response.choices[0].message.content

        print("SubtitleProgress: 80%", flush=True)

        # Post-process: wrap long lines for vertical video
        srt_content = wrap_srt_lines(srt_content, max_chars=42)

        with open(output_srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)

        print("SubtitleProgress: 100%", flush=True)
        return True

    except Exception as e:
        print(f"SubtitleError: {e}", flush=True)
        return False
    finally:
        if "audio_path" in locals() and os.path.exists(audio_path):
            os.remove(audio_path)


def srt_to_karaoke_style_ass(srt_content):
    """
    Convert SRT content to an ASS file with the same style as the karaoke output
    (Arial 13, white uppercase text, black outline/shadow, bottom-center, MarginV=40).
    Each SRT segment is split into word groups (3–5 words, max 18 chars) with evenly
    distributed timing so the subtitle stays compact, matching the karaoke look.
    """
    MAX_CHARS = 18
    MIN_WORDS = 3
    MAX_WORDS = 5

    ass_header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,"
        " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,"
        " Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Arial,13,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,"
        "1,0,0,0,100,100,0,0,1,1,2,2,10,10,40,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    def srt_time_to_seconds(t):
        h, m, rest = t.strip().split(":")
        s, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    def build_word_groups(words):
        groups = []
        i = 0
        while i < len(words):
            group = [words[i]]
            char_count = len(words[i])
            i += 1
            while i < len(words) and len(group) < MAX_WORDS:
                next_len = len(words[i])
                if len(group) >= MIN_WORDS and char_count + 1 + next_len > MAX_CHARS:
                    break
                group.append(words[i])
                char_count += 1 + next_len
                i += 1
            groups.append(group)
        return groups

    blocks = srt_content.strip().split("\n\n")
    dialogue_lines = []
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        timing = lines[1]
        text = " ".join(lines[2:])
        try:
            start_str, end_str = timing.split(" --> ")
            seg_start = srt_time_to_seconds(start_str)
            seg_end = srt_time_to_seconds(end_str)
        except Exception:
            continue
        seg_duration = max(seg_end - seg_start, 0.1)
        words = text.split()
        if not words:
            continue
        groups = build_word_groups(words)
        time_per_group = seg_duration / len(groups)
        for i, group in enumerate(groups):
            group_start = seg_start + i * time_per_group
            group_end = seg_start + (i + 1) * time_per_group
            group_text = " ".join(group).upper()
            dialogue_lines.append(
                f"Dialogue: 0,{seconds_to_ass_time(group_start)},{seconds_to_ass_time(group_end)},"
                f"Default,,0,0,0,,{group_text}"
            )

    return ass_header + "\n".join(dialogue_lines)


def burn_subtitles(video_path, subtitle_path, output_path):
    """Burn subtitles (ASS or SRT) into the video using FFmpeg."""
    tmp_ass_path = None

    if subtitle_path.lower().endswith(".ass"):
        abs_sub = os.path.abspath(subtitle_path).replace("\\", "/").replace(":", "\\:").replace(" ", "\\ ")
        vf = f"ass='{abs_sub}'"
    else:
        # SRT fallback: convert to karaoke-matching ASS so font/size/style are identical
        with open(subtitle_path, "r", encoding="utf-8") as f:
            srt_content = f.read()
        ass_content = srt_to_karaoke_style_ass(srt_content)
        with tempfile.NamedTemporaryFile(suffix=".ass", delete=False, mode="w", encoding="utf-8") as tmp_ass:
            tmp_ass.write(ass_content)
            tmp_ass_path = tmp_ass.name
        abs_sub = os.path.abspath(tmp_ass_path).replace("\\", "/").replace(":", "\\:").replace(" ", "\\ ")
        vf = f"ass='{abs_sub}'"

    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", vf,
            "-c:a", "copy",
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"SubtitleError: FFmpeg burn-in failed: {result.stderr}", flush=True)
            return False
        return True
    finally:
        if tmp_ass_path and os.path.exists(tmp_ass_path):
            os.remove(tmp_ass_path)


def seconds_to_ass_time(seconds):
    """Convert float seconds to ASS time format H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_karaoke_ass(input_path, output_ass_path, output_srt_path=None, target_language=None):
    """
    Generate a karaoke-style ASS subtitle file using Whisper word-level timestamps.
    Shows 3 words at a time; each word turns yellow as it is spoken, rest stays white.
    Returns False for translated languages (pt-BR, es, fr, de) — caller should fall back to generate_subtitles.
    """
    TRANSLATION_LANGS = {
        "pt-BR", "pt", "es", "fr", "de", "it", "nl", "ru", "pl", "tr",
        "zh", "ja", "ko", "id", "sv", "da", "no", "fi", "uk", "ar", "hi",
    }
    if target_language in TRANSLATION_LANGS:
        return False

    try:
        import openai

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("SubtitleError: OPENAI_API_KEY is not set", flush=True)
            return False

        client = openai.OpenAI(api_key=api_key)

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_audio:
            audio_path = tmp_audio.name

        extract_cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-vn", "-ar", "16000", "-ac", "1", "-b:a", "32k",
            audio_path
        ]
        extract_result = subprocess.run(extract_cmd, capture_output=True, text=True)
        if extract_result.returncode != 0:
            print(f"SubtitleError: Audio extraction failed: {extract_result.stderr}", flush=True)
            return False

        print("SubtitleProgress: 30%", flush=True)

        with open(audio_path, "rb") as audio_file:
            if target_language == "en":
                response = client.audio.translations.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="verbose_json",
                    timestamp_granularities=["word"],
                )
            else:
                response = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file,
                    response_format="verbose_json",
                    timestamp_granularities=["word"],
                )

        detected_language = getattr(response, "language", "unknown")
        raw_words = getattr(response, "words", [])
        if not raw_words:
            print("SubtitleError: No word timestamps returned by Whisper", flush=True)
            return False

        words = [{"word": w.word.strip(), "start": w.start, "end": w.end} for w in raw_words if w.word.strip()]

        print(f"DetectedLanguage: {detected_language}", flush=True)
        print("SubtitleProgress: 60%", flush=True)

        ass_header = (
            "[Script Info]\n"
            "ScriptType: v4.00+\n"
            "WrapStyle: 0\n"
            "ScaledBorderAndShadow: yes\n"
            "\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,"
            " Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,"
            " Alignment, MarginL, MarginR, MarginV, Encoding\n"
            "Style: Default,Arial,13,&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,"
            "1,0,0,0,100,100,0,0,1,1,2,2,10,10,40,1\n"
            "\n"
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        )

        # Group words dynamically: fill up to MAX_CHARS characters per group (3–5 words)
        MAX_CHARS = 18
        MIN_WORDS = 3
        MAX_WORDS = 5

        def build_groups(words):
            groups = []
            i = 0
            while i < len(words):
                group = [words[i]]
                char_count = len(words[i]["word"])
                i += 1
                while i < len(words) and len(group) < MAX_WORDS:
                    next_len = len(words[i]["word"])
                    if len(group) >= MIN_WORDS and char_count + 1 + next_len > MAX_CHARS:
                        break
                    group.append(words[i])
                    char_count += 1 + next_len
                    i += 1
                groups.append(group)
            return groups

        groups = build_groups(words)
        dialogue_lines = []
        srt_blocks = []

        def fmt_srt_time(s):
            h = int(s // 3600)
            m = int((s % 3600) // 60)
            sec = int(s % 60)
            ms = int((s % 1) * 1000)
            return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"

        for idx, group in enumerate(groups):
            event_start = group[0]["start"]
            event_end = group[-1]["end"]

            parts = []
            for j, w in enumerate(group):
                if j < len(group) - 1:
                    k_cs = max(1, int((group[j + 1]["start"] - w["start"]) * 100))
                else:
                    k_cs = max(1, int((w["end"] - w["start"]) * 100))
                parts.append(f"{{\\k{k_cs}}}{w['word'].upper()}")

            text = " ".join(parts)
            dialogue_lines.append(
                f"Dialogue: 0,{seconds_to_ass_time(event_start)},{seconds_to_ass_time(event_end)},Default,,0,0,0,,{text}"
            )

            if output_srt_path:
                words_text = " ".join(w["word"] for w in group)
                srt_blocks.append(
                    f"{idx + 1}\n{fmt_srt_time(event_start)} --> {fmt_srt_time(event_end)}\n{words_text}"
                )

        with open(output_ass_path, "w", encoding="utf-8") as f:
            f.write(ass_header)
            f.write("\n".join(dialogue_lines))

        if output_srt_path and srt_blocks:
            with open(output_srt_path, "w", encoding="utf-8") as f:
                f.write("\n\n".join(srt_blocks))

        print("SubtitleProgress: 100%", flush=True)
        return True

    except Exception as e:
        print(f"SubtitleError: {e}", flush=True)
        return False
    finally:
        if "audio_path" in locals() and os.path.exists(audio_path):
            os.remove(audio_path)


def process_video(input_path, output_path, aspect_ratio=(9, 16), progress_callback=None):
    start_time = time.time()
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(f"Error: Could not open video {input_path}")
        return False

    # Get video properties
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Calculate target dimensions based on aspect ratio
    ratio_w, ratio_h = aspect_ratio
    
    # Calculate potential target width if we keep original height
    target_width = int(height * (ratio_w / ratio_h))
    target_height = height

    # If target width is greater than original width, we must scale based on width instead
    if target_width > width:
        target_width = width
        target_height = int(width * (ratio_h / ratio_w))
    
    # Ensure dimensions are even for ffmpeg compatibility
    if target_width % 2 != 0:
        target_width -= 1
    if target_height % 2 != 0:
        target_height -= 1

    # Temporary video file (without audio)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        temp_output = tmp.name
    
    # Video writer setup - Try XVID first for efficiency, fallback to avc1 then mp4v
    # XVID is faster and less CPU-intensive for high resolutions
    fourcc = cv2.VideoWriter_fourcc(*'XVID')
    out = cv2.VideoWriter(temp_output, fourcc, fps, (target_width, target_height))
    
    if not out.isOpened():
        print("Warning: XVID codec failed, trying avc1")
        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        out = cv2.VideoWriter(temp_output, fourcc, fps, (target_width, target_height))

    if not out.isOpened():
        print("Warning: avc1 codec failed, falling back to mp4v")
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(temp_output, fourcc, fps, (target_width, target_height))

    if not out.isOpened():
        print("Error: Could not initialize VideoWriter with any supported codec.")
        return False

    current_center_x = width / 2
    current_center_y = height / 2
    first_detection_done = False  # Snap to subject on first detection (no smoothing)
    detect_every = max(1, int(fps / DETECT_EVERY_FPS_DIVISOR))

    # Determine vertical bias based on aspect ratio
    is_portrait = ratio_h > ratio_w
    vertical_bias = VERTICAL_BIAS_PORTRAIT if is_portrait else VERTICAL_BIAS_LANDSCAPE

    # Landmark indices for body estimation (Tasks API)
    TRACKING_LANDMARKS = [0, 11, 12, 23, 24, 25, 26, 27, 28]  # nose, shoulders, hips, knees, ankles

    # Initialize MediaPipe Tasks detectors (VIDEO mode for frame-by-frame)
    face_det = None
    pose_det = None
    try:
        face_options = vision.FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=FACE_MODEL_PATH),
            running_mode=vision.RunningMode.VIDEO,
            min_detection_confidence=0.3
        )
        face_det = vision.FaceDetector.create_from_options(face_options)
        print("Face detector initialized (Tasks API)")
    except Exception as e:
        print(f"Face detector init failed: {e}")

    if USE_POSE_FALLBACK:
        try:
            pose_options = vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=POSE_MODEL_PATH),
                running_mode=vision.RunningMode.VIDEO,
                min_pose_detection_confidence=0.4,
                min_tracking_confidence=0.4
            )
            pose_det = vision.PoseLandmarker.create_from_options(pose_options)
            print("Pose landmarker initialized (Tasks API)")
        except Exception as e:
            print(f"Pose landmarker init failed: {e}")

    print(f"Processing: {input_path}")
    print(f"Original: {width}x{height} | Target: {target_width}x{target_height}")
    print(f"Pose detection every {detect_every} frames (fps={fps:.1f})")

    frame_count = 0
    # Interpolation state: previous and current detection targets
    prev_target_x = width / 2
    prev_target_y = height / 2
    last_target_x = width / 2
    last_target_y = height / 2
    last_detect_frame = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % detect_every == 0:
            raw_target_x = width / 2
            raw_target_y = height / 2
            detected = False

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            timestamp_ms = int(frame_count * 1000 / fps)

            # PRIMARY: Face detection — picks the largest face (closest to camera)
            if face_det is not None:
                face_result = face_det.detect_for_video(mp_image, timestamp_ms)
                face_info = get_largest_face_tasks(face_result, width, height)

                if face_info is not None:
                    face_cx, face_cy, _ = face_info
                    raw_target_x = face_cx
                    raw_target_y = face_cy + target_height * vertical_bias
                    detected = True

            # FALLBACK: Pose detection — when face not visible (turned away, looking down)
            if not detected and USE_POSE_FALLBACK and pose_det is not None:
                pose_result = pose_det.detect_for_video(mp_image, timestamp_ms)

                if pose_result.pose_landmarks and len(pose_result.pose_landmarks) > 0:
                    landmarks = pose_result.pose_landmarks[0]

                    visible_xs = []
                    visible_ys = []
                    for idx in TRACKING_LANDMARKS:
                        if idx < len(landmarks):
                            lm = landmarks[idx]
                            if lm.visibility > LANDMARK_VISIBILITY_THRESHOLD:
                                visible_xs.append(lm.x * width)
                                visible_ys.append(lm.y * height)

                    if visible_xs:
                        raw_target_x = (min(visible_xs) + max(visible_xs)) / 2
                        nose = landmarks[0]
                        if nose.visibility > LANDMARK_VISIBILITY_THRESHOLD:
                            face_y = nose.y * height
                            raw_target_y = face_y + target_height * vertical_bias
                        else:
                            body_center_y = (min(visible_ys) + max(visible_ys)) / 2
                            raw_target_y = body_center_y + target_height * (vertical_bias * 0.5)

            # Outlier rejection: ignore wild jumps (likely detected a different person)
            jump_x = abs(raw_target_x - last_target_x)
            if first_detection_done and jump_x > width * OUTLIER_THRESHOLD:
                raw_target_x = last_target_x
                raw_target_y = last_target_y

            # Update interpolation state
            prev_target_x = last_target_x
            prev_target_y = last_target_y
            last_target_x = raw_target_x
            last_target_y = raw_target_y
            last_detect_frame = frame_count
            target_x = raw_target_x
            target_y = raw_target_y
        else:
            # Linear interpolation between previous and current detection
            frames_since = frame_count - last_detect_frame
            t = min(frames_since / detect_every, 1.0)
            target_x = prev_target_x + (last_target_x - prev_target_x) * t
            target_y = prev_target_y + (last_target_y - prev_target_y) * t

        # Snap directly to subject on first detection (no smoothing delay)
        if not first_detection_done and (target_x != width / 2 or target_y != height / 2):
            current_center_x = target_x
            current_center_y = target_y
            first_detection_done = True
            print(f"First detection: snapped crop center to ({target_x:.0f}, {target_y:.0f})", flush=True)
        else:
            # Dead zone: ignore tiny movements to reduce jitter
            dx = target_x - current_center_x
            dy = target_y - current_center_y
            if abs(dx) < target_width * DEAD_ZONE_FRACTION and abs(dy) < target_height * DEAD_ZONE_FRACTION:
                target_x = current_center_x
                target_y = current_center_y

            # Adaptive smoothing: faster when subject is far from center
            distance = math.sqrt(dx * dx + dy * dy)
            max_distance = math.sqrt((target_width / 2) ** 2 + (target_height / 2) ** 2)
            normalized_distance = min(distance / max_distance, 1.0) if max_distance > 0 else 0
            smoothing = SMOOTHING_MIN + (SMOOTHING_MAX - SMOOTHING_MIN) * normalized_distance

            new_center_x = (smoothing * target_x) + ((1 - smoothing) * current_center_x)
            new_center_y = (smoothing * target_y) + ((1 - smoothing) * current_center_y)

            # Velocity clamp: limit max movement per frame to prevent shaking
            max_speed_x = target_width * MAX_SPEED_FRACTION
            max_speed_y = target_height * MAX_SPEED_FRACTION
            move_x = max(-max_speed_x, min(max_speed_x, new_center_x - current_center_x))
            move_y = max(-max_speed_y, min(max_speed_y, new_center_y - current_center_y))
            current_center_x += move_x
            current_center_y += move_y

        # Calculate crop boundaries (Horizontal)
        left = int(current_center_x - target_width / 2)
        right = left + target_width

        # Keep within video bounds (Horizontal)
        if left < 0:
            left = 0
            right = target_width
        elif right > width:
            right = width
            left = width - target_width

        # Calculate crop boundaries (Vertical - tracking subject)
        top = int(current_center_y - target_height / 2)
        bottom = top + target_height

        # Keep within video bounds (Vertical)
        if top < 0:
            top = 0
            bottom = target_height
        elif bottom > height:
            bottom = height
            top = height - target_height

        # Crop and write
        cropped_frame = frame[top:bottom, left:right]
        out.write(cropped_frame)

        frame_count += 1
        if frame_count % PROGRESS_REPORT_INTERVAL == 0:
            progress = (frame_count / total_frames)
            print(f"Progress: {progress*100:.1f}% ({frame_count}/{total_frames})", flush=True)
            if progress_callback:
                progress_callback(progress)

    cap.release()
    out.release()
    if face_det is not None:
        face_det.close()
    if pose_det is not None:
        pose_det.close()

    # Verify the temporary file was actually created and has content
    if not os.path.exists(temp_output) or os.path.getsize(temp_output) == 0:
        print(f"Error: Processed temporary file {temp_output} is empty or was not created.")
        return False

    print("\nVideo frames processed. Merging audio...")

    # Merge audio using ffmpeg
    try:
        # Security: input_path and output_path are passed as a list to subprocess.run,
        # which avoids shell injection as it doesn't use shell=True.
        cmd = [
            'ffmpeg', '-y',
            '-i', temp_output,
            '-i', input_path,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v?',
            '-map', '1:a?',
            '-shortest',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"FFmpeg Error (Return Code {result.returncode}):")
            print(result.stderr)
            # If ffmpeg fails, we still have the temp file, let's at least move it to output
            os.rename(temp_output, output_path)
            return False
            
        print(f"Success! Saved with audio to: {output_path}")
    except Exception as e:
        print(f"Unexpected error merging audio: {e}")
        if os.path.exists(temp_output):
            os.rename(temp_output, output_path)
        return False
    finally:
        if os.path.exists(temp_output):
            os.remove(temp_output)
    
    end_time = time.time()
    processing_duration = end_time - start_time
    
    # Video duration in seconds
    video_duration_seconds = total_frames / fps
    
    processing_time_str = format_time(processing_duration)
    video_length_str = format_time(video_duration_seconds)
    
    # Time per minute of video
    if video_duration_seconds > 0:
        time_per_video_minute = (processing_duration / (video_duration_seconds / 60))
        time_per_minute_str = format_time(time_per_video_minute)
    else:
        time_per_minute_str = "N/A"

    print("\n" + "="*30)
    print("METRICS")
    print("="*30)
    print(f"Video Resolution: {width}x{height} -> {target_width}x{target_height}")
    print(f"Video Length:     {video_length_str}")
    print(f"Process Duration: {processing_time_str}")
    print(f"Efficiency:       {time_per_minute_str} per minute of video")
    print("="*30)
    return True

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Path to input video")
    parser.add_argument("--output", help="Path to output video")
    parser.add_argument("--ratio", default="4:5", help="Aspect ratio (e.g., 9:16, 1:1, 4:5)")
    parser.add_argument("--subtitles", action="store_true", help="Generate subtitles")
    parser.add_argument("--subtitle-lang", default=None, help="Target subtitle language (e.g. en, pt-BR, es)")
    parser.add_argument("--subtitle-mode", default="burn", help="Subtitle output mode: burn, srt, or vtt")
    parser.add_argument("--subtitle-output", default=None, help="Path to save the .srt/.vtt file")
    args = parser.parse_args()

    if args.input and args.output:
        target_ratio = AVAILABLE_RATIOS.get(args.ratio, (4, 5))
        success = process_video(args.input, args.output, aspect_ratio=target_ratio)

        if success and args.subtitles and args.subtitle_output:
            srt_path = args.subtitle_output

            if args.subtitle_mode == "burn":
                # Try karaoke ASS (word-level highlight); falls back for translated languages
                ass_path = srt_path.replace(".srt", ".ass")
                karaoke_ok = generate_karaoke_ass(
                    args.input, ass_path,
                    output_srt_path=srt_path,
                    target_language=args.subtitle_lang,
                )
                if karaoke_ok:
                    burn_path = ass_path
                else:
                    # Fallback: plain SRT burn (translated languages)
                    subtitle_ok = generate_subtitles(args.input, srt_path, target_language=args.subtitle_lang)
                    if not subtitle_ok:
                        sys.exit(1)
                    burn_path = srt_path

                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                    burned_output = tmp.name
                burned_ok = burn_subtitles(args.output, burn_path, burned_output)
                if burned_ok:
                    os.replace(burned_output, args.output)
                else:
                    if os.path.exists(burned_output):
                        os.remove(burned_output)
                    sys.exit(1)
            else:
                generate_subtitles(args.input, srt_path, target_language=args.subtitle_lang)
    else:
        target_ratio = AVAILABLE_RATIOS.get(SELECTED_RATIO, (9, 16))
        ratio_suffix = SELECTED_RATIO.replace(":", "_")

        input_folder = "medias/input"
        output_folder = "medias/output"
        
        if not os.path.exists(output_folder):
            os.makedirs(output_folder)
        if not os.path.exists(input_folder):
            os.makedirs(input_folder)
            print(f"Created {input_folder}. Please place your videos there.")
            sys.exit(0)

        videos = [f for f in os.listdir(input_folder) if f.endswith(".mp4")]
        
        if not videos:
            print(f"No .mp4 files found in {input_folder}")
        else:
            for filename in videos:
                input_file = os.path.join(input_folder, filename)
                output_file = os.path.join(output_folder, f"auto_{ratio_suffix}_{filename}")
                print(f"\nProcessing {filename} with ratio {SELECTED_RATIO}...")
                process_video(input_file, output_file, aspect_ratio=target_ratio)
