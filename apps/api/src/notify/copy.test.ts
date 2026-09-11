import { describe, expect, it } from 'vitest';
import { composeNotification, netgsmGsmNo } from './copy.js';

describe('bildirim metni', () => {
  it('bindi ve yaklaşıyor metinlerini üretir', () => {
    expect(composeNotification({ type: 'STUDENT_ON_BOARD', studentName: 'Efe' })).toEqual({
      title: 'Servise bindi',
      body: 'Efe servise bindi.',
    });
    expect(composeNotification({ type: 'APPROACH', studentName: 'Ada' }).title).toBe(
      'Servis yaklaşıyor',
    );
  });

  it('Netgsm gsmno artısızdır', () => {
    expect(netgsmGsmNo('+905321234567')).toBe('905321234567');
  });
});
