import { db } from "../db";
import type { Order, OrderItem } from "../types";

/**
 * Loads every order for a customer together with its line items.
 */
export async function loadOrders(customerId: string): Promise<Order[]> {
  const orders = await db.query<Order>(
    "SELECT id, customer_id, total_cents, created_at FROM orders WHERE customer_id = $1",
    [customerId]
  );

  for (const order of orders) {
    order.items = await db.query<OrderItem>(
      "SELECT id, order_id, sku, quantity FROM order_items WHERE order_id = $1",
      [order.id]
    );
  }

  return orders;
}
