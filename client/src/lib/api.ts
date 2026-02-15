export async function apiRequest(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export async function uploadVideo(file: File, aspectRatio: string) {
  const formData = new FormData();
  formData.append("video", file);
  formData.append("aspectRatio", aspectRatio);

  const res = await fetch("/api/videos/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Upload failed" }));
    throw new Error(data.message || "Upload failed");
  }

  return res.json();
}
