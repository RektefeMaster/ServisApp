import { sql } from 'drizzle-orm';
import { customType, pgPolicy, unique, type ExtraConfigColumn } from 'drizzle-orm/pg-core';

/** HMAC ve ciphertext ikili veri olarak durur; metin olarak saklamak yanlışlıkla log'a düşürür. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Her operasyon tablosunun RLS politikası aynıdır: satır, istek bağlamındaki
 * tenant'a ait değilse ne okunur ne yazılır. `app.tenant_id` boşsa
 * `app_tenant_id()` hata fırlatır — unutulan bağlam sessizce veri sızdırmaz.
 */
export function tenantIsolation(table: string) {
  return pgPolicy(`${table}_tenant_isolation`, {
    as: 'permissive',
    for: 'all',
    to: ['servisapp_api', 'servisapp_worker'],
    using: sql`tenant_id = (select app_tenant_id())`,
    withCheck: sql`tenant_id = (select app_tenant_id())`,
  });
}

/** Bileşik FK hedefi: başka tenant'ın satırına bağlamak DB seviyesinde imkânsız. */
export function tenantRowUnique(table: string, tenantId: ExtraConfigColumn, id: ExtraConfigColumn) {
  return unique(`${table}_tenant_row`).on(tenantId, id);
}
