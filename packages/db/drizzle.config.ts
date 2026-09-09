import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // Şema değişiklikleri daima doğrudan bağlantıyla uygulanır, pooler ile değil.
    url: process.env['MIGRATION_DATABASE_URL'] ?? '',
  },
  strict: true,
  verbose: true,
});
