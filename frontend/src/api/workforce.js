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

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, String(value));
    }
  });
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function listEmployees(orgId) {
  return request(`/api/workforce/employees${queryString({ org_id: orgId })}`);
}

export function createEmployee(orgId, payload) {
  return request(`/api/workforce/employees${queryString({ org_id: orgId })}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEmployee(orgId, empId, payload) {
  return request(`/api/workforce/employees/${encodeURIComponent(empId)}${queryString({ org_id: orgId })}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteEmployee(orgId, empId) {
  return request(`/api/workforce/employees/${encodeURIComponent(empId)}${queryString({ org_id: orgId })}`, {
    method: "DELETE",
  });
}

export function listCompetencies(orgId, params = {}) {
  return request(`/api/workforce/competencies${queryString({ org_id: orgId, ...params })}`);
}

export function createCompetency(orgId, payload) {
  return request(`/api/workforce/competencies${queryString({ org_id: orgId })}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCompetency(orgId, competencyId, payload) {
  return request(`/api/workforce/competencies/${encodeURIComponent(competencyId)}${queryString({ org_id: orgId })}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCompetency(orgId, competencyId) {
  return request(`/api/workforce/competencies/${encodeURIComponent(competencyId)}${queryString({ org_id: orgId })}`, {
    method: "DELETE",
  });
}

export function getMatrix(orgId, processNodeId = "") {
  return request(`/api/workforce/matrix${queryString({ org_id: orgId, process_node_id: processNodeId })}`);
}
