import { describe, expect, it, vi } from 'vitest';
import { createExpoPushSender, createNetgsmSender } from './senders.js';

describe('Expo push', () => {
  it('tekil hata biletini retry etmez', async () => {
    const sender = createExpoPushSender(
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: { status: 'error', message: 'DeviceNotRegistered' } }), {
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

  it('00 yanıtını SENT sayar; gsmno artısızdır', async () => {
    const fetchImpl = vi.fn((input: string | URL) => {
      const url = String(input);
      expect(url).toContain('gsmno=905321234567');
      expect(url).not.toContain('gsmno=%2B');
      return Promise.resolve(new Response('00 123', { status: 200 }));
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
});
