import streamlit as st
import os
import tempfile
from auto_frame import process_video, AVAILABLE_RATIOS

st.set_page_config(page_title="Auto Framer", page_icon="🎥")

st.title("🎥 AI Auto Framer")
st.markdown("""
Upload a video and let AI automatically frame it for your preferred aspect ratio.
Uses MediaPipe Pose detection to keep the person centered.
""")

# Ensure output directory exists
output_dir = "medias/output"
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

# Sidebar for configuration
st.sidebar.header("Configuration")
selected_ratio_name = st.sidebar.selectbox(
    "Select Aspect Ratio",
    options=list(AVAILABLE_RATIOS.keys()),
    index=0
)
aspect_ratio = AVAILABLE_RATIOS[selected_ratio_name]

# File uploader
uploaded_file = st.file_uploader("Choose an MP4 video file", type=["mp4", "mov", "avi"])

if uploaded_file is not None:
    # Preview original video
    st.subheader("Original Video")
    st.video(uploaded_file)

    if st.button("Start Auto Framing"):
        st.write("🔄 Preparing video...")
        # Save uploaded file to a temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp_input:
            # Important: Use read() then seek(0) if we want to read it again, 
            # or just write it once. uploaded_file is a file-like object.
            content = uploaded_file.read()
            tmp_input.write(content)
            input_path = tmp_input.name
        
        st.write(f"📂 Temporary file created at: {input_path}")

        output_filename = f"auto_{selected_ratio_name.replace(':', '_')}_{uploaded_file.name}"
        output_path = os.path.join(output_dir, output_filename)
        st.write(f"🎯 Output will be saved to: {output_path}")

        # Progress bar
        progress_bar = st.progress(0)
        status_text = st.empty()

        def update_progress(progress):
            progress_bar.progress(progress)
            status_text.text(f"Processing: {progress*100:.1f}%")

        try:
            with st.spinner("AI is analyzing and framing... This may take a while depending on video length."):
                success = process_video(
                    input_path, 
                    output_path, 
                    aspect_ratio=aspect_ratio, 
                    progress_callback=update_progress
                )

            if success:
                st.success("✅ Processing complete!")
                
                # Preview processed video
                st.subheader("Framed Video")
                with open(output_path, "rb") as f:
                    video_bytes = f.read()
                    st.video(video_bytes)
                
                # Download button
                st.download_button(
                    label="Download Framed Video",
                    data=video_bytes,
                    file_name=output_filename,
                    mime="video/mp4"
                )
            else:
                st.error("❌ An error occurred during processing. Please check if FFmpeg is installed.")

        except Exception as e:
            st.error(f"❌ Error: {str(e)}")
        
        finally:
            # Cleanup temporary input file
            if os.path.exists(input_path):
                os.remove(input_path)

st.sidebar.markdown("---")
st.sidebar.info("""
**Note:** This app requires `ffmpeg` to be installed on the host system to process audio.
""")
