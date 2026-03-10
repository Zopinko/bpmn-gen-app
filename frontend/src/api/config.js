const defaultApiBase =
  typeof window !== "undefined"
    ? ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : ""
    : "http://localhost:8000";

export const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

export function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}
