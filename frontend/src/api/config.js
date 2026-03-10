const defaultApiBase =
  typeof window !== "undefined"
    ? ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : ""
    : "http://localhost:8000";

export const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

const envAuthApiBase = import.meta.env.VITE_AUTH_API_BASE;
export const AUTH_API_BASE =
  envAuthApiBase || API_BASE;
const envAnalyticsApiBase = import.meta.env.VITE_ANALYTICS_API_BASE;
export const ANALYTICS_API_BASE =
  envAnalyticsApiBase || API_BASE;

export function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

export function buildAuthApiUrl(path) {
  return `${AUTH_API_BASE}${path}`;
}

export function buildAnalyticsApiUrl(path) {
  return `${ANALYTICS_API_BASE}${path}`;
}
