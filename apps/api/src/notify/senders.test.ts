import { describe, expect, it, vi } from 'vitest';
import { createExpoPushSender, createNetgsmSender } from './senders.js';

describe('Expo push', () => {
  it('tekil hata biletini retry etmez', async () => {
    const sender = createExpoPushSender(
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ data: { status: 'error', message: 'DeviceNotRegistered' } }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
      ),
    );
    await expect(
      sender.send({ to: 'ExponentPushToken[x]', title: 't', body: 'b', data: {} }),
    ).resolves.toEqual({ ok: false, retry: false, reason: 'expo_ticket_error' });
  });

  it('dizi biletindeki hatayı da yakalar', async () => {
    const sender = createExpoPushSender(
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [{ status: 'error' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    await expect(
      sender.send({ to: 'ExponentPushToken[x]', title: 't', body: 'b', data: {} }),
    ).resolves.toEqual({ ok: false, retry: false, reason: 'expo_ticket_error' });
  });
});

describe('Netgsm', () => {
  it('eksik kimlikte sender oluşturulmaz', () => {
    expect(createNetgsmSender({})).toBeNull();
    expect(createNetgsmSender({ usercode: 'u', password: 'p' })).toBeNull();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('00 yanıtını SENT sayar; gsmno artısızdır', async () => {
    const fetchImpl = vi.fn((input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.netgsm.com.tr/sms/rest/v2/send');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        messages: { no: string; msg: string }[];
      };
      expect(body.messages[0]?.no).toBe('905321234567');
      expect(body.messages[0]?.msg).toBe('kod');
      return Promise.resolve(jsonResponse({ code: '00', jobid: '123' }));
    });
    const sender = createNetgsmSender(
      { usercode: 'u', password: 'p', msgheader: 'SERVIS' },
      fetchImpl as typeof fetch,
    );
    if (!sender) throw new Error('Netgsm sender bekleniyordu');
    await expect(sender.send({ toE164: '+905321234567', body: 'kod' })).resolves.toEqual({
      ok: true,
    });
  });

  /** Parola ve OTP kodu URL'e değil, başlık ve gövdeye yazılır (log sızıntısı). */
  it('parolayı ve kodu URL’ye koymaz', async () => {
    const fetchImpl = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).not.toContain('gizli-parola');
      expect(url).not.toContain('482913');
      expect(url).not.toContain('?');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe(
        `Basic ${Buffer.from('kullanici:gizli-parola', 'utf8').toString('base64')}`,
      );
      return Promise.resolve(jsonResponse({ code: '00' }));
    });
    const sender = createNetgsmSender(
      { usercode: 'kullanici', password: 'gizli-parola', msgheader: 'SERVIS' },
      fetchImpl as typeof fetch,
    );
    if (!sender) throw new Error('Netgsm sender bekleniyordu');
    await expect(
      sender.send({ toE164: '+905321234567', body: 'ServisApp kodu: 482913' }),
    ).resolves.toEqual({ ok: true });
  });

  it('hata kodunu retry etmez, 5xx’i retry eder', async () => {
    const rejected = createNetgsmSender(
      { usercode: 'u', password: 'p', msgheader: 'SERVIS' },
      vi.fn(() => Promise.resolve(jsonResponse({ code: '30' }))),
    );
    await expect(rejected?.send({ toE164: '+905321234567', body: 'kod' })).resolves.toEqual({
      ok: false,
      retry: false,
      reason: 'netgsm_30',
    });

    const down = createNetgsmSender(
      { usercode: 'u', password: 'p', msgheader: 'SERVIS' },
      vi.fn(() => Promise.resolve(new Response('', { status: 503 }))),
    );
    await expect(down?.send({ toE164: '+905321234567', body: 'kod' })).resolves.toEqual({
      ok: false,
      retry: true,
      reason: 'netgsm_http_503',
    });
  });
});
