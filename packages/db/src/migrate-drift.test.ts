import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffMigrations, migrationsDir } from './migrate-files.js';

describe('diffMigrations', () => {
  it('her şey uygulanmışsa kayma yoktur', () => {
    const files = ['0001_a.sql', '0002_b.sql'];
    expect(diffMigrations(files, files)).toEqual({ pending: [], unknown: [] });
  });

  it('boş defter her dosyayı bekleyen sayar', () => {
    const files = ['0001_a.sql', '0002_b.sql'];
    expect(diffMigrations(files, [])).toEqual({ pending: files, unknown: [] });
  });

  it('üretim geride kaldığında yalnız eksikleri sırayla listeler', () => {
    const files = ['0001_a.sql', '0002_b.sql', '0003_c.sql', '0004_d.sql'];
    expect(diffMigrations(files, ['0001_a.sql', '0002_b.sql'])).toEqual({
      pending: ['0003_c.sql', '0004_d.sql'],
      unknown: [],
    });
  });

  it('defterde olup dosyası silinmiş migrationı ayrı raporlar', () => {
    expect(diffMigrations(['0001_a.sql'], ['0001_a.sql', '0009_silinmis.sql'])).toEqual({
      pending: [],
      unknown: ['0009_silinmis.sql'],
    });
  });

  it('araya sıkışmış bir migration bekleyen olarak yakalanır', () => {
    // 0002 atlanıp 0003 uygulanmışsa defter "dolu" görünür ama kayma vardır.
    expect(
      diffMigrations(['0001_a.sql', '0002_b.sql', '0003_c.sql'], ['0001_a.sql', '0003_c.sql']),
    ).toEqual({ pending: ['0002_b.sql'], unknown: [] });
  });

  it('gerçek migration klasörü kendi kendisiyle karşılaştırıldığında temizdir', () => {
    const files = readdirSync(migrationsDir())
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    expect(diffMigrations(files, files)).toEqual({ pending: [], unknown: [] });
  });
});
