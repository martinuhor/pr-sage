/**
 * Persists the order's latest state. Called on every status change.
 */
export async function persistOrder(order) {
  const response = await fetch("/api/orders", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  return response.json();
}

/**
 * Appends an entry to the append-only audit log.
 */
export async function recordEvent(type, payload) {
  await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...payload }),
  });
}
