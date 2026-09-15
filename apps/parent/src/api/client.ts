import {
  addressChangeView,
  deliveryOverrideView,
  parentDayPlan,
  parentHome,
  parentTrackingView,
  type AddressChangeView,
  type CreateAddressChangeInput,
  type CreateDeliveryOverrideInput,
  type CreateRideExceptionInput,
  type DeliveryOverrideView,
  type ParentDayPlan,
  type ParentHome,
  type ParentTrackingView,
} from '@servisapp/contracts';
import { appVersion } from '../app-version';
import { envString } from '../env';

/**
 * Yayın derlemesinde `EXPO_PUBLIC_API_URL` gömülü değilse uygulama sessizce
 * `127.0.0.1`'e bakıyordu: mağazadan inen sürüm hiçbir şey yapamadan "internet
 * yok" diyordu ve sebebi görünmüyordu. Artık yerel adres yalnız geliştirmede
 * kullanılır; eksik yapılandırma ilk istekte açık bir hata verir.
 */
function resolveBaseUrl(): string {
  const configured = envString('EXPO_PUBLIC_API_URL');
  if (configured) return configured.replace(/\/$/, '');
  return __DEV__ ? 'http://127.0.0.1:3000' : '';
}

export const API_BASE_URL = resolveBaseUrl();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ParentSession {
  token: string;
  tenantId: string;
  fullName: string;
  membershipId: string;
}

export function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    throw new ApiError(0, 'api_unconfigured', 'Uygulama sunucu adresi olmadan derlenmiş');
  }
  return `${API_BASE_URL}${path}`;
}

/**
 * Sunucuya giden jeton her istekte Auth istemcisinden tazelenir.
 *
 * Oturum açılırken kopyalanan access token React state'inde donuyordu; Supabase
 * arka planda jetonu yenilese bile uygulama eskisini göndermeye devam ediyor,
 * uzun açık kalan uygulamada 401'e düşüyordu. Auth istemcisi artık tek doğruluk
 * kaynağı; okunamazsa saklı jetona düşülür (çevrimdışı hoşgörüsü).
 */
type AccessTokenProvider = () => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

export function setAccessTokenProvider(provider: AccessTokenProvider | null): void {
  accessTokenProvider = provider;
}

async function freshToken(session: ParentSession | null): Promise<string | null> {
  if (!session) return null;
  if (!accessTokenProvider) return session.token;
  try {
    return (await accessTokenProvider()) ?? session.token;
  } catch {
    return session.token;
  }
}

function headers(
  session: (ParentSession & { token: string }) | null,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client': 'parent',
    'x-app-version': appVersion(),
    ...(session
      ? {
          authorization: `Bearer ${session.token}`,
          ...(session.tenantId.length > 0 ? { 'x-tenant-id': session.tenantId } : {}),
        }
      : {}),
    ...extra,
  };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sunucudan gelen alan string değilse boş döner. `String(x)` kullanmak, nesne
 * gelen bir alanı sessizce "[object Object]" metnine çevirip ekrana basardı.
 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function request(
  method: 'GET' | 'POST',
  path: string,
  session: ParentSession | null,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    const token = await freshToken(session);
    response = await fetch(apiUrl(path), {
      method,
      headers: headers(session ? { ...session, token: token ?? session.token } : null),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Şu an internet yok');
  }
  const payload = await parseBody(response);
  if (!response.ok) {
    const code =
      isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : 'http_error';
    const message =
      isRecord(payload) && typeof payload['message'] === 'string'
        ? payload['message']
        : `İstek başarısız (${response.status})`;
    throw new ApiError(response.status, code, message);
  }
  return payload;
}

export async function devParentLogin(phone: string, password: string): Promise<{ token: string }> {
  const payload = await request('POST', '/v1/dev/parent-login', null, { phone, password });
  if (!isRecord(payload) || typeof payload['token'] !== 'string') {
    throw new ApiError(500, 'invalid_login', 'Giriş yanıtı geçersiz');
  }
  return { token: payload['token'] };
}

export interface InvitePreview {
  tenantName: string;
  phoneHint: string;
  status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
}

/** Davet önizlemesi açıktır: kimlik kanıtı değil, "hangi şirket, hangi numara" bilgisidir. */
export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const payload = await request('GET', `/v1/invites/${encodeURIComponent(token)}`, null);
  if (!isRecord(payload) || typeof payload['tenantName'] !== 'string') {
    throw new ApiError(500, 'invalid_invite', 'Davet yanıtı geçersiz');
  }
  const status = asString(payload['status']);
  return {
    tenantName: payload['tenantName'],
    phoneHint: asString(payload['phoneHint']),
    status:
      status === 'PENDING' || status === 'USED' || status === 'EXPIRED' || status === 'REVOKED'
        ? status
        : 'EXPIRED',
  };
}

/**
 * Daveti aktive eder. Jeton tek başına yetmez: sunucu, doğrulanmış telefonun
 * davetteki numarayla aynı olmasını şart koşar.
 */
