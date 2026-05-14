const API_BASE = "http://localhost:8000/api";

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error("Erreur lors du chargement des stats");
  return res.json();
}

export async function fetchSenders(limit = 948) {
  const res = await fetch(`${API_BASE}/senders?limit=${limit}`);
  if (!res.ok) throw new Error("Erreur lors du chargement des expéditeurs");
  return res.json();
}

export async function fetchSenderEmails(email) {
  const res = await fetch(`${API_BASE}/senders/${encodeURIComponent(email)}/emails`);
  if (!res.ok) throw new Error(`Erreur lors du chargement des mails de ${email}`);
  return res.json();
}

export async function trashEmails(ids) {
  const res = await fetch(`${API_BASE}/emails/trash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("Erreur lors de la suppression");
  return res.json();
}

export async function reloadCsv() {
  const res = await fetch(`${API_BASE}/reload`);
  if (!res.ok) throw new Error("Erreur lors du rechargement du CSV");
  return res.json();
}
