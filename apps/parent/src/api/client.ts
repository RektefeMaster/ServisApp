const APP_VERSION = '0.0.0';

export const API_BASE_URL = (process.env['EXPO_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function apiHeaders(token?: string): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client': 'parent',
    'x-app-version': APP_VERSION,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
