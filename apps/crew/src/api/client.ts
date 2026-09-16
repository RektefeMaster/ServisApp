import {
  commandResult,
  locationIngestResult,
  platformConfig,
  tripDetail,
  tripListResponse,
  type CommandResult,
  type LocationIngestResult,
  type LocationPingInput,
  type PlatformConfig,
  type ReportIncidentInput,
  type StudentCommandInput,
  type UndoStudentCommandInput,
  type TripDetail,
  type TripSummary,
} from '@servisapp/contracts';
import { Platform } from 'react-native';
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

export interface CrewSession {
  token: string;
  tenantId: string;
  fullName: string;
  membershipId: string;
  roles: Array<'ADMIN' | 'DRIVER' | 'ATTENDANT' | 'GUARDIAN'>;
  deviceId: string;
}

export function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    throw new ApiError(0, 'api_unconfigured', 'Uygulama sunucu adresi olmadan derlenmiş');
  }
  return `${API_BASE_URL}${path}`;
}

export function devicePlatform(): 'IOS' | 'ANDROID' {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
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

async function freshToken(session: CrewSession | null): Promise<string | null> {
  if (!session) return null;
  if (!accessTokenProvider) return session.token;
  try {
    return (await accessTokenProvider()) ?? session.token;
  } catch {
    return session.token;
  }
}

function headers(
  session: (CrewSession & { token: string }) | null,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-client': 'crew',
    'x-app-version': appVersion(),
    ...(session
      ? {
          authorization: `Bearer ${session.token}`,
          ...(session.tenantId.length > 0 ? { 'x-tenant-id': session.tenantId } : {}),
          ...(session.deviceId.length > 0 ? { 'x-device-id': session.deviceId } : {}),
          'x-device-platform': devicePlatform(),
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
  session: CrewSession | null,
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
  } catch (caught) {
    if (caught instanceof ApiError) throw caught;
    // "Kuyruğa alındı" demek yanlıştı: sefer başlatma, kapatma, araç kontrolü
    // ve OTP doğrulama outbox'tan geçmez. Şoför seferi başlattı sanıp yola
    // çıkıyordu.
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

export async function fetchConfig(): Promise<PlatformConfig> {
  return platformConfig.parse(await request('GET', '/v1/config', null));
}

export async function devLogin(email: string, password: string): Promise<{ token: string }> {
  const payload = await request('POST', '/v1/dev/login', null, { email, password });
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
    roles: CrewSession['roles'];
  }>;
}> {
  const payload = await request('GET', '/v1/session', {
    token,
    tenantId: '',
    fullName: '',
    membershipId: '',
    roles: [],
    deviceId: '',
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
            (role): role is CrewSession['roles'][number] =>
              role === 'ADMIN' || role === 'DRIVER' || role === 'ATTENDANT' || role === 'GUARDIAN',
          )
        : [],
    })),
  };
}

export async function listTrips(session: CrewSession, date: string): Promise<TripSummary[]> {
  const payload = await request('GET', `/v1/trips?date=${date}`, session);
  return tripListResponse.parse(payload).items;
}

export async function getTrip(session: CrewSession, tripId: string): Promise<TripDetail> {
  const payload = await request('GET', `/v1/trips/${tripId}`, session);
  return tripDetail.parse(payload);
}

export async function recordVehicleCheck(
  session: CrewSession,
  tripId: string,
  phase: 'BEFORE' | 'AFTER',
): Promise<void> {
  await request('POST', `/v1/trips/${tripId}/vehicle-checks`, session, {
    phase,
    vehicleEmptyConfirmed: true,
  });
}

export async function startTrip(session: CrewSession, tripId: string): Promise<void> {
  await request('POST', `/v1/trips/${tripId}/start`, session);
}

export async function completeTrip(session: CrewSession, tripId: string): Promise<void> {
  await request('POST', `/v1/trips/${tripId}/complete`, session);
}

export async function postCommand(
  session: CrewSession,
  tripId: string,
  input: StudentCommandInput,
): Promise<CommandResult> {
  const payload = await request('POST', `/v1/trips/${tripId}/commands`, session, input);
  return commandResult.parse(payload);
}

export async function postUndo(
  session: CrewSession,
  tripId: string,
  input: UndoStudentCommandInput,
): Promise<CommandResult> {
  const payload = await request('POST', `/v1/trips/${tripId}/commands/undo`, session, input);
  return commandResult.parse(payload);
}

export async function reportIncident(
  session: CrewSession,
  tripId: string,
  input: ReportIncidentInput,
): Promise<void> {
  await request('POST', `/v1/trips/${tripId}/incidents`, session, input);
}

export async function postLocation(
  session: CrewSession,
  tripId: string,
  input: LocationPingInput,
): Promise<LocationIngestResult> {
  const payload = await request('POST', `/v1/trips/${tripId}/location`, session, input);
  return locationIngestResult.parse(payload);
}

export async function verifyDeliveryOtp(
  session: CrewSession,
  tripId: string,
  tripStudentId: string,
  code: string,
): Promise<void> {
  await request('POST', `/v1/trips/${tripId}/otp/verify`, session, { tripStudentId, code });
}

export async function ackCriticalAlert(
  session: CrewSession,
  tripId: string,
  alertId: string,
): Promise<void> {
  await request('POST', `/v1/trips/${tripId}/alerts/${alertId}/ack`, session);
}
