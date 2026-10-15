// Centralized API configuration for local dev and cloud hosting (e.g. Vercel)
export const BACKEND_URL = (
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_BACKEND_URL) ||
  "http://localhost:8000"
).replace(/\/+$/, "");

export function getApiUrl(endpoint = "") {
  if (!endpoint) return BACKEND_URL;
  const cleanPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${BACKEND_URL}${cleanPath}`;
}