export async function activateInvite(
  authToken: string,
  token: string,
): Promise<{ membershipId: string }> {
  const payload = await request(
    'POST',
    '/v1/parent/invites/activate',
    { token: authToken, tenantId: '', fullName: '', membershipId: '' },
    { token },
  );
  if (!isRecord(payload) || typeof payload['membershipId'] !== 'string') {
    throw new ApiError(500, 'invalid_invite', 'Aktivasyon yanıtı geçersiz');
  }
  return { membershipId: payload['membershipId'] };
}

export async function fetchSession(token: string): Promise<{
  fullName: string;
  memberships: Array<{
    membershipId: string;
    tenantId: string;
    tenantName: string;
    status: string;
    roles: Array<'ADMIN' | 'DRIVER' | 'ATTENDANT' | 'GUARDIAN'>;
  }>;
}> {
  const payload = await request('GET', '/v1/session', {
    token,
    tenantId: '',
    fullName: '',
    membershipId: '',
  });
  if (!isRecord(payload) || typeof payload['fullName'] !== 'string') {
    throw new ApiError(500, 'invalid_session', 'Oturum yanıtı geçersiz');
  }
  const memberships = payload['memberships'];
  if (!Array.isArray(memberships)) {
    throw new ApiError(500, 'invalid_session', 'Üyelik listesi yok');
  }
  return {
    fullName: payload['fullName'],
    memberships: memberships.filter(isRecord).map((item) => ({
      membershipId: asString(item['membershipId']),
      tenantId: asString(item['tenantId']),
      tenantName: asString(item['tenantName']),
      status: asString(item['status']),
      roles: Array.isArray(item['roles'])
        ? item['roles'].filter(
            (role): role is 'ADMIN' | 'DRIVER' | 'ATTENDANT' | 'GUARDIAN' =>
              role === 'ADMIN' || role === 'DRIVER' || role === 'ATTENDANT' || role === 'GUARDIAN',
          )
        : [],
    })),
  };
}

export async function fetchHome(session: ParentSession): Promise<ParentHome> {
  const payload = await request('GET', '/v1/parent/home', session);
  return parentHome.parse(payload);
}

export async function fetchTracking(
  session: ParentSession,
  tripId: string,
  studentId: string,
): Promise<ParentTrackingView> {
  const payload = await request(
    'GET',
    `/v1/parent/trips/${tripId}/tracking?studentId=${studentId}`,
    session,
  );
  return parentTrackingView.parse(payload);
}

export async function fetchDayPlan(
  session: ParentSession,
  studentId: string,
): Promise<ParentDayPlan> {
  return parentDayPlan.parse(await request('GET', `/v1/parent/students/${studentId}/day`, session));
}

export async function createRideException(
  session: ParentSession,
  input: CreateRideExceptionInput,
): Promise<{ items: unknown[] }> {
  const payload = await request('POST', '/v1/parent/exceptions', session, input);
  if (!isRecord(payload) || !Array.isArray(payload['items'])) {
    throw new ApiError(500, 'invalid_exception', 'İstisna yanıtı geçersiz');
  }
  return { items: payload['items'] };
}

export async function cancelRideException(
  session: ParentSession,
  exceptionId: string,
): Promise<void> {
  await request('POST', `/v1/parent/exceptions/${exceptionId}/cancel`, session);
}

export async function createDeliveryOverride(
  session: ParentSession,
  input: CreateDeliveryOverrideInput,
): Promise<DeliveryOverrideView> {
  return deliveryOverrideView.parse(
    await request('POST', '/v1/parent/delivery-overrides', session, input),
  );
}

export async function cancelDeliveryOverride(
  session: ParentSession,
  overrideId: string,
): Promise<void> {
  await request('POST', `/v1/parent/delivery-overrides/${overrideId}/cancel`, session);
}

export async function resendDeliveryOtp(
  session: ParentSession,
  overrideId: string,
): Promise<{ id: string; otpSentTo: string; addressText: string; resendCount: number }> {
  const payload = await request(
    'POST',
    `/v1/parent/delivery-overrides/${overrideId}/resend`,
    session,
  );
  if (
    !isRecord(payload) ||
    typeof payload['id'] !== 'string' ||
    typeof payload['otpSentTo'] !== 'string' ||
    typeof payload['addressText'] !== 'string' ||
    typeof payload['resendCount'] !== 'number'
  ) {
    throw new ApiError(500, 'invalid_resend', 'Kod yanıtı geçersiz');
  }
  return {
    id: payload['id'],
    otpSentTo: payload['otpSentTo'],
    addressText: payload['addressText'],
    resendCount: payload['resendCount'],
  };
}

export async function createAddressChange(
  session: ParentSession,
  input: CreateAddressChangeInput,
): Promise<AddressChangeView> {
  return addressChangeView.parse(
    await request('POST', '/v1/parent/address-changes', session, input),
  );
}

export async function registerPushToken(
  session: ParentSession,
  input: { deviceId: string; platform: 'IOS' | 'ANDROID'; pushToken: string },
): Promise<void> {
  await request('POST', '/v1/devices/push-token', session, input);
}
