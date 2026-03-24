# AI Video Frame API Documentation

The AI Video Frame API automatically crops and reframes your videos into different aspect ratios (e.g., 9:16 for TikTok/Reels) while keeping the main subject in the center.

**Host & Subscription:**
This API is hosted and managed via RapidAPI. You can subscribe, get your API keys, and test the endpoints directly on our RapidAPI Hub page:
[AI Video Frame on RapidAPI](https://rapidapi.com/vitorvieirachagas/api/ai-video-frame-api/)

**Interactive Swagger UI:**
If you prefer the classic Swagger interface, you can also view our interactive documentation here:
[Swagger UI Docs](https://aivideoframe.com/api/v1/docs)

## Authentication
All requests must include your RapidAPI headers (automatically handled by the RapidAPI dashboard):
- `X-RapidAPI-Key`
- `X-RapidAPI-Host`

---

## Workflow

The API uses an asynchronous processing model:
1. **Upload** the video file.
2. **Process** the uploaded video.
3. **Check Status** to see when it's done.
4. **Download** the final result.

---

## Endpoints

### 1. Upload Video
Uploads a video file and defines the desired aspect ratio.

- **Method:** `POST`
- **URL:** `/api/v1/videos/upload`
- **Content-Type:** `multipart/form-data`
- **Body Parameters:**
  - `video` (File, Required): The video file you want to upload.
  - `aspectRatio` (String, Optional): The target aspect ratio. Default is `9:16`. Allowed values: `9:16`, `1:1`, `4:5`, `16:9`, `2:3`.
- **Response:** Returns a video object containing the `id` needed for the next steps.

### 2. Start Processing
Starts the AI framing process. **Note: This endpoint consumes your API credits.**

- **Method:** `POST`
- **URL:** `/api/v1/videos/{id}/process`
- **URL Parameters:**
  - `id`: The video ID received from the upload endpoint.
- **Response:** `{"message": "Processing started", "videoId": "..."}`

### 3. Check Status
Polls the processing status of your video.

- **Method:** `GET`
- **URL:** `/api/v1/videos/{id}/status`
- **URL Parameters:**
  - `id`: The video ID.
- **Response:** Returns an object containing the current state.
  - Look for `status: "completed"`. Other states include `processing` and `failed`.
  - It also includes a `progress` field (0-100).

### 4. Download Video
Downloads the final, reframed video.

- **Method:** `GET`
- **URL:** `/api/v1/videos/{id}/download`
- **URL Parameters:**
  - `id`: The video ID.
- **Response:** Returns the raw video file (`video/mp4`). Can only be called when status is `completed`.

### 5. Delete Video (Optional)
Cleans up your files from our servers.

- **Method:** `DELETE`
- **URL:** `/api/v1/videos/{id}`
- **URL Parameters:**
  - `id`: The video ID.
- **Response:** `{"success": true}`
