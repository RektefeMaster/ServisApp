import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../migrations');
}

/** SQL dosyalarını sırayla, bir kez uygular. İkinci çalıştırma no-op olmalıdır. */
export async function applyMigrations(url: string): Promise<void> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`Migration bulunamadı: ${dir}`);

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    for (const file of files) {
      const [applied] = await sql<{ filename: string }[]>`
        select filename from schema_migrations where filename = ${file}
      `;
      if (applied) continue;
      const body = await readFile(join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        // 0005 hosted defteri kendisi doldurur; ikinci INSERT transaction'ı
        // geri alıp sonraki dosyaları (pg-boss) dışarıda bırakmasın.
        await tx`
          insert into schema_migrations (filename) values (${file})
          on conflict (filename) do nothing
        `;
      });
    }
  } finally {
    await sql.end();
  }
}
