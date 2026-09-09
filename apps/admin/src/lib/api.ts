export const API_BASE_URL = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function apiHeaders(token?: string, tenantId?: string): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client': 'admin',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
  };
}
