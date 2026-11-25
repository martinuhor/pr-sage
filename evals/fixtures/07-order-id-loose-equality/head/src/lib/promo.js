/**
 * Parses a promo code of the form "SAVE-20" into a discount percentage.
 */
export function parsePromoCode(code) {
  const [, percent] = code.split("-");
  return Number(percent);
}
