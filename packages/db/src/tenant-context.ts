import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export interface RequestContext {
  tenantId: string;
  membershipId: string | null;
  identityId?: string | null;
  role: string | null;
}

/**
 * Her istek ve her arka plan işi, RLS'in okuduğu tenant bağlamını transaction
 * içinde kurar. `SET LOCAL` parametre kabul etmediği için `set_config(..., true)`
 * kullanılır — üçüncü argüman "yalnız bu transaction" demektir.
 *
 * Bağlam kurulmadan yapılan sorgular RLS tarafından boş sonuç döndürür; bu
 * kasıtlıdır — unutulan bir tenant filtresi sessizce veri sızdırmak yerine
 * görünür biçimde başarısız olur.
 */
export async function withTenant<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`);
    await tx.execute(
      sql`select set_config('app.user_id', ${ctx.identityId ?? ctx.membershipId ?? ''}, true)`,
    );
    await tx.execute(sql`select set_config('app.membership_id', ${ctx.membershipId ?? ''}, true)`);
    await tx.execute(sql`select set_config('app.role', ${ctx.role ?? ''}, true)`);
    return fn(tx as unknown as Database);
  });
}
