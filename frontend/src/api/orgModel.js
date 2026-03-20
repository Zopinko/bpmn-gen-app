import { API_BASE } from "./config";

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

export function updateOrgProcessModelRef(nodeId, modelId, orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/process/${nodeId}/model-ref${query}`, {
    method: "PATCH",
    body: JSON.stringify({ modelId }),
  });
}

export function getOrgModelPresence(orgId) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/presence${query}`);
}

export function heartbeatOrgModelPresence(treeNodeId, orgId, active = true) {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
  return request(`/api/org-model/presence/heartbeat${query}`, {
    method: "POST",
    body: JSON.stringify({ treeNodeId, active }),
  });
}
