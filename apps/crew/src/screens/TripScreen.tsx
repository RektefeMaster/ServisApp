import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TripDetail, TripStudentView } from '@servisapp/contracts';
import {
  applyOptimistic,
  asStudentState,
  crewActionsForStudent,
  exhaustive,
  isUndoableStudentAction,
  reconcileStudentFromServer,
  tripFocus,
  tripGate,
  UNDO_WINDOW_MS,
  type ActorRole,
  type CrewStudent,
  type CrewTripView,
  type OutboxItem,
  type StudentAction,
  type StudentState,
  type TripGate,
} from '@servisapp/domain';
import { colors, space } from '@servisapp/ui';
import {
  ApiError,
  ackCriticalAlert,
  completeTrip,
  getTrip,
  postUndo,
  recordVehicleCheck,
  reportIncident,
  startTrip,
  verifyDeliveryOtp,
  type CrewSession,
} from '../api/client';
import { persistLastTripId } from '../auth';
import { actionLabel, initials, studentStateLabel } from '../format';
import { useTripGps } from '../gps';
import {
  dropPendingFor,
  enqueueCommand,
  flushOutbox,
  hasOpenCommands,
  listOutbox,
  pendingConflicts,
  pendingRejected,
  removeOutbox,
} from '../outbox';

function asCrewTrip(detail: TripDetail): CrewTripView {
  return {
    segment: detail.segment,
    state: detail.state,
    checks: detail.checks,
    stops: detail.stops,
    students: detail.students.map(toCrewStudent),
  };
}

function toCrewStudent(row: TripStudentView): CrewStudent {
  return {
    id: row.id,
    studentId: row.studentId,
    fullName: row.fullName,
    state: row.state,
    stateSeq: row.stateSeq,
    deliveryTarget: row.deliveryTarget,
    deliveryVerified: row.deliveryVerified,
    handoverPolicy: row.handoverPolicy,
    expectedStopId: row.expectedStopId,
    needsReview: row.needsReview,
  };
}

function preferredReceiverId(student: TripStudentView): string | undefined {
  if (student.deliveryTarget === 'SCHOOL') return undefined;
  if (student.handoverPolicy !== 'GUARDIAN_REQUIRED') return undefined;
  // Tek yetkili varsa attestation net; birden fazlaysa seçim zorunlu.
  if (student.receivers.length === 1) return student.receivers[0]?.membershipId;
  return undefined;
}

function needsReceiverPick(student: TripStudentView, action: StudentAction): boolean {
  if (
    action !== 'DELIVER' &&
    action !== 'RETURN_HOME' &&
    action !== 'RESOLVE_DELIVERED_LATE'
  ) {
    return false;
  }
  if (student.deliveryTarget === 'SCHOOL') return false;
  if (student.handoverPolicy !== 'GUARDIAN_REQUIRED') return false;
  return student.receivers.length > 1;
}

function actorRoleOf(roles: CrewSession['roles']): ActorRole {
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('ATTENDANT')) return 'ATTENDANT';
  return 'DRIVER';
}

function gateButtonLabel(gate: TripGate): string | null {
  switch (gate.kind) {
    case 'VEHICLE_CHECK':
      return gate.phase === 'BEFORE' ? 'Araç boş — sefer öncesi' : 'Araç boş — sefer sonu';
    case 'START':
      return 'Seferi başlat';
    case 'COMPLETE':
      return 'Seferi kapat';
    case 'OPERATE':
    case 'DONE':
      return null;
    default: {
      const unexpected: never = gate;
      return exhaustive(unexpected, 'gateButtonLabel');
    }
  }
}

type LastTap = {
  clientEventId: string;
  tripStudentId: string;
  action: StudentAction;
  at: number;
  prevState: StudentState;
  prevStateSeq: number;
};

function lastTapStorageKey(tripId: string): string {
  return `crew.lastTap.${tripId}`;
}

