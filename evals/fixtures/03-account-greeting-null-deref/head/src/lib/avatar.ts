export interface AvatarSource {
  imageUrl?: string;
  initials: string;
}

/**
 * Returns the value to use for the avatar's image source. Falls back to an
 * inline SVG data URI built from the user's initials when no image is set.
 */
export function avatarSrc(source: AvatarSource): string {
  if (source.imageUrl) {
    return source.imageUrl;
  }
}
