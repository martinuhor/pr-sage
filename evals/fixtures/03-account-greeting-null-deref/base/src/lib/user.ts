export interface Profile {
  id: string;
  displayName?: string;
}

export function formatName(profile: Profile): string {
  return profile.displayName ?? profile.id;
}
