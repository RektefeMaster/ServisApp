import type { VehicleBroadcast } from '@servisapp/contracts';

export const TRACKING_ENDED = 'TRIP_TRACKING_ENDED';

/** Test ve son durum için sefer başına tutulan yayın tavanı — üretimde RAM şişmesin. */
export const REALTIME_HISTORY_CAP = 32;

export interface RealtimeTransport {
  publishVehicle(tripId: string, payload: VehicleBroadcast): void;
  publishEnded(tripId: string): void;
}

export class MemoryRealtimeTransport implements RealtimeTransport {
  private readonly history = new Map<string, Array<{ tripId: string; payload: VehicleBroadcast }>>();
  private readonly ended = new Set<string>();
  private readonly viewers = new Map<string, Set<string>>();

  publishVehicle(tripId: string, payload: VehicleBroadcast): void {
    const list = this.history.get(tripId) ?? [];
    list.push({ tripId, payload });
    if (list.length > REALTIME_HISTORY_CAP) {
      list.splice(0, list.length - REALTIME_HISTORY_CAP);
    }
    this.history.set(tripId, list);
  }

  publishEnded(tripId: string): void {
    this.ended.add(tripId);
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
    if (!tripId) {
      return [...this.history.values()].flat();
    }
    return [...(this.history.get(tripId) ?? [])];
  }

  endedTripIds(): string[] {
    return [...this.ended];
  }

  reset(): void {
    this.history.clear();
    this.ended.clear();
    this.viewers.clear();
  }
}
