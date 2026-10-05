/** Image origins accepted for staff profile and author photos. */
export function profileImageOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>(['https://images.unsplash.com']);
  for (const raw of [env.MEDIA_PUBLIC_BASE_URL, ...(env.PROFILE_IMAGE_ALLOWED_ORIGINS || '').split(',')]) {
    const value = raw?.trim();
    if (!value || value.startsWith('/')) continue;
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('PROFILE_IMAGE_ALLOWED_ORIGINS contains an invalid URL.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || (raw !== env.MEDIA_PUBLIC_BASE_URL && url.pathname !== '/')) {
      throw new Error('Profile image origins must be HTTPS origins without credentials, path, query or fragment.');
    }
    origins.add(url.origin);
  }
  return [...origins];
}

export function validateProfileImageUrl(value: unknown, field: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof value !== 'string') return `${field} must be a string.`;
  const url = value.trim();
  if (!url) return null; // No picture uses initials.
  if (url.length > 2048 || /[\r\n\t]/.test(url)) return `${field} is invalid or too long.`;
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !profileImageOrigins(env).includes(parsed.origin)) {
      return `${field} must use an approved HTTPS image origin. Ask an administrator to add its origin to PROFILE_IMAGE_ALLOWED_ORIGINS.`;
    }
    return null;
  } catch { return `${field} must be a valid image URL or a path beginning with /.`; }
}
