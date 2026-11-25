import { persistOrder, recordEvent } from "./events";

/**
 * Marks an order as shipped, persists it and records an audit entry.
 */
export async function shipOrder(order) {
  order.status = "shipped";
  await persistOrder(order);
  recordEvent("order.shipped", { id: order.id });
}
