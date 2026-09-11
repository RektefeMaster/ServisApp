import { composeNotification, netgsmGsmNo } from './copy.js';

export type SendAttempt =
  | { ok: true }
  | { ok: false; retry: boolean; reason: string };

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

export function createExpoPushSender(
  fetchImpl: typeof fetch = fetch,
): PushSender {
  return {
    async send(input) {
      try {
        const response = await fetchImpl('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
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

export function createNetgsmSender(
  env: { usercode?: string; password?: string; msgheader?: string },
  fetchImpl: typeof fetch = fetch,
): SmsSender | null {
  const usercode = env.usercode?.trim() ?? '';
  const password = env.password?.trim() ?? '';
  const msgheader = env.msgheader?.trim() ?? '';
  if (!usercode || !password || !msgheader) return null;
  return {
    async send(input) {
      const url = new URL('https://api.netgsm.com.tr/sms/send/get');
      url.searchParams.set('usercode', usercode);
      url.searchParams.set('password', password);
      url.searchParams.set('gsmno', netgsmGsmNo(input.toE164));
      url.searchParams.set('message', input.body);
      url.searchParams.set('msgheader', msgheader);
      try {
        const response = await fetchImpl(url, { method: 'GET' });
        const text = (await response.text()).trim();
        if (response.status >= 500) {
          return { ok: false, retry: true, reason: `netgsm_http_${response.status}` };
        }
        if (text.startsWith('00') || text.startsWith('01') || text.startsWith('02')) {
          return { ok: true };
        }
        return { ok: false, retry: false, reason: `netgsm_${text.slice(0, 8) || 'empty'}` };
      } catch {
        return { ok: false, retry: true, reason: 'netgsm_network' };
      }
    },
  };
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
