/**
 * Migration'lar daima doğrudan bağlantıyla (pooler değil) uygulanır.
 *   pnpm db:migrate
 */
import { applyMigrations } from '../migrate-files.js';

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL tanımlı değil');

await applyMigrations(url);
console.log('✓ migration tamam');
