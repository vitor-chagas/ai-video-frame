# AI Video Frame

AI-powered video cropping tool that automatically detects subjects using computer vision to reframe videos into different aspect ratios.

https://aivideoframe.com

## Overview

AI Video Frame simplifies the process of reframing content for social media. By leveraging **MediaPipe Pose**, the application tracks the main subject in a video and intelligently crops the frame to maintain focus, supporting common aspect ratios like 9:16 (TikTok/Reels), 1:1, and more.

### Key Features
- **AI-Driven Reframing**: Automatic subject detection and tracking using MediaPipe.
- **Multiple Aspect Ratios**: Easily convert landscape videos to portrait or square formats.
- **Seamless Auth**: Google OIDC integration for secure user accounts.
- **Monetization Ready**: Integrated with Stripe for credit-based processing.
- **Processing Queue**: Robust backend handling for video transcoding and AI analysis.
- **Analytics**: PostHog integration tracking key user events (uploads, processing, downloads, purchases).

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Shadcn UI, Vite.
- **Backend**: Node.js (Express), Drizzle ORM.
- **AI/ML**: Python, MediaPipe (Pose Detection), OpenCV.
- **Database**: PostgreSQL (Supabase).
- **Video Processing**: FFmpeg.
- **Infrastructure**: Docker, Railway.

## Architecture

The application follows a modular architecture:
1. **React Client**: Handles video uploads and user interactions.
2. **Express Server**: Manages API routes, authentication, and job orchestration.
3. **Python Worker**: Executes the `auto_frame.py` script for AI analysis and frame calculation.
4. **FFmpeg**: Performs the final video cropping and encoding.

## Getting Started

### Prerequisites
- Node.js (v18+)
- Python 3.10+
- FFmpeg installed on the system

### Local Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/ai-video-frame.git
   cd ai-video-frame
   ```

2. **Environment Setup**:
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   # Python dependencies
   pip install -r requirements.txt
   ```

4. **Run the Application**:
   ```bash
   npm run dev
   ```

## Docker Support

You can also run the entire stack using Docker:

```bash
docker build -t ai-video-frame .
docker run -p 5001:5001 --env-file .env ai-video-frame
```

## License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Built with ❤️ for content creators.*
