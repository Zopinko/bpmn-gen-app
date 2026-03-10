const defaultApiBase =
  typeof window !== "undefined"
    ? ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : ""
    : "http://localhost:8000";

export const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

const forcedSameOriginAuthHosts = new Set(["app.bpmngen.com"]);
const currentHost = typeof window !== "undefined" ? window.location.hostname : "";

const envAuthApiBase = import.meta.env.VITE_AUTH_API_BASE;
export const AUTH_API_BASE =
  forcedSameOriginAuthHosts.has(currentHost) ? "" : envAuthApiBase || API_BASE;

export function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

export function buildAuthApiUrl(path) {
  return `${AUTH_API_BASE}${path}`;
}
