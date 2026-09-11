import { namesLikelySame } from '@servisapp/domain';
import { identity, membershipRole, tenantMembership, type Database } from '@servisapp/db';
import { and, eq, sql } from 'drizzle-orm';
import { conflict, HttpError } from '../http-error.js';
import { firstRow, jsonObject } from './sql-result.js';

export interface FoundIdentity {
  id: string;
  fullName: string;
  phone: string;
  authUserId: string | null;
}

export async function findIdentityByPhone(
  tx: Database,
  phone: string,
): Promise<FoundIdentity | null> {
  const result: unknown = await tx.execute(sql`select find_identity_by_phone(${phone}::text) as found`);
  const row = firstRow(result);
  const found = jsonObject(row?.['found']);
  if (!found) return null;
  const id = found['id'];
  const fullName = found['fullName'];
  const foundPhone = found['phone'];
  if (typeof id !== 'string' || typeof fullName !== 'string' || typeof foundPhone !== 'string') {
    return null;
  }
  const auth = found['authUserId'];
  return {
    id,
    fullName,
    phone: foundPhone,
    authUserId: typeof auth === 'string' ? auth : null,
  };
}

export async function ensureIdentityId(
  tx: Database,
  phone: string,
  email: string | null,
  fullName: string,
): Promise<string> {
  const result: unknown = await tx.execute(
    sql`select ensure_identity(${phone}::text, ${email}::text, ${fullName}::text) as id`,
  );
  const row = firstRow(result);
  const id = row?.['id'];
  if (typeof id !== 'string') throw new HttpError(500, 'insert_failed', 'Kimlik kaydedilemedi');
  return id;
}

/** Personel ve veli: aynı şirkette isim eşleşmesi yeter; çapraz kiracı yalnız reuseIdentityId. */
export async function resolveGuardianIdentity(
  tx: Database,
  tenantId: string,
  input: { phone: string; fullName: string; email?: string | null; reuseIdentityId?: string },
): Promise<string> {
  const existing = await findIdentityByPhone(tx, input.phone);
  if (!existing) {
    return ensureIdentityId(tx, input.phone, input.email ?? null, input.fullName);
  }
  const inTenant = await identityBelongsToTenant(tx, tenantId, existing.id);
  const explicit = input.reuseIdentityId === existing.id;
  const sameName = namesLikelySame(existing.fullName, input.fullName);
  // Aynı şirkette isim eşleşmesi yeter. Başka şirketteki kimlik yalnız açık reuse ile bağlanır.
  if ((inTenant && (explicit || sameName)) || (!inTenant && explicit)) {
    return existing.id;
  }
  throw conflict('phone_in_use', 'Bu telefon mevcut bir kişide kullanılıyor');
}

type StaffOrGuardianRole = 'ADMIN' | 'DRIVER' | 'ATTENDANT' | 'GUARDIAN';

export async function identityBelongsToTenant(
  tx: Database,
  tenantId: string,
  identityId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: tenantMembership.id })
    .from(tenantMembership)
    .where(
      and(eq(tenantMembership.tenantId, tenantId), eq(tenantMembership.identityId, identityId)),
    );
  return Boolean(row);
}

export async function attachMembership(
  tx: Database,
  tenantId: string,
  identityId: string,
  role: StaffOrGuardianRole,
): Promise<string> {
  const [existing] = await tx
    .select({
      id: tenantMembership.id,
      status: tenantMembership.status,
    })
    .from(tenantMembership)
    .where(
      and(eq(tenantMembership.tenantId, tenantId), eq(tenantMembership.identityId, identityId)),
    );

  let membershipId: string;
  if (existing) {
    switch (existing.status) {
      case 'ACTIVE':
      case 'INVITED':
        membershipId = existing.id;
        break;
      case 'SUSPENDED':
      case 'REVOKED':
        throw conflict('membership_inactive', 'Bu kişi bu şirkette durdurulmuş veya çıkarılmış');
      default: {
        const unexpected: never = existing.status;
        void unexpected;
        throw new Error('unknown membership status');
      }
    }
  } else {
    const [created] = await tx
      .insert(tenantMembership)
      .values({
        tenantId,
        identityId,
        status: 'INVITED',
      })
      .returning({ id: tenantMembership.id });
    if (!created) throw new HttpError(500, 'insert_failed', 'Üyelik kaydedilemedi');
    membershipId = created.id;
  }

  await tx.insert(membershipRole).values({ tenantId, membershipId, role }).onConflictDoNothing();
  return membershipId;
}

export async function requireIdentityInTenant(
  tx: Database,
  tenantId: string,
  identityId: string,
): Promise<{ id: string; fullName: string; phone: string; authUserId: string | null }> {
  const [row] = await tx
    .select({
      id: identity.id,
      fullName: identity.fullName,
      phone: identity.phoneE164,
      authUserId: identity.authUserId,
    })
    .from(identity)
    .innerJoin(
      tenantMembership,
      and(eq(tenantMembership.identityId, identity.id), eq(tenantMembership.tenantId, tenantId)),
    )
    .where(eq(identity.id, identityId));
  if (!row) throw new HttpError(404, 'not_found', 'Kişi bulunamadı');
  return row;
}
