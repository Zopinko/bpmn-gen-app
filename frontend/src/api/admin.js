const defaultApiBase =
  typeof window !== "undefined"
    ? ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : ""
    : "http://localhost:8000";

const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.detail || `HTTP ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function getAdminUsers() {
  return request("/api/admin/users");
}

export function getAdminOrgs() {
  return request("/api/admin/orgs");
}

export function getAdminModels() {
  return request("/api/admin/models");
}
