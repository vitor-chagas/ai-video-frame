import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    // Hashed filenames (e.g. app.abc123.js) are immutable — cache for 1 year
    setHeaders(res, filePath) {
      const isHashed = /\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|ico)$/.test(filePath);
      if (isHashed) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    },
  }));

  // fall through to index.html if the file doesn't exist
  // In Express 5, the wildcard must be named, e.g. *path or *splat
  app.get("*path", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
