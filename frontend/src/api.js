const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

/**
 * Error raised by every failed API call.
 *
 * The backend answers FastAPI errors as {detail: {code, message, params}}:
 * `code` is a stable identifier the UI can translate, `message` is the English
 * text used as-is when the code is unknown to the catalog (older backend,
 * unexpected failure...).
 */
export class ApiError extends Error {
  constructor(message, code = null, params = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.params = params;
  }
}

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    let code = "http";
    let params = { status: res.status };
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      const detail = body?.detail;
      if (typeof detail === "string") {
        code = null;
        message = detail;
      } else if (detail) {
        code = detail.code ?? null;
        params = detail.params ?? null;
        message = detail.message ?? message;
      }
    } catch {
      /* non-JSON response: keep the default message */
    }
    throw new ApiError(message, code, params);
  }
  return res.json();
}

const jsonPost = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function fetchMe() {
  return request("/me");
}

export function fetchStats() {
  return request("/stats");
}

export function fetchSenders(limit = 5000) {
  return request(`/senders?limit=${limit}`);
}

export function fetchSenderEmails(email) {
  return request(`/senders/${encodeURIComponent(email)}/emails`);
}

export function fetchEmailDetail(id) {
  return request(`/emails/${encodeURIComponent(id)}`);
}

export function trashEmails(ids) {
  return request("/emails/trash", jsonPost({ ids }));
}

export function trashSenders(emails) {
  return request("/senders/trash", jsonPost({ emails }));
}

export function reloadCsv() {
  return request("/reload");
}

export function startSync() {
  return request("/sync/start", { method: "POST" });
}

export function fetchSyncStatus() {
  return request("/sync/status");
}

export function fetchUnsubscribeSenders() {
  return request("/unsubscribe/senders");
}

export function scanUnsubscribe(emails = null, force = false) {
  return request("/unsubscribe/scan", jsonPost({ emails, force }));
}

export function runUnsubscribe(emails) {
  return request("/unsubscribe/run", jsonPost({ emails }));
}
