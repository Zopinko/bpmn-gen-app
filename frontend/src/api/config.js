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
// Analytics live on the marketing site (bpmngen-web), not on the API.
const defaultAnalyticsApiBase =
  typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "https://bpmngen.com";
export const ANALYTICS_API_BASE =
  envAnalyticsApiBase || defaultAnalyticsApiBase;

export function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

export function buildAuthApiUrl(path) {
  return `${AUTH_API_BASE}${path}`;
}

export function buildAnalyticsApiUrl(path) {
  return `${ANALYTICS_API_BASE}${path}`;
}
