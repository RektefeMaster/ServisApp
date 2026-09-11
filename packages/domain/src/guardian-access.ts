/**
 * SPEC rev 3.3: tenant_membership ACTIVE yalnız tenant erişimi sağlar;
 * öğrencinin okunabilmesi için aynı tenant altında aktif student_guardian gerekir.
 */
export interface GuardianChildAccessInput {
  membershipStatus: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
  guardianRelationStatus: 'ACTIVE' | 'REVOKED';
  studentEnded: boolean;
}

export function canReadGuardianChild(input: GuardianChildAccessInput): boolean {
  if (input.membershipStatus !== 'ACTIVE') return false;
  if (input.guardianRelationStatus !== 'ACTIVE') return false;
  if (input.studentEnded) return false;
  return true;
}
