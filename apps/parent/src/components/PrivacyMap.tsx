import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ParentTrackingView, VehicleBroadcast } from '@servisapp/contracts';
import { interpolateLngLat, type LatLng } from '@servisapp/domain';
import { AppText, colors, radius, space } from '@servisapp/ui';

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
  const targetLat = vehicle?.vehicleLat ?? null;
  const targetLng = vehicle?.vehicleLng ?? null;

  useEffect(() => {
    if (targetLat === null || targetLng === null) {
      fromRef.current = null;
      setShown(null);
      return;
    }
    const target: LatLng = { lat: targetLat, lng: targetLng };
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
  }, [targetLat, targetLng]);

  const points: LatLng[] = [];
  if (shown) points.push(shown);
  if (ownStop) points.push({ lat: ownStop.lat, lng: ownStop.lng });
  if (points.length === 0) {
    return null;
  }
  const bounds = pad(points);
  const vehiclePos = shown ? toPercent(shown, bounds) : null;
  const stopPos = ownStop ? toPercent({ lat: ownStop.lat, lng: ownStop.lng }, bounds) : null;

  return (
    <View
      style={styles.map}
      accessibilityLabel="Şematik konum görünümü: yalnız araç ve senin durağın"
    >
      <View style={styles.grid} accessible={false}>
        {[20, 40, 60, 80].map((offset) => (
          <View key={`h${offset}`} style={[styles.gridHorizontal, { top: `${offset}%` }]} />
        ))}
        {[20, 40, 60, 80].map((offset) => (
          <View key={`v${offset}`} style={[styles.gridVertical, { left: `${offset}%` }]} />
        ))}
      </View>
      <View style={styles.mapHeading}>
        <AppText preset="caption">KONUM GÖRÜNÜMÜ</AppText>
        <AppText preset="caption">Şematik</AppText>
      </View>
      {stopPos ? (
        <View style={[styles.marker, { left: `${stopPos.left}%`, top: `${stopPos.top}%` }]}>
          <View style={styles.stopPin}>
            <View style={styles.stopCenter} />
          </View>
        </View>
      ) : null}
      {vehiclePos ? (
        <View style={[styles.marker, { left: `${vehiclePos.left}%`, top: `${vehiclePos.top}%` }]}>
          <View style={styles.vehiclePin}>
            <View style={styles.vehicleCenter} />
          </View>
        </View>
      ) : null}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={styles.legendVehicle} />
          <AppText preset="caption">Servis</AppText>
        </View>
        <View style={[styles.legendItem, { flex: 1 }]}>
          <View style={styles.legendStop} />
          <AppText preset="caption" numberOfLines={2} style={{ flexShrink: 1 }}>
            {ownStop?.label ?? 'Durağın'}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapHeading: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.line,
  },
  gridVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.line },
  stopPin: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.rail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopCenter: { width: 8, height: 8, backgroundColor: colors.rail, borderRadius: 2 },
  vehiclePin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.railSoft,
    borderWidth: 1,
    borderColor: colors.rail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleCenter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.rail,
    borderWidth: 3,
    borderColor: colors.paper,
  },
  legend: {
    position: 'absolute',
    bottom: space.sm,
    left: space.sm,
    right: space.sm,
    padding: space.sm,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendVehicle: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rail },
  legendStop: { width: 8, height: 8, borderRadius: 2, borderWidth: 1.5, borderColor: colors.rail },
  map: {
    height: 280,
    borderRadius: radius.lg,
    backgroundColor: colors.railSoft,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    marginBottom: space.md,
  },
  grid: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 1,
    borderColor: colors.line,
    opacity: 0.6,
  },
  marker: { position: 'absolute', marginLeft: -16, marginTop: -16 },
  caption: {
    position: 'absolute',
    bottom: space.sm,
    left: space.sm,
    right: space.sm,
  },
});
