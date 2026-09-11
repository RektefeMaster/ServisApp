import type { MembershipRole, SessionMembership, SessionSnapshot } from '@servisapp/contracts';
import { forbidden } from '../http-error.js';

export interface AuthContext {
  authUserId: string;
  identityId: string;
  fullName: string;
  phone: string;
  memberships: SessionMembership[];
  membership: SessionMembership | null;
}

export function hasRole(auth: AuthContext, role: MembershipRole): boolean {
  return auth.membership?.roles.includes(role) === true;
}

export function activeMembershipOf(
  snapshot: SessionSnapshot,
  tenantId: string | undefined,
): SessionMembership | null {
  const active = snapshot.memberships.filter((item) => item.status === 'ACTIVE');
  if (tenantId) {
    return active.find((item) => item.tenantId === tenantId) ?? null;
  }
  return active.length === 1 ? (active[0] ?? null) : null;
}

export function requireTenantId(auth: AuthContext | undefined): string {
  const id = auth?.membership?.tenantId;
  if (!id) throw forbidden('Bu şirkete erişiminiz yok');
  return id;
}

export function snapshotToAuth(
  authUserId: string,
  snapshot: SessionSnapshot,
  tenantId: string | undefined,
): AuthContext {
  return {
    authUserId,
    identityId: snapshot.identityId,
    fullName: snapshot.fullName,
    phone: snapshot.phone,
    memberships: snapshot.memberships,
    membership: activeMembershipOf(snapshot, tenantId),
  };
}
