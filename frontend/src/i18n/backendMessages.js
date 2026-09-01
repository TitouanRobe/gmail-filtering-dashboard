/**
 * Translation of the messages produced by the backend.
 *
 * The API never sends UI text it decided on its own: it sends a stable `key`
 * (plus its parameters) and an English `fallback`. Anything the catalog knows
 * is displayed in the user's language; anything it does not — an unexpected
 * exception, a newer backend — is displayed as the English text rather than a
 * raw key.
 */
function resolve(t, namespace, key, params, fallback) {
  if (!key) return fallback ?? "";
  const path = `${namespace}.${key}`;
  const text = t(path, params ?? undefined);
  return text === path ? (fallback ?? path) : text;
}

/** Message of a failed API call (see ApiError in api.js). */
export function apiErrorMessage(t, error) {
  if (!error) return "";
  return resolve(t, "apiError", error.code, error.params, error.message);
}

/** Progress message of a Gmail sync (GET /api/sync/status). */
export function syncStatusMessage(t, status, fallback = "") {
  return resolve(t, "syncStatus", status?.message_key, status?.message_params, status?.message || fallback);
}

/** Per-sender outcome of an unsubscribe run (POST /api/unsubscribe/run). */
export function unsubscribeDetail(t, entry, fallback = "") {
  return resolve(t, "unsubDetail", entry?.detail_key, entry?.detail_params, entry?.detail || fallback);
}
