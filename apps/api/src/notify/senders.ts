import { composeNotification, netgsmGsmNo } from './copy.js';

export type SendAttempt = { ok: true } | { ok: false; retry: boolean; reason: string };

export interface PushSender {
  send(input: {
    to: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<SendAttempt>;
}

export interface SmsSender {
  send(input: { toE164: string; body: string }): Promise<SendAttempt>;
}

/**
 * Zaman aşımı Netgsm'deki ile aynı sebeple zorunlu: outbox işi tek süreçte,
 * sırayla akar. Asılı kalan tek bir `exp.host` isteği, arkasındaki bütün veli
 * bildirimlerini ve teslim OTP SMS'lerini süresiz bekletirdi.
 */
const EXPO_PUSH_TIMEOUT_MS = 10_000;

export function createExpoPushSender(fetchImpl: typeof fetch = fetch): PushSender {
  return {
    async send(input) {
      try {
        const response = await fetchImpl('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            to: input.to,
            title: input.title,
            body: input.body,
            sound: 'default',
            data: input.data,
          }),
        });
        if (response.status >= 500) {
          return { ok: false, retry: true, reason: `expo_${response.status}` };
        }
        if (!response.ok) {
          return { ok: false, retry: false, reason: `expo_${response.status}` };
        }
        const payload: unknown = await response.json().catch(() => null);
        if (expoTicketFailed(payload)) {
          return { ok: false, retry: false, reason: 'expo_ticket_error' };
        }
        return { ok: true };
      } catch {
        return { ok: false, retry: true, reason: 'expo_network' };
      }
    },
  };
}

const NETGSM_URL = 'https://api.netgsm.com.tr/sms/rest/v2/send';
const NETGSM_TIMEOUT_MS = 10_000;
/** Netgsm "kuyruğa alındı" kodları. */
const NETGSM_OK_CODES = new Set(['00', '01', '02']);

/**
 * Netgsm REST v2 — POST + Basic auth.
 *
 * Eski hâl `/sms/send/get` ucunu kullanıyordu: hesap PAROLASI, alıcı NUMARASI
 * ve mesaj gövdesi (yani teslim OTP kodunun kendisi) URL query string'inde
 * gidiyordu. Query string sağlayıcı erişim loglarına, ara vekillere ve hata
 * izlerine düşer; bu, "kişisel veri log'a düşmez" kuralının açık ihlaliydi.
 * Kimlik artık Authorization başlığında, kod da istek gövdesinde taşınır.
 */
export function createNetgsmSender(
  env: { usercode?: string; password?: string; msgheader?: string },
  fetchImpl: typeof fetch = fetch,
): SmsSender | null {
  const usercode = env.usercode?.trim() ?? '';
  const password = env.password?.trim() ?? '';
  const msgheader = env.msgheader?.trim() ?? '';
  if (!usercode || !password || !msgheader) return null;
  const authorization = `Basic ${Buffer.from(`${usercode}:${password}`, 'utf8').toString('base64')}`;
  return {
    async send(input) {
      try {
        const response = await fetchImpl(NETGSM_URL, {
          method: 'POST',
          signal: AbortSignal.timeout(NETGSM_TIMEOUT_MS),
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization,
          },
          body: JSON.stringify({
            msgheader,
            encoding: 'TR',
            messages: [{ msg: input.body, no: netgsmGsmNo(input.toE164) }],
          }),
        });
        if (response.status >= 500) {
          return { ok: false, retry: true, reason: `netgsm_http_${String(response.status)}` };
        }
        const payload: unknown = await response.json().catch(() => null);
        const code = netgsmCode(payload);
        if (code !== null && NETGSM_OK_CODES.has(code)) return { ok: true };
        if (!response.ok && code === null) {
          return { ok: false, retry: false, reason: `netgsm_http_${String(response.status)}` };
        }
        return { ok: false, retry: false, reason: `netgsm_${code ?? 'empty'}` };
      } catch {
        // Zaman aşımı da buraya düşer: kuyruk satırı QUEUED kalır, tekrar denenir.
        return { ok: false, retry: true, reason: 'netgsm_network' };
      }
    },
  };
}

/** Yanıt gövdesindeki `code`; sağlayıcı bazen sayı, bazen metin döner. */
function netgsmCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('code' in payload)) return null;
  const raw: unknown = payload.code;
  if (typeof raw === 'string' && raw.length > 0) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw).padStart(2, '0');
  return null;
}

function expoTicketFailed(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) return false;
  const data = payload.data;
  if (Array.isArray(data)) return data.some(ticketHasError);
  return ticketHasError(data);
}

function ticketHasError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Reflect.get(value, 'status') === 'error';
}

export { composeNotification, netgsmGsmNo };
