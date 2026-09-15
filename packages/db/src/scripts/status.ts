/**
 * Dağıtılmış veritabanının migration seviyesini bildirir.
 *   pnpm db:status
 *
 * Kayma sessizdir: kod 0035'i beklerken veritabanı 0016'da durabilir ve bunu
 * ancak bir uç nokta 500 verdiğinde fark edersiniz. Bu script farkı deploy
 * öncesinde, tek bakışta gösterir ve bekleyen migration varsa 1 ile çıkar —
 * böylece CI'da da kapı olarak kullanılabilir.
 */
import { readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { diffMigrations, migrationsDir } from '../migrate-files.js';

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL tanımlı değil');

const files = (await readdir(migrationsDir())).filter((name) => name.endsWith('.sql')).sort();
if (files.length === 0) throw new Error('Migration bulunamadı');

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  // Hiç migration uygulanmamış bir veritabanında defter tablosu da yoktur;
  // bu bir hata değil, "her şey bekliyor" durumudur.
  const [ledgerExists] = await sql<{ present: boolean }[]>`
    select to_regclass('public.schema_migrations') is not null as present
  `;
  const ledger = ledgerExists?.present
    ? await sql<{ filename: string; applied_at: Date }[]>`
        select filename, applied_at from schema_migrations order by filename
      `
    : [];
  const { pending, unknown } = diffMigrations(
    files,
    ledger.map((row) => row.filename),
  );

  console.log(`veritabanı : ${ledger.length}/${files.length} migration uygulanmış`);
  const last = ledger.at(-1);
  if (last) {
    console.log(`son uygulanan: ${last.filename} · ${last.applied_at.toISOString()}`);
  }

  if (unknown.length > 0) {
    // Dosyası silinmiş ya da yeniden adlandırılmış bir migration: sıra bozulmuş
    // demektir, deploy etmeden önce elle bakılmalı.
    console.error(`\n⚠ defterde olup dosyada olmayan (${unknown.length}):`);
    for (const name of unknown) console.error(`  ${name}`);
  }

  if (pending.length === 0) {
    console.log('\n✓ bekleyen migration yok');
  } else {
    console.error(`\n✗ bekleyen migration (${pending.length}):`);
    for (const name of pending) console.error(`  ${name}`);
    console.error("\nUygulamak için: pnpm db:migrate (ya da API deploy'u release_command ile)");
  }

  if (pending.length > 0 || unknown.length > 0) process.exitCode = 1;
} finally {
  await sql.end();
}
