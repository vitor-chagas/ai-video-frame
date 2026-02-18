# AI Video Frame

Automatically crop videos to different aspect ratios using MediaPipe Pose.

## Local Setup
1. Fill `.env` with your credentials (Google OAuth & Supabase/Postgres).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run development server:
   ```bash
   npm run dev
   ```

## Docker Setup
1. Build the image and Run the container 
   ```bash
   docker rm -f ai-video-frame || true && docker build -t ai-video-frame . && docker run -p 5001:5001 --name ai-video-frame --env-file .env ai-video-frame
   ```


## Stripe Configuration
The app uses production Price IDs by default and sandbox prices as fallback. To use different prices (e.g., for **Sandbox** testing), set these variables in your `.env` file to the production env:

- STRIPE_SECRET_KEY
- STRIPE_PUBLISHABLE_KEY


## Requirements
- Node.js & Python 3
- FFmpeg installed on system
- OIDC Provider (e.g., Google Cloud Console)
- PostgreSQL database

