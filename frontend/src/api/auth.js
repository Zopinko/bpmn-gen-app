import { buildAuthApiUrl } from "./config";

async function request(path, options = {}) {
  const response = await fetch(buildAuthApiUrl(path), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.detail || `HTTP ${response.status} ${response.statusText}`;
    const error = new Error(detail);
    error.status = response.status;
    error.detail = data?.detail || null;
    throw error;
  }
  return data;
}

export function registerAuth(payload) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginAuth(payload) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logoutAuth() {
  return request("/api/auth/logout", { method: "POST" });
}

export function getMe() {
  return request("/api/auth/me", { method: "GET" });
}

export function requestPasswordReset(payload) {
  return request("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetPassword(payload) {
  return request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function changePassword(payload) {
  return request("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMe(payload) {
  return request("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
