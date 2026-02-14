# Auto-Framer

Automatically crop videos to different aspect ratios while keeping the subject (person) in frame using MediaPipe Pose.

## Setup
1. Install dependencies:
   ```bash
   pip install opencv-python mediapipe numpy
   ```
2. Ensure `ffmpeg` is installed on your system.

## Usage
1. Place your `.mp4` videos in `medias/input/`.
2. Open `auto_frame.py` and set your desired ratio at the top:
   ```python
   SELECTED_RATIO = "9:16" # Options: "9:16", "1:1", "4:5", "16:9", "2:3"
   ```
3. Run the script:
   ```bash
   python auto_frame.py
   ```
4. Find processed videos in `medias/output/`.

## Metrics
After each process, the script outputs metrics including:
- Original vs Target resolution.
- Total video length.
- Total processing duration.
- Processing efficiency (time taken per minute of video).
