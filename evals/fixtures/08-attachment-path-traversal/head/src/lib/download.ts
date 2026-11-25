import { readFile } from "node:fs/promises";
import { join } from "node:path";

const UPLOADS_DIR = join(process.cwd(), "uploads");

/**
 * Reads a user-uploaded attachment from the uploads directory.
 */
export async function readAttachment(fileName: string): Promise<Buffer> {
  const fullPath = join(UPLOADS_DIR, fileName);
  return readFile(fullPath);
}
