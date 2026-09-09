import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Kiracıdan bağımsız çalışma politikası. Min app sürümü ve kill switch burada
 * yaşar; tenant.settings ayrı, şirket-içi tercih içindir.
 */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: boolean('id').primaryKey().default(true),
    schemaVersion: integer('schema_version').notNull().default(1),
    minSupportedAppVersion: text('min_supported_app_version').notNull().default('0.0.0'),
    killGps: boolean('kill_gps').notNull().default(false),
    killOtp: boolean('kill_otp').notNull().default(false),
    killRealtime: boolean('kill_realtime').notNull().default(false),
    flags: jsonb('flags')
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('platform_settings_read', {
      as: 'permissive',
      for: 'select',
      to: ['servisapp_api', 'servisapp_worker'],
      using: sql`true`,
    }),
  ],
).enableRLS();
