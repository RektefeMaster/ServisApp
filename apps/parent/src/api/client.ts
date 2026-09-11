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

const APP_VERSION = '0.0.0';

export const API_BASE_URL = (process.env['EXPO_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

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
  return `${API_BASE_URL}${path}`;
}

function headers(session: ParentSession | null, extra?: Record<string, string>): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client': 'parent',
    'x-app-version': APP_VERSION,
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

async function request(
  method: 'GET' | 'POST',
  path: string,
  session: ParentSession | null,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: headers(session),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Şu an internet yok');
  }
  const payload = await parseBody(response);
  if (!response.ok) {
    const code = isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : 'http_error';
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
      membershipId: String(item['membershipId'] ?? ''),
      tenantId: String(item['tenantId'] ?? ''),
      tenantName: String(item['tenantName'] ?? ''),
      status: String(item['status'] ?? ''),
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

export async function cancelRideException(session: ParentSession, exceptionId: string): Promise<void> {
  await request('POST', `/v1/parent/exceptions/${exceptionId}/cancel`, session);
}

export async function createDeliveryOverride(
  session: ParentSession,
  input: CreateDeliveryOverrideInput,
): Promise<DeliveryOverrideView> {
  return deliveryOverrideView.parse(await request('POST', '/v1/parent/delivery-overrides', session, input));
}

export async function cancelDeliveryOverride(session: ParentSession, overrideId: string): Promise<void> {
  await request('POST', `/v1/parent/delivery-overrides/${overrideId}/cancel`, session);
}

export async function resendDeliveryOtp(
  session: ParentSession,
  overrideId: string,
): Promise<{ id: string; otpCode: string; addressText: string; resendCount: number }> {
  const payload = await request(
    'POST',
    `/v1/parent/delivery-overrides/${overrideId}/resend`,
    session,
  );
  if (
    !isRecord(payload) ||
    typeof payload['id'] !== 'string' ||
    typeof payload['otpCode'] !== 'string' ||
    typeof payload['addressText'] !== 'string' ||
    typeof payload['resendCount'] !== 'number'
  ) {
    throw new ApiError(500, 'invalid_resend', 'Kod yanıtı geçersiz');
  }
  return {
    id: payload['id'],
    otpCode: payload['otpCode'],
    addressText: payload['addressText'],
    resendCount: payload['resendCount'],
  };
}

export async function createAddressChange(
  session: ParentSession,
  input: CreateAddressChangeInput,
): Promise<AddressChangeView> {
  return addressChangeView.parse(await request('POST', '/v1/parent/address-changes', session, input));
}

export async function registerPushToken(
  session: ParentSession,
  input: { deviceId: string; platform: 'IOS' | 'ANDROID'; pushToken: string },
): Promise<void> {
  await request('POST', '/v1/devices/push-token', session, input);
}
