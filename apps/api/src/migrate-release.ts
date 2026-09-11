import { applyMigrations } from '@servisapp/db';

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) {
  process.stderr.write('MIGRATION_DATABASE_URL tanımlı değil\n');
  process.exit(1);
}

await applyMigrations(url);
process.stdout.write('release migration tamam\n');
