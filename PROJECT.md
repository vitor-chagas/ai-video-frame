# AutoFrame

## Overview
AutoFrame is a full-stack web application that serves as a frontend for a Python video processing script. Users upload landscape videos, authenticate, pay $5 per video via Stripe, and receive AI-processed vertical videos cropped to various aspect ratios (9:16 for TikTok/Reels, 1:1 square, 4:5 portrait, etc.).

## Current State
- Fully functional full-stack application with auth, payments, and video processing pipeline
- Simulated payment mode when Stripe keys are not configured
- Python video processing script integrated via child_process spawn

## Architecture
- **Frontend**: React + Vite, styled with Tailwind CSS and shadcn/ui components
- **Backend**: Express.js with session-based auth (bcrypt, connect-pg-simple)
- **Database**: PostgreSQL with Drizzle ORM
- **Payments**: Stripe Checkout with simulated fallback for development
- **Video Processing**: Python script (auto_frame) using OpenCV + MediaPipe

## Key Files
- `shared/schema.ts` - Database schema (users, videos, payments)
- `server/routes.ts` - API routes (auth, upload, payment, processing, download)
- `server/storage.ts` - Database storage layer (Drizzle ORM)
- `client/src/components/upload-box.tsx` - Main upload and processing UI
- `client/src/pages/home.tsx` - Landing page with pricing cards
- `client/src/hooks/use-auth.ts` - Auth hook
- `client/src/lib/api.ts` - API request utilities
- `python_scripts/auto_frame.py` - Python video processing script

## Design
- "Soft Modern" aesthetic: cream (hsl(38,20%,97%)) + charcoal (hsl(24,10%,10%))
- Libre Baskerville serif for headings, clean sans-serif body
- Rounded corners (3xl), soft shadows, subtle animations

## User Flow
1. Upload landscape video (drag & drop or browse)
2. Select output aspect ratio
3. Sign up / log in (session-based auth)
4. Pay $5 (Stripe checkout or simulated in dev)
5. Video processes in background (polling for status)
6. Download processed video

## Recent Changes
- Feb 2026: Connected frontend to real backend APIs (auth, upload, payment, processing)
- Added Stripe payment confirmation route for post-redirect verification
- Fixed nested `<a>` tags in layout header
- Added Python dependencies (opencv-python-headless, mediapipe, numpy)
