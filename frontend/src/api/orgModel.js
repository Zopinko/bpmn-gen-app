const defaultApiBase =
  typeof window !== "undefined"
    ? ["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:8000`
      : ""
    : "http://localhost:8000";

const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || `HTTP ${response.status}`);
  }
  return data;
}

export function getOrgModel() {
  return request("/api/org-model");
}

export function createOrgFolder(payload) {
  return request("/api/org-model/folder", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createOrgProcess(payload) {
  return request("/api/org-model/process", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function renameOrgNode(nodeId, name) {
  return request(`/api/org-model/node/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function moveOrgNode(payload) {
  // Move payload contract: source process node and target folder.
  const body = {
    nodeId: payload?.nodeId,
    targetParentId: payload?.targetParentId,
  };
  return request("/api/org-model/move", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteOrgNode(nodeId) {
  return request(`/api/org-model/node/${nodeId}`, {
    method: "DELETE",
  });
}
