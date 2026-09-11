import { describe, expect, it } from 'vitest';
import { namesLikelySame, normalizePersonName } from './person-name.js';

describe('kişi adı', () => {
  it('Türkçe İ/i ve boşlukları hizalar', () => {
    expect(normalizePersonName('  AYŞE  DEMİR ')).toBe('ayşe demir');
    expect(namesLikelySame('Ayşe Demir', 'AYŞE DEMİR')).toBe(true);
  });

  it('farklı isimleri birleştirmez', () => {
    expect(namesLikelySame('Ayşe Demir', 'Mehmet Demir')).toBe(false);
  });
});
