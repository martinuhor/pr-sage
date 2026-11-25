import { db } from "../db";

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  isAdmin: boolean;
}

/**
 * Lists administrators for the internal console.
 */
export async function listAdmins(): Promise<AdminUser[]> {
  return db.query<AdminUser>(
    "SELECT id, email, password_hash, is_admin FROM users WHERE is_admin = true"
  );
}
