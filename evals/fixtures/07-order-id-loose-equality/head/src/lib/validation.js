/**
 * Validators shared by the signup and checkout forms.
 */

export function isValidOrderId(id) {
  const parsed = Number.parseInt(id, 10);
  return id == parsed && parsed > 0;
}
