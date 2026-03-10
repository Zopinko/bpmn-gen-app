import { API_BASE } from "./config";

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
