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
    const error = new Error(data?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    error.detail = data?.detail || null;
    throw error;
  }
  return data;
}

export function getOrgModel(orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model${query}`);
}

export function createOrgFolder(payload, orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/folder${query}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createOrgProcess(payload, orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/process${query}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createOrgProcessFromOrgModel(payload, orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/process-from-org-model${query}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function renameOrgNode(nodeId, name, orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/node/${nodeId}${query}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function moveOrgNode(payload, orgId) {
  // Move payload contract: source process node and target folder.
  const body = {
    nodeId: payload?.nodeId,
    targetParentId: payload?.targetParentId,
  };
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/move${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteOrgNode(nodeId, orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/node/${nodeId}${query}`, {
    method: "DELETE",
  });
}
