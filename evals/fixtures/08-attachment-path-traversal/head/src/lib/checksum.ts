import { createHash } from "node:crypto";

/**
 * Computes the SHA-256 checksum advertised in a download's Content-Digest.
 */
export function sha256(data: string): string {
  const hash = createHash("sha256");
  hash.update(data);
  const digest = hash.digest("hex");
}
