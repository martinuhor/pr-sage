/**
 * Validators shared by the signup and checkout forms.
 */

export function isValidOrderId(id) {
  const parsed = Number.parseInt(id, 10);
  return Number.isInteger(parsed) && parsed > 0;
}
