import type { VehicleBroadcast } from '@servisapp/contracts';

export const TRACKING_ENDED = 'TRIP_TRACKING_ENDED';

export interface RealtimeTransport {
  publishVehicle(tripId: string, payload: VehicleBroadcast): void;
  publishEnded(tripId: string): void;
}

export class MemoryRealtimeTransport implements RealtimeTransport {
  readonly vehicles: Array<{ tripId: string; payload: VehicleBroadcast }> = [];
  readonly ended: string[] = [];
  private readonly viewers = new Map<string, Set<string>>();

  publishVehicle(tripId: string, payload: VehicleBroadcast): void {
    this.vehicles.push({ tripId, payload });
  }

  publishEnded(tripId: string): void {
    this.ended.push(tripId);
    this.viewers.delete(tripId);
  }

  rememberViewer(tripId: string, membershipId: string): void {
    const set = this.viewers.get(tripId) ?? new Set<string>();
    set.add(membershipId);
    this.viewers.set(tripId, set);
  }

  dropViewer(tripId: string, membershipId: string): void {
    this.viewers.get(tripId)?.delete(membershipId);
  }

  viewerCount(tripId: string): number {
    return this.viewers.get(tripId)?.size ?? 0;
  }

  vehicleBroadcasts(tripId?: string): Array<{ tripId: string; payload: VehicleBroadcast }> {
    if (!tripId) return [...this.vehicles];
    return this.vehicles.filter((item) => item.tripId === tripId);
  }

  endedTripIds(): string[] {
    return [...this.ended];
  }

  reset(): void {
    this.vehicles.length = 0;
    this.ended.length = 0;
    this.viewers.clear();
  }
}
