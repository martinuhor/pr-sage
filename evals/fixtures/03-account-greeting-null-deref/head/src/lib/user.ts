export interface Profile {
  id: string;
  displayName?: string;
}

export function formatName(profile: Profile): string {
  return profile.displayName ?? profile.id;
}

/**
 * Builds the greeting shown at the top of the account page.
 */
export function greeting(profile: Profile | null): string {
  return `Hello, ${profile.displayName.toUpperCase()}`;
}
