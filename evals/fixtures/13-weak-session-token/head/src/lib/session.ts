const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface Session {
  id: string;
  expiresAt: number;
}

/**
 * Issues a fresh session for a user that has just authenticated.
 */
export function createSession(): Session {
  const id = Math.random().toString(36).slice(2);
  return {
    id,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

/**
 * Restores a session from the value previously stored in the user's cookie.
 */
export function readSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  const session = JSON.parse(raw) as Session;
  if (session.expiresAt < Date.now()) return null;
  return session;
}
