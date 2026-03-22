import cv2
import mediapipe as mp
import numpy as np
import os
import re
import subprocess
import sys
import tempfile
import time

# --- CONFIGURATION ---
SELECTED_RATIO = "4:5" # Available Ratios: "9:16", "1:1", "4:5", "16:9", "2:3"
SMOOTHING_FACTOR = 0.1
DETECT_EVERY_FPS_DIVISOR = 6
PROGRESS_REPORT_INTERVAL = 30

AVAILABLE_RATIOS = {
    "9:16": (9, 16),
    "1:1": (1, 1),
    "4:5": (4, 5),
    "16:9": (16, 9),
    "2:3": (2, 3)
}
# ---------------------

# Initialize MediaPipe Pose with robust error checking
# Note: MediaPipe 0.10.x on Python 3.14 might have structure changes
try:
    # Try legacy solutions API
    if hasattr(mp, 'solutions') and hasattr(mp.solutions, 'pose'):
        mp_pose = mp.solutions.pose
        pose = mp_pose.Pose(
            static_image_mode=False,
            model_complexity=0,
            enable_segmentation=False,
            min_detection_confidence=0.5
        )
    else:
        # Try Tasks API (newer)
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision

        # We'll initialize this lazily inside process_video if needed, 
        # or use a simplified detection if pose is not available.
        print("MediaPipe solutions.pose not found, will attempt to use Tasks API or fallback.")
        pose = None 
except Exception as e:
    print(f"MediaPipe Initialization Warning: {e}")
    pose = None

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
                "es": "Spanish",
                "fr": "French",
                "de": "German",
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


def burn_subtitles(video_path, srt_path, output_path):
    """Burn SRT subtitles into the video using FFmpeg."""
    # Use absolute paths and escape for FFmpeg subtitle filter
    abs_srt = os.path.abspath(srt_path).replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"subtitles='{abs_srt}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,Alignment=2'",
        "-c:a", "copy",
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"SubtitleError: FFmpeg burn-in failed: {result.stderr}", flush=True)
        return False
    return True


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
    smoothing_factor = SMOOTHING_FACTOR
    detect_every = max(1, int(fps / DETECT_EVERY_FPS_DIVISOR))

    print(f"Processing: {input_path}")
    print(f"Original: {width}x{height} | Target: {target_width}x{target_height}")
    print(f"Pose detection every {detect_every} frames (fps={fps:.1f})")

    frame_count = 0
    last_target_x = width / 2
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % detect_every == 0:
            target_x = width / 2
            
            if pose is not None:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = pose.process(frame_rgb)

                if results.pose_landmarks:
                    landmarks = results.pose_landmarks.landmark
                    nose = landmarks[0]
                    l_shoulder = landmarks[11]
                    r_shoulder = landmarks[12]
                    person_x = (nose.x + l_shoulder.x + r_shoulder.x) / 3 * width
                    target_x = person_x
            else:
                # Fallback to center if pose detection is unavailable
                target_x = width / 2
                
            last_target_x = target_x
        else:
            target_x = last_target_x

        current_center_x = (smoothing_factor * target_x) + ((1 - smoothing_factor) * current_center_x)

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

        # Calculate crop boundaries (Vertical - centering on frame)
        top = int((height - target_height) / 2)
        bottom = top + target_height

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
            subtitle_ok = generate_subtitles(args.input, srt_path, target_language=args.subtitle_lang)

            if subtitle_ok and args.subtitle_mode == "burn":
                # Burn subtitles into the processed output
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                    burned_output = tmp.name
                burned_ok = burn_subtitles(args.output, srt_path, burned_output)
                if burned_ok:
                    os.replace(burned_output, args.output)
                elif os.path.exists(burned_output):
                    os.remove(burned_output)
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
