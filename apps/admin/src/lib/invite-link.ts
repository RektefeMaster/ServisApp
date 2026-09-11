export function publicInviteUrl(inviteUrl: string | null): string | null {
  if (!inviteUrl) return null;
  if (inviteUrl.startsWith('http://') || inviteUrl.startsWith('https://')) return inviteUrl;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${inviteUrl.startsWith('/') ? inviteUrl : `/${inviteUrl}`}`;
}
