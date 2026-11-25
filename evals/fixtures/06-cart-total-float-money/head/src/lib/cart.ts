export interface CartItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

/**
 * Totals a cart in dollars, applying an optional percentage discount.
 */
export function cartTotal(items: CartItem[], discountPercent = 0): number {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discounted = subtotal - subtotal * (discountPercent / 100);
  return discounted;
}
