const BASE_URL = process.env.N8N_BASE_URL || 'http://n8n:5678';
const API_KEY = process.env.N8N_API_KEY;
const WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

async function apiRequest(method, path, body) {
  const url = `${BASE_URL}/api/v1${path}`;
  const headers = {
    'X-N8N-API-KEY': API_KEY,
    'Accept': 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function listWorkflows() {
  return apiRequest('GET', '/workflows');
}

export async function getWorkflow(id) {
  return apiRequest('GET', `/workflows/${id}`);
}

export async function createWorkflow(workflowData) {
  return apiRequest('POST', '/workflows', workflowData);
}

export async function updateWorkflow(id, workflowData) {
  return apiRequest('PUT', `/workflows/${id}`, workflowData);
}

export async function activateWorkflow(id) {
  return apiRequest('POST', `/workflows/${id}/activate`);
}

export async function deactivateWorkflow(id) {
  return apiRequest('POST', `/workflows/${id}/deactivate`);
}

export async function getExecutions(workflowId) {
  const query = workflowId ? `?workflowId=${workflowId}` : '';
  return apiRequest('GET', `/executions${query}`);
}

export async function getExecution(id) {
  return apiRequest('GET', `/executions/${id}`);
}

const WEBHOOK_PATH_RE = /^[a-zA-Z0-9/_-]+$/;

export async function triggerWebhook(path, payload) {
  if (!WEBHOOK_PATH_RE.test(path)) {
    throw new Error(`Invalid webhook path: ${path}`);
  }
  const url = `${BASE_URL}/webhook/${path}`;
  const headers = {
    'Content-Type': 'application/json',
  };
  if (WEBHOOK_SECRET) {
    headers['X-Webhook-Secret'] = WEBHOOK_SECRET;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook POST ${path} → ${res.status}: ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return { response: await res.text() };
}
