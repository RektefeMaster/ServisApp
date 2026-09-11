export function hasUsableCoordinates(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export type TripReadyBlock = 'DRIVER_MISSING' | 'ATTENDANT_MISSING' | null;

export function tripReadyCrewBlock(input: {
  driverMembershipId: string | null;
  attendantMembershipId: string | null;
  attendantRequired: boolean;
}): TripReadyBlock {
  if (!input.driverMembershipId) return 'DRIVER_MISSING';
  if (input.attendantRequired && !input.attendantMembershipId) return 'ATTENDANT_MISSING';
  return null;
}
