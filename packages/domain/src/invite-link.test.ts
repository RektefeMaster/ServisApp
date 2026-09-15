import { describe, expect, it } from 'vitest';
import { parseInviteToken } from './invite-link.js';

const TOKEN = 'Abc123_def456-ghi789.jkl';

describe('davet bağlantısı', () => {
  it('https panel linkinden jetonu alır', () => {
    expect(parseInviteToken(`https://panel.servisapp.app/i/${TOKEN}`)).toBe(TOKEN);
  });

  it('derin bağlantıdan jetonu alır', () => {
    expect(parseInviteToken(`servisapp-parent://i/${TOKEN}`)).toBe(TOKEN);
  });

  it('sorgu ve fragment kuyruğunu atar', () => {
    expect(parseInviteToken(`https://panel.servisapp.app/i/${TOKEN}?utm=sms#x`)).toBe(TOKEN);
  });

  it('elle yapıştırılan çıplak jetonu kabul eder', () => {
    expect(parseInviteToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it('kısa, boş veya biçimsiz girdiyi reddeder', () => {
    expect(parseInviteToken('')).toBeNull();
    expect(parseInviteToken('kisa')).toBeNull();
    expect(parseInviteToken('https://panel.servisapp.app/i/')).toBeNull();
    expect(parseInviteToken('https://panel.servisapp.app/i/abc def ghi jkl mno')).toBeNull();
  });
});
