/**
 * Strips server-only file path fields before sending video data to clients.
 */
export function sanitizeVideo<T extends { originalPath?: unknown; processedPath?: unknown; subtitlePath?: unknown }>(
  v: T
): Omit<T, "originalPath" | "processedPath" | "subtitlePath"> {
  const { originalPath, processedPath, subtitlePath, ...safe } = v;
  return safe;
}
