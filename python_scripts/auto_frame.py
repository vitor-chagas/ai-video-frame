import cv2
import mediapipe as mp
import numpy as np
import os
import subprocess
import sys
import time

# --- CONFIGURATION ---
SELECTED_RATIO = "4:5" # Available Ratios: "9:16", "1:1", "4:5", "16:9", "2:3"

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

    # Temporary video file (without audio) - Use a unique name to avoid conflicts
    temp_output = f"temp_no_audio_{int(time.time())}.mp4"
    
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
    smoothing_factor = 0.1
    detect_every = max(1, int(fps / 6))

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
        if frame_count % 30 == 0:
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
        # -i temp: the processed video
        # -i input: the original video with audio
        # -c:v copy: copy the already processed video stream
        # -c:a aac: encode audio to AAC (safest)
        # -map 0:v?: take video from first input (if exists)
        # -map 1:a?: take audio from second input (if exists)
        # -shortest: match the shortest stream duration
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
        print(f"Running FFmpeg command: {' '.join(cmd)}")
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
    
    # Format times
    def format_time(seconds):
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}m {secs}s"

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
    args = parser.parse_args()

    if args.input and args.output:
        target_ratio = AVAILABLE_RATIOS.get(args.ratio, (4, 5))
        process_video(args.input, args.output, aspect_ratio=target_ratio)
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
