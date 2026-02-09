const defaultApiBase =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "http://localhost:8000";

const API_BASE = import.meta.env.VITE_API_BASE || defaultApiBase;

export async function generateLinearWizardDiagram(payload) {
  const response = await fetch(`${API_BASE}/wizard/linear`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}

export async function renderEngineXml(engineJson) {
  const response = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(engineJson),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `Render failed (HTTP ${response.status} ${response.statusText})`;
    throw new Error(message);
  }

  return response.text();
}

export async function appendLaneFromDescription(payload) {
  const response = await fetch(`${API_BASE}/wizard/lane/append`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}

export async function exportBpmn(engineJson) {
  const response = await fetch(`${API_BASE}/wizard/export-bpmn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ engine_json: engineJson }),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.blob();
}

export async function importBpmn(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/wizard/import-bpmn`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}

export async function saveWizardModel(payload) {
  const response = await fetch(`${API_BASE}/wizard/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}

export async function loadWizardModel(modelId) {
  const response = await fetch(`${API_BASE}/wizard/models/${modelId}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json();
}

export async function listWizardModels(params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.append("limit", params.limit);
  if (params.offset) query.append("offset", params.offset);
  if (params.search) query.append("search", params.search);
  const response = await fetch(`${API_BASE}/wizard/models?${query.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json();
}

export async function deleteWizardModel(modelId) {
  const response = await fetch(`${API_BASE}/wizard/models/${modelId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json();
}

export async function renameWizardModel(modelId, name) {
  const response = await fetch(`${API_BASE}/wizard/models/${modelId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    credentials: "include",
  });
  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json();
}

export async function getProjectNotes() {
  const response = await fetch(`${API_BASE}/wizard/project-notes`, {
    credentials: "include",
  });
  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json();
}

export async function saveProjectNotes(notes) {
  const response = await fetch(`${API_BASE}/wizard/project-notes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes }),
    credentials: "include",
  });
  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json();
}

export async function mentorReview(payload) {
  const response = await fetch(`${API_BASE}/mentor/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}

export async function mentorApply(payload) {
  const response = await fetch(`${API_BASE}/mentor/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });

  if (!response.ok) {
    const message = `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json();
}
