/**
 * Üç DB rolünü oluşturur (SPEC §3). Şema migration'larından ayrıdır çünkü
 * parolalar ortam değişkeninden gelir ve git'e girmez.
 *
 *   pnpm --filter @servisapp/db bootstrap-roles
 *
 * Tablo yetkileri BİLEREK burada verilmez: her tablo kendi migration'ında
 * ihtiyacı kadar GRANT alır. Default privileges kullanmıyoruz — "her yeni
 * tabloya otomatik UPDATE" tam da engellemek istediğimiz şey.
 */
import postgres from 'postgres';

const SAFE_PASSWORD = /^[A-Za-z0-9+/=_.:-]{16,}$/;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} tanımlı değil`);
  return value;
}

function requirePassword(name: string): string {
  const value = requireEnv(name);
  if (!SAFE_PASSWORD.test(value)) {
    throw new Error(`${name} en az 16 karakter olmalı ve tırnak/ters bölü içermemeli`);
  }
  return value;
}

const ROLES = [
  { name: 'servisapp_api', passwordEnv: 'API_DB_PASSWORD' },
  { name: 'servisapp_worker', passwordEnv: 'WORKER_DB_PASSWORD' },
] as const;

async function main(): Promise<void> {
  const sql = postgres(requireEnv('MIGRATION_DATABASE_URL'), { max: 1 });
  const [databaseRow] = await sql<{ current_database: string }[]>`select current_database()`;
  if (!databaseRow) throw new Error('current_database() sonuç döndürmedi');
  const database = databaseRow.current_database;

  try {
    for (const role of ROLES) {
      const password = requirePassword(role.passwordEnv);
      await sql.unsafe(`
        do $$
        begin
          if not exists (select 1 from pg_roles where rolname = '${role.name}') then
            create role ${role.name} login;
          end if;
        end
        $$;
        alter role ${role.name} with login nosuperuser nocreatedb nocreaterole
          nobypassrls noinherit password '${password}';
        grant connect on database "${database}" to ${role.name};
        grant usage on schema public to ${role.name};
      `);
      console.log(`✓ ${role.name}`);
    }

    const [bypassRow] = await sql<{ count: string }[]>`
      select count(*)::text as count from pg_roles
      where rolname in ('servisapp_api', 'servisapp_worker') and rolbypassrls
    `;
    if (bypassRow?.count !== '0') {
      throw new Error('Bir rol BYPASSRLS ile oluşmuş — RLS ikinci bariyer olmaz');
    }
    console.log('✓ hiçbir uygulama rolünde BYPASSRLS yok');
  } finally {
    await sql.end();
  }
}

await main();