function parseLastTap(raw: string | null): LastTap | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastTap>;
    if (
      typeof parsed.clientEventId !== 'string' ||
      typeof parsed.tripStudentId !== 'string' ||
      typeof parsed.action !== 'string' ||
      typeof parsed.at !== 'number' ||
      typeof parsed.prevState !== 'string' ||
      typeof parsed.prevStateSeq !== 'number'
    ) {
      return null;
    }
    if (!isUndoableStudentAction(parsed.action)) return null;
    if (Date.now() - parsed.at > UNDO_WINDOW_MS) return null;
    const prevState = asStudentState(parsed.prevState);
    if (!prevState) return null;
    return {
      clientEventId: parsed.clientEventId,
      tripStudentId: parsed.tripStudentId,
      action: parsed.action,
      at: parsed.at,
      prevState,
      prevStateSeq: parsed.prevStateSeq,
    };
  } catch {
    return null;
  }
}

async function persistLastTap(tripId: string, tap: LastTap | null): Promise<void> {
  const key = lastTapStorageKey(tripId);
  if (!tap) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await AsyncStorage.setItem(key, JSON.stringify(tap));
}

async function openNavigation(lat: number, lng: number, label: string): Promise<void> {
  const encoded = encodeURIComponent(label);
  const native =
    Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}&q=${encoded}` : `google.navigation:q=${lat},${lng}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  try {
    const supported = await Linking.canOpenURL(native);
    await Linking.openURL(supported ? native : web);
  } catch {
    await Linking.openURL(web);
  }
}

