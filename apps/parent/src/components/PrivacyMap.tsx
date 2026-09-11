import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ParentTrackingView, VehicleBroadcast } from '@servisapp/contracts';
import { interpolateLngLat, type LatLng } from '@servisapp/domain';
import { colors, space } from '@servisapp/ui';

type OwnStop = NonNullable<ParentTrackingView['ownStop']>;

function pad(points: LatLng[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPad = Math.max(0.004, (maxLat - minLat) * 0.35);
  const lngPad = Math.max(0.004, (maxLng - minLng) * 0.35);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

function toPercent(
  point: LatLng,
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): { left: number; top: number } {
  const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
  const lngSpan = Math.max(0.0001, bounds.maxLng - bounds.minLng);
  return {
    left: ((point.lng - bounds.minLng) / lngSpan) * 100,
    top: (1 - (point.lat - bounds.minLat) / latSpan) * 100,
  };
}

export function PrivacyMap({
  vehicle,
  ownStop,
}: {
  vehicle: VehicleBroadcast | null;
  ownStop: OwnStop | null;
}) {
  const fromRef = useRef<LatLng | null>(null);
  const [shown, setShown] = useState<LatLng | null>(null);
  const target: LatLng | null = vehicle
    ? { lat: vehicle.vehicleLat, lng: vehicle.vehicleLng }
    : null;

  useEffect(() => {
    if (!target) {
      fromRef.current = null;
      setShown(null);
      return;
    }
    const origin = fromRef.current ?? target;
    const started = Date.now();
    let frame = 0;
    const tick = (): void => {
      const t = Math.min(1, (Date.now() - started) / 2400);
      const next = interpolateLngLat(origin, target, t);
      fromRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target?.lat, target?.lng]);

  const points: LatLng[] = [];
  if (shown) points.push(shown);
  if (ownStop) points.push({ lat: ownStop.lat, lng: ownStop.lng });
  if (points.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Haritada gösterilecek durak yok</Text>
      </View>
    );
  }
  const bounds = pad(points);
  const vehiclePos = shown ? toPercent(shown, bounds) : null;
  const stopPos = ownStop ? toPercent({ lat: ownStop.lat, lng: ownStop.lng }, bounds) : null;

  return (
    <View style={styles.map} accessibilityLabel="Canlı harita: yalnız araç ve senin durağın">
      <View style={styles.grid} />
      {stopPos ? (
        <View style={[styles.marker, { left: `${stopPos.left}%`, top: `${stopPos.top}%` }]}>
          <Text style={styles.stopDot}>■</Text>
        </View>
      ) : null}
      {vehiclePos ? (
        <View style={[styles.marker, { left: `${vehiclePos.left}%`, top: `${vehiclePos.top}%` }]}>
          <Text style={styles.busDot}>●</Text>
        </View>
      ) : null}
      {ownStop ? <Text style={styles.caption}>{ownStop.label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 280,
    borderRadius: 20,
    backgroundColor: colors.steel,
    overflow: 'hidden',
    marginBottom: space.md,
  },
  grid: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: '#3A3428',
    opacity: 0.5,
  },
  marker: { position: 'absolute', marginLeft: -8, marginTop: -8 },
  stopDot: { color: colors.paper, fontSize: 16 },
  busDot: { color: colors.headlamp, fontSize: 18 },
  caption: {
    position: 'absolute',
    bottom: space.sm,
    left: space.sm,
    right: space.sm,
    color: colors.muted,
    fontSize: 12,
  },
  empty: {
    height: 160,
    borderRadius: 20,
    backgroundColor: colors.steel,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  emptyText: { color: colors.muted },
});
