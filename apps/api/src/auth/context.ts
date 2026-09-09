import type { MembershipRole, SessionMembership, SessionSnapshot } from '@servisapp/contracts';

export interface AuthContext {
  authUserId: string;
  identityId: string;
  fullName: string;
  memberships: SessionMembership[];
  membership: SessionMembership | null;
}

export function hasRole(auth: AuthContext, role: MembershipRole): boolean {
  return auth.membership?.roles.includes(role) === true;
}

export function snapshotToAuth(
  authUserId: string,
  snapshot: SessionSnapshot,
  tenantId: string | undefined,
): AuthContext {
  const membership = tenantId
    ? (snapshot.memberships.find((item) => item.tenantId === tenantId) ?? null)
    : snapshot.memberships.length === 1
      ? (snapshot.memberships[0] ?? null)
      : null;
  return {
    authUserId,
    identityId: snapshot.identityId,
    fullName: snapshot.fullName,
    memberships: snapshot.memberships,
    membership,
  };
}