export function TripScreen({
  session,
  tripId,
  onBack,
  onSessionInvalid,
}: {
  session: CrewSession;
  tripId: string;
  onBack: () => void;
  onSessionInvalid: () => void;
}) {
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [overlay, setOverlay] = useState<'list' | 'incident' | 'otp' | 'receiver' | 'none'>('none');
  const [pendingReceiverAction, setPendingReceiverAction] = useState<{
    student: TripStudentView;
    action: StudentAction;
  } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [incidentBody, setIncidentBody] = useState('');
  const [conflict, setConflict] = useState<OutboxItem | null>(null);
  const [focusStudentId, setFocusStudentId] = useState<string | null>(null);
  const [queueTick, setQueueTick] = useState(0);
  const [lastTap, setLastTap] = useState<LastTap | null>(null);
  const actionLock = useRef(false);
  const detailRef = useRef<TripDetail | null>(null);
  detailRef.current = detail;
  const role = actorRoleOf(session.roles);
  const gps = useTripGps(session, detail);

  function bumpQueue(): void {
    setQueueTick((value) => value + 1);
  }

  function failFrom(caught: unknown, fallback: string): void {
    if (caught instanceof ApiError && caught.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(caught instanceof ApiError ? caught.message : fallback);
  }

  const reload = useCallback(async () => {
    const next = await getTrip(session, tripId);
    setDetail(next);
    await persistLastTripId(tripId);
    const open = pendingConflicts().find((item) => item.tripId === tripId);
    if (open) setConflict(open);
    bumpQueue();
  }, [session, tripId]);

  useEffect(() => {
    void reload().catch((caught: unknown) => {
      failFrom(caught, 'Sefer yüklenemedi');
    });
  }, [reload]);

  useEffect(() => {
    void AsyncStorage.getItem(lastTapStorageKey(tripId)).then((raw) => {
      const parsed = parseLastTap(raw);
      setLastTap(parsed);
      if (!parsed) void AsyncStorage.removeItem(lastTapStorageKey(tripId));
    });
  }, [tripId]);

  const crew = useMemo(() => (detail ? asCrewTrip(detail) : null), [detail]);
  const focus = crew ? tripFocus(crew) : null;
  const gate = crew ? tripGate(crew) : null;
  const queueOpen = queueTick >= 0 && hasOpenCommands(tripId);

  const activeStudent = useMemo(() => {
    if (!detail || !focus) return null;
    const pending = focus.pendingAtStop;
    const selected = focusStudentId
      ? (pending.find((row) => row.id === focusStudentId) ?? null)
      : null;
    const chosen = selected ?? focus.nextStudent;
    if (!chosen) return null;
    return detail.students.find((row) => row.id === chosen.id) ?? null;
  }, [detail, focus, focusStudentId]);

  const actions =
    activeStudent && crew
      ? crewActionsForStudent(
          toCrewStudent(activeStudent),
          crew.state,
          role,
          // Butonları göstermek için geçici alıcı; asıl seçim queueAction'da.
          preferredReceiverId(activeStudent) ?? activeStudent.receivers[0]?.membershipId,
        )
      : [];

  async function syncQueue(): Promise<void> {
    const found = await flushOutbox(session);
    bumpQueue();
    setOffline(false);
    const mineConflict =
      found.conflicts.find((item) => item.tripId === tripId) ??
      pendingConflicts().find((item) => item.tripId === tripId);
    if (mineConflict) setConflict(mineConflict);

    const mineRejected =
      found.rejected.find((item) => item.tripId === tripId) ??
      pendingRejected().find((item) => item.tripId === tripId);
    if (mineRejected) {
      const current = detailRef.current;
      const student = current?.students.find((row) => row.id === mineRejected.tripStudentId);
      if (current && student && mineRejected.conflictState && mineRejected.conflictStateSeq !== undefined) {
        const patched = reconcileStudentFromServer(
          toCrewStudent(student),
          { state: mineRejected.conflictState, stateSeq: mineRejected.conflictStateSeq },
          false,
        );
        setDetail({
          ...current,
          students: current.students.map((row) =>
            row.id === student.id
              ? { ...row, state: patched.state, stateSeq: patched.stateSeq }
              : row,
          ),
        });
      }
      setError(
        mineRejected.rejectReason === 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE'
          ? 'Farklı adres — velinin kodunu gir'
          : mineRejected.rejectReason === 'GUARDIAN_RECEIVER_REQUIRED'
            ? 'Teslim alan yetkili veli seçilmeli'
            : mineRejected.rejectReason === 'CRITICAL_CHANGE_UNACKED'
              ? 'Kritik değişiklik: onaylamadan komut yok'
              : 'Bu işlem sunucuda reddedildi',
      );
      await dropPendingFor(mineRejected.tripStudentId);
      await removeOutbox(mineRejected.clientEventId);
      bumpQueue();
    }

    try {
      await reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setOffline(true);
    }
  }

  async function queueAction(student: TripStudentView, action: StudentAction): Promise<void> {
    if (needsReceiverPick(student, action)) {
      setPendingReceiverAction({ student, action });
      setOverlay('receiver');
      return;
    }
    await queueActionWithReceiver(student, action, preferredReceiverId(student));
  }

  async function queueActionWithReceiver(
    student: TripStudentView,
    action: StudentAction,
    receiverMembershipId: string | undefined,
  ): Promise<void> {
    const current = detailRef.current;
    if (!current || actionLock.current) return;
    actionLock.current = true;
    setError(null);
    try {
      const live = current.students.find((row) => row.id === student.id) ?? student;
      if (
        (action === 'DELIVER' ||
          action === 'RETURN_HOME' ||
          action === 'RESOLVE_DELIVERED_LATE') &&
        live.deliveryTarget !== 'SCHOOL' &&
        live.handoverPolicy === 'GUARDIAN_REQUIRED' &&
        !receiverMembershipId
      ) {
        setError('Teslim alan yetkili veli tanımlı değil');
        return;
      }
      const optimistic = applyOptimistic(
        toCrewStudent(live),
        action,
        current.state,
        role,
        receiverMembershipId,
      );
      if (!optimistic.ok) {
        setError(
          optimistic.reason === 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE'
            ? 'Farklı adres — velinin kodunu gir'
            : optimistic.reason === 'GUARDIAN_RECEIVER_REQUIRED'
              ? 'Teslim alan yetkili veli seçilmeli'
              : 'Bu işlem şimdi yapılamaz',
        );
        if (optimistic.reason === 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE') {
          setOverlay('otp');
        }
        return;
      }
      setDetail({
        ...current,
        students: current.students.map((row) =>
          row.id === live.id
            ? { ...row, state: optimistic.student.state, stateSeq: optimistic.student.stateSeq }
            : row,
        ),
      });
      await enqueueCommand({
        clientEventId: randomUUID(),
        tripId,
        tripStudentId: live.id,
        action,
        expectedStateSeq: live.stateSeq,
        occurredAtDevice: new Date().toISOString().replace('Z', '+00:00'),
        ...(receiverMembershipId ? { receiverMembershipId } : {}),
      }).then((item) => {
        const tap: LastTap = {
          clientEventId: item.clientEventId,
          tripStudentId: live.id,
          action,
          at: Date.now(),
          prevState: live.state,
          prevStateSeq: live.stateSeq,
        };
        setLastTap(tap);
        void persistLastTap(tripId, tap);
        return item;
      });
      bumpQueue();
      try {
        await syncQueue();
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'offline') {
          setOffline(true);
          return;
        }
        failFrom(caught, 'Senkron başarısız');
      }
    } catch (caught) {
      failFrom(caught, 'Komut kuyruğa alınamadı');
      try {
        await reload();
      } catch (reloadCaught) {
        failFrom(reloadCaught, 'Sefer yüklenemedi');
      }
    } finally {
      actionLock.current = false;
    }
  }

  async function undoLast(): Promise<void> {
    if (!lastTap || Date.now() - lastTap.at > UNDO_WINDOW_MS) return;
    if (actionLock.current) return;
    actionLock.current = true;
    setError(null);
    try {
      const queued = listOutbox().find((item) => item.clientEventId === lastTap.clientEventId);
      if (queued?.status === 'PENDING') {
        const current = detailRef.current;
        if (current) {
          setDetail({
            ...current,
            students: current.students.map((row) =>
              row.id === lastTap.tripStudentId
                ? { ...row, state: lastTap.prevState, stateSeq: lastTap.prevStateSeq }
                : row,
            ),
          });
        }
        await removeOutbox(lastTap.clientEventId);
        setLastTap(null);
        await persistLastTap(tripId, null);
        bumpQueue();
        try {
          await reload();
        } catch (caught) {
          if (caught instanceof ApiError && caught.code === 'offline') {
            setOffline(true);
            return;
          }
          failFrom(caught, 'Sefer yüklenemedi');
        }
        return;
      }
      if (queued?.status === 'IN_FLIGHT') {
        setError('Komut hâlâ gönderiliyor; bitince geri al');
        return;
      }
      const result = await postUndo(session, tripId, {
        clientEventId: randomUUID(),
        targetClientEventId: lastTap.clientEventId,
        tripStudentId: lastTap.tripStudentId,
      });
      if (result.status === 'REJECTED') {
        setError('Bu işlem geri alınamaz');
      } else if (result.status === 'PENDING') {
        setError('İşlem henüz işlenmedi; işaretlenince geri alınacak');
      } else if (result.status === 'CONFLICT') {
        setError('Durum değişmiş, sefer yenilendi');
      }
      setLastTap(null);
      await persistLastTap(tripId, null);
      await reload();
    } catch (caught) {
      failFrom(caught, 'Geri alma başarısız');
    } finally {
      actionLock.current = false;
    }
  }

  async function runGate(): Promise<void> {
    if (!gate || hasOpenCommands(tripId)) return;
    setBusy(true);
    setError(null);
    try {
      switch (gate.kind) {
        case 'VEHICLE_CHECK':
          await recordVehicleCheck(session, tripId, gate.phase);
          break;
        case 'START':
          await startTrip(session, tripId);
          break;
        case 'COMPLETE':
          await completeTrip(session, tripId);
          break;
        case 'OPERATE':
        case 'DONE':
          break;
        default: {
          const unexpected: never = gate;
          exhaustive(unexpected, 'runGate');
        }
      }
      await reload();
    } catch (caught) {
      failFrom(caught, 'Sefer işlemi başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function ackConflict(): Promise<void> {
    if (!conflict || !detail) return;
    const student = detail.students.find((row) => row.id === conflict.tripStudentId);
    if (student && conflict.conflictState && conflict.conflictStateSeq !== undefined) {
      const patched = reconcileStudentFromServer(
        toCrewStudent(student),
        { state: conflict.conflictState, stateSeq: conflict.conflictStateSeq },
        true,
      );
      setDetail({
        ...detail,
        students: detail.students.map((row) =>
          row.id === student.id
            ? { ...row, state: patched.state, stateSeq: patched.stateSeq, needsReview: true }
            : row,
        ),
      });
    }
    await dropPendingFor(conflict.tripStudentId);
    await removeOutbox(conflict.clientEventId);
    setConflict(null);
    bumpQueue();
    try {
      await reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      setOffline(true);
    }
  }

  async function sendIncident(): Promise<void> {
    if (incidentBody.trim().length < 3) {
      setError('Sorun açıklaması en az 3 karakter olmalı');
      return;
    }
    setBusy(true);
    try {
      await reportIncident(session, tripId, { body: incidentBody.trim() });
      setIncidentBody('');
      setOverlay('none');
    } catch (caught) {
      failFrom(caught, 'Bildirim gönderilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(): Promise<void> {
    if (!activeStudent || otpCode.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyDeliveryOtp(session, tripId, activeStudent.id, otpCode);
      setOtpCode('');
      setOverlay('none');
      await reload();
    } catch (caught) {
      failFrom(caught, 'Kod doğrulanamadı');
    } finally {
      setBusy(false);
    }
  }

  async function ackAlert(alertId: string): Promise<void> {
    setBusy(true);
    try {
      await ackCriticalAlert(session, tripId, alertId);
      await reload();
    } catch (caught) {
      failFrom(caught, 'Uyarı onaylanamadı');
    } finally {
      setBusy(false);
    }
  }

  const blockingAlert = detail?.pendingAlerts[0] ?? null;

  if (!detail || !crew || !focus || !gate) {
    return (
      <View style={styles.screen}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>← Bugün</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.headlamp} />}
      </View>
    );
  }

  const gateLabel = queueOpen ? 'Kuyruk gönderiliyor…' : gateButtonLabel(gate);
  const conflictState = conflict?.conflictState ? asStudentState(conflict.conflictState) : undefined;

  return (
    <View style={styles.screen}>
      <Pressable onPress={onBack}>
        <Text style={styles.back}>← {detail.plate}</Text>
      </Pressable>
      <View style={styles.led}>
        <Text style={styles.ledEyebrow}>SONRAKI</Text>
        <Text style={styles.ledTitle}>{focus.destinationLabel}</Text>
        <Text style={styles.ledMeta}>
          {focus.remainingExpected} bekleniyor · {focus.remainingOnBoard} araçta
        </Text>
      </View>
      {offline ? <Text style={styles.offline}>Çevrimdışı — işaretler kuyruğa yazılıyor</Text> : null}
      {gps.message ? <Text style={styles.offline}>{gps.message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {activeStudent ? (
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(activeStudent.fullName)}</Text>
          </View>
          <Text style={styles.name}>{activeStudent.fullName}</Text>
          <Text style={styles.stop}>
            {activeStudent.expectedStopLabel ?? focus.currentStop?.addressText}
          </Text>
          {activeStudent.guardianPhone ? (
            <Text style={styles.phone}>{activeStudent.guardianPhone}</Text>
          ) : null}
          <Text style={styles.state}>{studentStateLabel(activeStudent.state)}</Text>
          {activeStudent.deliveryTarget === 'TEMP' && !activeStudent.deliveryVerified ? (
            <>
              <Text style={styles.warn}>Farklı adres — teslim için kod gerekir</Text>
              <Pressable onPress={() => setOverlay('otp')} style={styles.gate}>
                <Text style={styles.gateText}>Kodu gir</Text>
              </Pressable>
            </>
          ) : null}
          {activeStudent.needsReview ? <Text style={styles.warn}>Çakışma: insan onayı gerekli</Text> : null}
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action}
                disabled={busy || Boolean(blockingAlert)}
                onPress={() => void queueAction(activeStudent, action)}
                style={[styles.action, action === 'MARK_NO_SHOW' || action === 'MARK_DELIVERY_FAILED' ? styles.danger : styles.primary]}
              >
                <Text
                  style={[
                    styles.actionText,
                    action === 'MARK_NO_SHOW' || action === 'MARK_DELIVERY_FAILED'
                      ? styles.dangerText
                      : styles.primaryText,
                  ]}
                >
                  {actionLabel(action)}
                </Text>
              </Pressable>
            ))}
          </View>
          {lastTap &&
          lastTap.tripStudentId === activeStudent.id &&
          isUndoableStudentAction(lastTap.action) &&
          Date.now() - lastTap.at < UNDO_WINDOW_MS ? (
            <Pressable disabled={busy || Boolean(blockingAlert)} onPress={() => void undoLast()} style={styles.gate}>
              <Text style={styles.gateText}>Son işlemi geri al</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={styles.empty}>Bu durakta işaretlenecek öğrenci kalmadı.</Text>
      )}
      {gateLabel ? (
        <Pressable disabled={busy || queueOpen} onPress={() => void runGate()} style={styles.gate}>
          <Text style={styles.gateText}>{gateLabel}</Text>
        </Pressable>
      ) : null}
      <View style={styles.tools}>
        <Pressable onPress={() => setOverlay('list')} style={styles.tool}>
          <Text style={styles.toolText}>Liste</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const stop = focus.currentStop;
            if (stop) void openNavigation(stop.lat, stop.lng, stop.label);
          }}
          style={styles.tool}
        >
          <Text style={styles.toolText}>Navigasyon</Text>
        </Pressable>
        <Pressable onPress={() => setOverlay('incident')} style={styles.tool}>
          <Text style={styles.toolText}>Sorun bildir</Text>
        </Pressable>
      </View>

      <Modal visible={overlay === 'list'} animationType="slide">
        <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingTop: 56 }}>
          <Pressable onPress={() => setOverlay('none')}>
            <Text style={styles.back}>← Sefer</Text>
          </Pressable>
          {detail.students.map((row) => {
            const pending = focus.pendingAtStop.some((item) => item.id === row.id);
            return (
              <Pressable
                key={row.id}
                disabled={!pending}
                onPress={() => {
                  setFocusStudentId(row.id);
                  setOverlay('none');
                }}
                style={styles.row}
              >
                <Text style={styles.rowName}>{row.fullName}</Text>
                <Text style={styles.rowMeta}>
                  {studentStateLabel(row.state)} · {row.expectedStopLabel ?? 'Durak yok'}
                  {pending ? ' · işaretle' : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>

      <Modal visible={overlay === 'incident'} animationType="slide">
        <View style={[styles.screen, { padding: space.lg, paddingTop: 56 }]}>
          <Pressable onPress={() => setOverlay('none')}>
            <Text style={styles.back}>← Sefer</Text>
          </Pressable>
          <Text style={styles.name}>Sorun bildir</Text>
          <TextInput
            multiline
            placeholder="Ne oldu?"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={incidentBody}
            onChangeText={setIncidentBody}
          />
          <Pressable
            disabled={busy || incidentBody.trim().length < 3}
            onPress={() => void sendIncident()}
            style={styles.gate}
          >
            <Text style={styles.gateText}>Gönder</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={overlay === 'otp'} animationType="slide">
        <View style={[styles.screen, { padding: space.lg, paddingTop: 56 }]}>
          <Pressable onPress={() => setOverlay('none')}>
            <Text style={styles.back}>← Sefer</Text>
          </Pressable>
          <Text style={styles.name}>Teslim kodu</Text>
          <Text style={styles.stop}>Kod velide görünür; bu cihaza asla gelmez.</Text>
          <TextInput
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor={colors.muted}
            style={[styles.input, { minHeight: 56, textAlign: 'center', fontSize: 28, letterSpacing: 8 }]}
            value={otpCode}
            onChangeText={setOtpCode}
          />
          <Pressable disabled={busy || otpCode.length !== 6} onPress={() => void submitOtp()} style={styles.gate}>
            <Text style={styles.gateText}>Doğrula</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={overlay === 'receiver'} animationType="slide">
        <ScrollView style={styles.screen} contentContainerStyle={{ padding: space.lg, paddingTop: 56 }}>
          <Pressable
            onPress={() => {
              setPendingReceiverAction(null);
              setOverlay('none');
            }}
          >
            <Text style={styles.back}>← Sefer</Text>
          </Pressable>
          <Text style={styles.name}>Teslim alan kişi</Text>
          <Text style={styles.stop}>Kapıdaki yetkili velini seç.</Text>
          {(pendingReceiverAction?.student.receivers ?? []).map((receiver) => (
            <Pressable
              key={receiver.membershipId}
              disabled={busy}
              onPress={() => {
                const pending = pendingReceiverAction;
                setPendingReceiverAction(null);
                setOverlay('none');
                if (pending) {
                  void queueActionWithReceiver(
                    pending.student,
                    pending.action,
                    receiver.membershipId,
                  );
                }
              }}
              style={styles.row}
            >
              <Text style={styles.rowName}>{receiver.fullName}</Text>
              <Text style={styles.rowMeta}>{receiver.relation}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Modal>

      <Modal visible={blockingAlert !== null} animationType="fade" transparent>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.warn}>KRİTİK DEĞİŞİKLİK</Text>
            <Text style={styles.stop}>{blockingAlert?.body}</Text>
            <Pressable
              disabled={busy}
              onPress={() => {
                if (blockingAlert) void ackAlert(blockingAlert.id);
              }}
              style={styles.gate}
            >
              <Text style={styles.gateText}>Okudum, anladım</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={conflict !== null} animationType="fade" transparent>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.warn}>ÇAKIŞMA</Text>
            <Text style={styles.name}>
              {detail.students.find((row) => row.id === conflict?.tripStudentId)?.fullName ?? 'Öğrenci'}
            </Text>
            <Text style={styles.stop}>
              İki cihaz aynı anda işaretledi. Sunucudaki durum:{' '}
              {conflictState ? studentStateLabel(conflictState) : 'bilinmiyor'}
            </Text>
            <Pressable onPress={() => void ackConflict()} style={styles.gate}>
              <Text style={styles.gateText}>Anladım, yeniden işaretlerim</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.asphalt, padding: space.md, paddingTop: 52 },
  back: { color: colors.headlamp, fontSize: 16, marginBottom: space.sm },
  led: {
    backgroundColor: '#1A1608',
    borderColor: colors.headlamp,
    borderWidth: 1,
    borderRadius: 8,
    padding: space.md,
    marginBottom: space.md,
  },
  ledEyebrow: { color: colors.headlamp, letterSpacing: 3, fontSize: 11, fontWeight: '800' },
  ledTitle: { color: colors.headlamp, fontSize: 26, fontWeight: '800', marginTop: 4 },
  ledMeta: { color: '#C4B57A', marginTop: 4 },
  offline: { color: colors.headlamp, marginBottom: space.sm },
  error: { color: colors.danger, marginBottom: space.sm },
  card: { backgroundColor: colors.steel, borderRadius: 20, padding: space.lg, alignItems: 'center' },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.asphalt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  avatarText: { color: colors.headlamp, fontSize: 32, fontWeight: '800' },
  name: { color: colors.paper, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  stop: { color: colors.muted, fontSize: 16, marginTop: 6, textAlign: 'center' },
  phone: { color: colors.paper, fontSize: 18, marginTop: 8 },
  state: { color: colors.headlamp, marginTop: 8, fontWeight: '700' },
  warn: { color: colors.danger, marginTop: 8, textAlign: 'center', fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  action: { flexGrow: 1, minHeight: 64, minWidth: '40%', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.headlamp },
  danger: { backgroundColor: '#3A1515' },
  actionText: { fontSize: 20, fontWeight: '800' },
  primaryText: { color: colors.asphalt },
  dangerText: { color: colors.danger },
  empty: { color: colors.muted, fontSize: 16, textAlign: 'center', marginVertical: space.lg },
  gate: {
    backgroundColor: colors.paper,
    borderRadius: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
    paddingHorizontal: space.md,
  },
  gateText: { color: colors.asphalt, fontSize: 18, fontWeight: '800' },
  tools: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  tool: { flex: 1, padding: space.md, backgroundColor: colors.steel, borderRadius: 12, alignItems: 'center' },
  toolText: { color: colors.paper, fontWeight: '700' },
  row: { backgroundColor: colors.steel, borderRadius: 12, padding: space.md, marginBottom: space.sm },
  rowName: { color: colors.paper, fontSize: 18, fontWeight: '700' },
  rowMeta: { color: colors.muted, marginTop: 4 },
  input: {
    backgroundColor: colors.steel,
    color: colors.paper,
    borderRadius: 12,
    minHeight: 120,
    padding: space.md,
    marginTop: space.md,
    textAlignVertical: 'top',
  },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: space.lg,
  },
  modalCard: { backgroundColor: colors.steel, borderRadius: 20, padding: space.lg },
});
