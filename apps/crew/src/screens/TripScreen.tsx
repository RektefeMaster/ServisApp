import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
  stopWorkload,
  tripFocus,
  tripGate,
  completionBlockers,
  UNDO_WINDOW_MS,
  type ActorRole,
  type CrewStudent,
  type CrewTripView,
  type OutboxItem,
  type StudentAction,
  type StudentState,
  type TripGate,
} from '@servisapp/domain';
import {
  ActionToast,
  AppText,
  BottomSheet,
  Button,
  colors,
  ConfirmSheet,
  ConnectionStatus,
  Field,
  FocusCard,
  fontFamilies,
  IconButton,
  InlineAlert,
  ListRow,
  Screen,
  space,
  StickyActionBand,
  StopSpine,
  triggerHaptic,
  TripSummary,
  VehicleIdentity,
  type ConnectionMode,
  type SyncState,
  useHardwareBack,
} from '@servisapp/ui';
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
import { actionLabel, studentStateLabel, tripStateLabel } from '../format';
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
  if (action !== 'DELIVER' && action !== 'RETURN_HOME' && action !== 'RESOLVE_DELIVERED_LATE') {
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

type ConfirmPending =
  | { kind: 'student'; student: TripStudentView; action: 'MARK_NO_SHOW' | 'MARK_DELIVERY_FAILED' }
  | { kind: 'COMPLETE' }
  | { kind: 'VEHICLE_CHECK_AFTER' };

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
    Platform.OS === 'ios'
      ? `maps://?daddr=${lat},${lng}&q=${encoded}`
      : `google.navigation:q=${lat},${lng}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  try {
    const supported = await Linking.canOpenURL(native);
    await Linking.openURL(supported ? native : web);
  } catch {
    await Linking.openURL(web);
  }
}

function primaryActionLabel(action: StudentAction): string {
  switch (action) {
    case 'BOARD':
      return 'Araca bindi';
    case 'DELIVER':
      return 'Teslim edildi';
    default:
      return actionLabel(action);
  }
}

function isDangerAction(action: StudentAction): action is 'MARK_NO_SHOW' | 'MARK_DELIVERY_FAILED' {
  return action === 'MARK_NO_SHOW' || action === 'MARK_DELIVERY_FAILED';
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
  const [studentQuery, setStudentQuery] = useState('');
  const [listFilter, setListFilter] = useState<'ALL' | 'PENDING' | 'ON_BOARD'>('ALL');
  const [overlay, setOverlay] = useState<'list' | 'incident' | 'otp' | 'receiver' | 'none'>('none');
  const [pendingReceiverAction, setPendingReceiverAction] = useState<{
    student: TripStudentView;
    action: StudentAction;
  } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  /**
   * Kod hatası sayfanın gövdesine yazılıyordu — açık sayfanın ALTINA.
   * Şoför "Doğrula"ya basıyor, ekranda hiçbir şey olmuyor, oysa sunucu "Kod
   * hatalı" demiş ve hakkı bir azalmıştı. Beş sessiz denemede talep kilitlenip
   * teslim duruyordu. Hata artık kodun sorulduğu yerde görünür.
   */
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpStudentId, setOtpStudentId] = useState<string | null>(null);
  const [incidentBody, setIncidentBody] = useState('');
  const [conflict, setConflict] = useState<OutboxItem | null>(null);
  const [focusStudentId, setFocusStudentId] = useState<string | null>(null);
  const [queueTick, setQueueTick] = useState(0);
  const [lastTap, setLastTap] = useState<LastTap | null>(null);
  const [confirmPending, setConfirmPending] = useState<ConfirmPending | null>(null);
  /** İşlem şeridinin ölçülen yüksekliği; geri-al bildirimi üstüne oturur. */
  const [bandHeight, setBandHeight] = useState(0);

  /**
   * Geri tuşu sırayla geriler: önce onay kutusu, sonra açık panel, en sonda
   * sefer listesi. Eskiden hiç dinlenmiyordu — şoför aktif seferin ortasında
   * geri tuşuna bastığında uygulama kapanıyordu.
   */
  useHardwareBack(() => {
    if (busy) return;
    if (confirmPending) {
      setConfirmPending(null);
      return;
    }
    if (overlay !== 'none') {
      setOverlay('none');
      return;
    }
    onBack();
  });
  const [toastVisible, setToastVisible] = useState(false);
  const actionLock = useRef(false);
  const syncQueueRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const reloadGeneration = useRef(0);
  const detailRef = useRef<TripDetail | null>(null);
  detailRef.current = detail;
  const role = actorRoleOf(session.roles);
  const gps = useTripGps(session, detail);

  function bumpQueue(): void {
    setQueueTick((value) => value + 1);
  }

  const failFrom = useCallback(
    (caught: unknown, fallback: string): void => {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionInvalid();
        return;
      }
      void triggerHaptic('error');
      setError(caught instanceof ApiError ? caught.message : fallback);
    },
    [onSessionInvalid],
  );

  const reload = useCallback(async (): Promise<TripDetail | null> => {
    // Yavaş bir yanıt, daha yenisini ezebiliyordu: OTP doğrulandıktan sonra
    // inen eski anlık görüntü `deliveryVerified`'ı tekrar false yapıp teslimi
    // yeniden kilitliyordu.
    const generation = reloadGeneration.current + 1;
    reloadGeneration.current = generation;
    const next = await getTrip(session, tripId);
    // Eski generation cevabı detailRef'i ezmesin (OTP→DELIVER yarışı).
    if (reloadGeneration.current !== generation) return next;
    detailRef.current = next;
    setDetail(next);
    await persistLastTripId(tripId);
    const open = pendingConflicts().find((item) => item.tripId === tripId);
    if (open) setConflict(open);
    bumpQueue();
    return next;
  }, [session, tripId]);

  useEffect(() => {
    void reload().catch((caught: unknown) => {
      failFrom(caught, 'Sefer yüklenemedi');
    });
  }, [reload, failFrom]);

  /**
   * Kuyruk, yalnız şoför yeni bir çocuk işaretlediğinde gönderiliyordu. Tünelde
   * son çocuğu işaretleyip şebekeye çıkan şoförün elinde işaretlenecek kimse
   * kalmadığı için kuyruk hiç gönderilmiyor, sefer de kapanmıyordu. Ekran
   * açıldığında, uygulama öne geldiğinde ve bekleyen komut varken düzenli
   * aralıklarla denenir.
   */
  useEffect(() => {
    let stopped = false;
    const attempt = (): void => {
      if (stopped || !hasOpenCommands(tripId)) return;
      // Ref üzerinden çağrılır: efekt her render'da yeniden kurulmadan da her
      // zaman en güncel senkron fonksiyonunu kullanır.
      void syncQueueRef.current();
    };
    attempt();
    const timer = setInterval(attempt, 20_000);
    const onAppState = (next: AppStateStatus): void => {
      if (next === 'active') attempt();
    };
    const subscription = AppState.addEventListener('change', onAppState);
    return () => {
      stopped = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [tripId]);

  useEffect(() => {
    void AsyncStorage.getItem(lastTapStorageKey(tripId)).then((raw) => {
      const parsed = parseLastTap(raw);
      setLastTap(parsed);
      setToastVisible(Boolean(parsed));
      if (!parsed) void AsyncStorage.removeItem(lastTapStorageKey(tripId));
    });
  }, [tripId]);

  useEffect(() => {
    if (!lastTap) {
      setToastVisible(false);
      return;
    }
    setToastVisible(true);
    const remaining = UNDO_WINDOW_MS - (Date.now() - lastTap.at);
    const hideAfter = Math.min(8_000, Math.max(0, remaining));
    const timer = setTimeout(() => setToastVisible(false), hideAfter);
    return () => clearTimeout(timer);
  }, [lastTap]);

  const crew = useMemo(() => (detail ? asCrewTrip(detail) : null), [detail]);
  const focus = crew ? tripFocus(crew) : null;
  const gate = crew ? tripGate(crew) : null;
  // Kapanışı engelleyen çocuklar açıkça yazılır; aksi hâlde şoför kilitli bir
  // seferde sebebini bilmeden kalıyordu.
  const blockers = crew && crew.state === 'ACTIVE' ? completionBlockers(crew) : [];
  const queueOpen = queueTick >= 0 && hasOpenCommands(tripId);

  const tripQueueItems = useMemo(() => {
    void queueTick;
    return listOutbox().filter((item) => item.tripId === tripId);
  }, [tripId, queueTick]);

  const openQueueCount = tripQueueItems.filter(
    (item) => item.status === 'PENDING' || item.status === 'IN_FLIGHT',
  ).length;
  const failedQueueCount = tripQueueItems.filter(
    (item) => item.status === 'REJECTED' || item.status === 'CONFLICT',
  ).length;

  const connectionMode: ConnectionMode = offline
    ? 'offline'
    : failedQueueCount > 0
      ? 'syncProblem'
      : 'online';
  const connectionQueueCount = connectionMode === 'syncProblem' ? failedQueueCount : openQueueCount;

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
    // Kuyruk gönderilemediyse şoför bunu GÖRMELİ; sessiz başarısızlık,
    // işaretlenmiş sandığı çocukların sunucuya hiç ulaşmaması demekti.
    setOffline(found.failure?.offline === true);
    if (found.failure && !found.failure.offline) {
      setError(found.failure.message);
    }
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
      if (
        current &&
        student &&
        mineRejected.conflictState &&
        mineRejected.conflictStateSeq !== undefined
      ) {
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
      const reason =
        mineRejected.rejectReason === 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE'
          ? 'Farklı adres — teslim kodunu gir'
          : mineRejected.rejectReason === 'GUARDIAN_RECEIVER_REQUIRED'
            ? 'Teslim alan yetkili veli seçilmeli'
            : mineRejected.rejectReason === 'CRITICAL_CHANGE_UNACKED'
              ? 'Kritik değişiklik: onaylamadan komut yok'
              : 'Bu işlem sunucuda reddedildi';
      // Reddedilen komutla birlikte aynı çocuğun bekleyen diğer işaretleri de
      // düşer (nedensellik). Şoför bunu görmeli, yoksa kapıda kaydettiği teslim
      // sessizce yok oluyor ve yeniden işaretlemesi gerektiğini bilmiyordu.
      const dropped = await dropPendingFor(mineRejected.tripStudentId);
      const name =
        detailRef.current?.students.find((row) => row.id === mineRejected.tripStudentId)
          ?.fullName ?? 'Öğrenci';
      setError(
        dropped > 0
          ? `${reason}. ${name} için bekleyen ${String(dropped)} işaret iptal edildi; yeniden işaretleyin.`
          : reason,
      );
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

  syncQueueRef.current = async () => {
    try {
      await syncQueue();
    } catch (caught) {
      failFrom(caught, 'Kuyruk gönderilemedi');
    }
  };

  async function queueActionWithReceiver(
    student: TripStudentView,
    action: StudentAction,
    receiverMembershipId: string | undefined,
  ): Promise<void> {
    const current = detailRef.current;
    if (!current || actionLock.current) return;
    actionLock.current = true;
    // Kilit tek başına yetmiyordu: butonlar etkin kalıyor, şoförün ikinci
    // dokunuşu sessizce düşüyordu. `busy` ile hem kilitlenir hem görünür olur.
    setBusy(true);
    setError(null);
    try {
      const live = current.students.find((row) => row.id === student.id) ?? student;
      if (
        (action === 'DELIVER' || action === 'RETURN_HOME' || action === 'RESOLVE_DELIVERED_LATE') &&
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
            ? 'Farklı adres — teslim kodunu gir'
            : optimistic.reason === 'GUARDIAN_RECEIVER_REQUIRED'
              ? 'Teslim alan yetkili veli seçilmeli'
              : 'Bu işlem şimdi yapılamaz',
        );
        if (optimistic.reason === 'TEMP_DELIVERY_REQUIRES_VERIFIED_CODE') {
          setOtpStudentId(live.id);
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
        setToastVisible(true);
        void persistLastTap(tripId, tap);
        if (action === 'BOARD' || action === 'DELIVER') {
          void triggerHaptic('success');
        }
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
      setBusy(false);
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
        setToastVisible(false);
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
      setToastVisible(false);
      await persistLastTap(tripId, null);
      await reload();
    } catch (caught) {
      failFrom(caught, 'Geri alma başarısız');
    } finally {
      actionLock.current = false;
    }
  }

  async function runGate(): Promise<void> {
    // `setBusy` bir sonraki render'da etkili olur; tek elle çift basış iki
    // isteği birden yollayabiliyordu. Ref eşzamanlıdır.
    if (!gate || hasOpenCommands(tripId) || actionLock.current) return;
    actionLock.current = true;
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
      // Kilit BURADA bırakılmazsa ekran tümüyle ölür: araç kontrolüne bir kez
      // basan şoför artık ne seferi başlatabilir ne de tek bir çocuğu
      // işaretleyebilir; her dokunuş sessizce düşer.
      actionLock.current = false;
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
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await reportIncident(session, tripId, { body: incidentBody.trim() });
      setIncidentBody('');
      setOverlay('none');
    } catch (caught) {
      failFrom(caught, 'Bildirim gönderilemedi');
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function submitOtp(code: string = otpCode): Promise<void> {
    const pinnedId = otpStudentId ?? activeStudent?.id ?? null;
    if (!pinnedId || code.length !== 6 || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError(null);
    setOtpError(null);
    try {
      await verifyDeliveryOtp(session, tripId, pinnedId, code);
      setOtpCode('');
      setOverlay('none');
      setOtpStudentId(null);
      const next = await reload();
      const refreshed = next?.students.find((row) => row.id === pinnedId);
      if (refreshed && detailRef.current) {
        // OTP sonrası taze öğrenci satırını ref'e kilitle (eşzamanlı stale reload ezmesin).
        detailRef.current = {
          ...detailRef.current,
          students: detailRef.current.students.map((row) =>
            row.id === refreshed.id ? refreshed : row,
          ),
        };
        setDetail(detailRef.current);
      }
      if (!refreshed?.deliveryVerified) {
        void triggerHaptic('error');
        setError('Kod doğrulandı ama teslim kilidi açılmadı; yenileyip tekrar deneyin');
        return;
      }
      if (refreshed.state !== 'ON_BOARD') {
        void triggerHaptic('success');
        return;
      }
      if (needsReceiverPick(refreshed, 'DELIVER')) {
        setPendingReceiverAction({ student: refreshed, action: 'DELIVER' });
        setOverlay('receiver');
        return;
      }
      actionLock.current = false;
      setBusy(false);
      await queueActionWithReceiver(refreshed, 'DELIVER', preferredReceiverId(refreshed));
      const after = detailRef.current?.students.find((row) => row.id === pinnedId);
      if (after?.state === 'ON_BOARD') {
        void triggerHaptic('error');
        setError((current) => current ?? 'Kod doğrulandı, teslim kaydı gönderilemedi');
      } else {
        void triggerHaptic('success');
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status !== 401) {
        void triggerHaptic('error');
        setOtpError(caught.message);
        setOtpCode('');
        return;
      }
      failFrom(caught, 'Kod doğrulanamadı');
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function ackAlert(alertId: string): Promise<void> {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await ackCriticalAlert(session, tripId, alertId);
      await reload();
    } catch (caught) {
      failFrom(caught, 'Uyarı onaylanamadı');
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  const blockingAlert = detail?.pendingAlerts[0] ?? null;

  const listGroups = useMemo(() => {
    if (!detail || !focus) return [] as Array<[string, TripStudentView[]]>;
    const pendingIds = new Set(focus.pendingAtStop.map((row) => row.id));
    const groups = new Map<string, TripStudentView[]>();
    for (const row of detail.students) {
      const query = studentQuery.trim().toLocaleLowerCase('tr-TR');
      if (
        query &&
        !`${row.fullName} ${row.expectedStopLabel ?? ''}`.toLocaleLowerCase('tr-TR').includes(query)
      )
        continue;
      if (listFilter === 'PENDING' && !pendingIds.has(row.id)) continue;
      if (listFilter === 'ON_BOARD' && row.state !== 'ON_BOARD') continue;
      const key = row.expectedStopLabel ?? 'Durak yok';
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    return [...groups.entries()].map(([key, rows]) => {
      const sorted = [...rows].sort((left, right) => {
        const leftPending = pendingIds.has(left.id) ? 0 : 1;
        const rightPending = pendingIds.has(right.id) ? 0 : 1;
        return leftPending - rightPending;
      });
      return [key, sorted] as [string, TripStudentView[]];
    });
  }, [detail, focus, studentQuery, listFilter]);

  if (!detail || !crew || !focus || !gate) {
    return (
      <Screen>
        <IconButton label="← Bugün" onPress={onBack} />
        {error ? (
          <InlineAlert title={error} tone="danger" />
        ) : (
          <ActivityIndicator color={colors.rail} style={styles.loader} />
        )}
      </Screen>
    );
  }

  const gateLabel = queueOpen ? 'Kuyruk gönderiliyor…' : gateButtonLabel(gate);
  const conflictState = conflict?.conflictState
    ? asStudentState(conflict.conflictState)
    : undefined;

  const needsOtp =
    activeStudent !== null &&
    activeStudent.deliveryTarget === 'TEMP' &&
    !activeStudent.deliveryVerified;
  const primaryStudentAction =
    actions.find((action) => action === 'BOARD' || action === 'DELIVER') ??
    actions.find((action) => !isDangerAction(action) && action !== 'RETURN_HOME') ??
    null;
  const secondaryStudentAction = actions.find((action) => action === 'RETURN_HOME') ?? null;
  const dangerStudentAction = actions.find(isDangerAction) ?? null;

  /**
   * Sefer düzeyindeki adım her şeyin önünde gelir.
   *
   * "Kodu doğrula" eskiden şeridi KOŞULSUZ ele geçiriyordu: günün ilk farklı
   * teslimatı planlandığı anda, sefer daha başlamamışken bile tek düğme oydu.
   * İki sonucu vardı ve ikisi de sahada ağırdır: (1) şoför seferi
   * başlatamıyordu — araç kontrolü ve "Seferi başlat" düğmesi ekranda yoktu;
   * (2) kod, alıcı kapıda değilken okul önünde soruluyordu, yanlış denemeler
   * ise hakkı tüketip talebi kilitliyordu.
   */
  // Sefer henüz başlamadıysa hiçbir öğrenci işlemi zaten mümkün değildir
  // (durum makinesi ACTIVE ister); şerit araç kontrolünü ve başlatmayı gösterir.
  const tripNotStarted = gate.kind === 'VEHICLE_CHECK' || gate.kind === 'START';
  // Kod teslim anına aittir: çocuk araçtayken, kendi kapısında sorulur.
  const otpNow =
    needsOtp &&
    !tripNotStarted &&
    (activeStudent?.state === 'ON_BOARD' || activeStudent?.state === 'DELIVERY_FAILED');

  let bandPrimaryLabel: string | null = null;
  let onBandPrimary: (() => void) | undefined;
  if (otpNow) {
    bandPrimaryLabel = 'Kodu doğrula';
    onBandPrimary = () => {
      if (activeStudent) setOtpStudentId(activeStudent.id);
      setOverlay('otp');
    };
  } else if (primaryStudentAction && activeStudent) {
    bandPrimaryLabel = primaryActionLabel(primaryStudentAction);
    onBandPrimary = () => {
      void queueAction(activeStudent, primaryStudentAction);
    };
  } else if (gateLabel) {
    bandPrimaryLabel = gateLabel;
    onBandPrimary = () => {
      if (gate.kind === 'COMPLETE') {
        void triggerHaptic('risk');
        setConfirmPending({ kind: 'COMPLETE' });
        return;
      }
      if (gate.kind === 'VEHICLE_CHECK' && gate.phase === 'AFTER') {
        void triggerHaptic('risk');
        setConfirmPending({ kind: 'VEHICLE_CHECK_AFTER' });
        return;
      }
      void runGate();
    };
  } else if (gate.kind === 'DONE') {
    /**
     * Sefer kapandığında ekran sessizce boşalıyordu: şeritte düğme kalmıyor,
     * sayaçlar sıfırlanıyor, ama "kapandı" diyen hiçbir şey yok ve şoför bu ölü
     * ekranda kalıyordu. Günün en kritik anında onay ve çıkış yolu gerekir.
     */
    bandPrimaryLabel = 'Seferlere dön';
    onBandPrimary = onBack;
  }

  const dangerLabel = dangerStudentAction ? actionLabel(dangerStudentAction) : null;
  const secondaryLabel = secondaryStudentAction ? actionLabel(secondaryStudentAction) : null;

  const currentStopSeq = focus.currentStop?.seq;
  const spineStops = [...detail.stops]
    .sort((left, right) => left.seq - right.seq)
    .map((stop) => ({
      id: stop.id,
      label: stop.label,
      status:
        currentStopSeq === undefined
          ? ('past' as const)
          : stop.seq < currentStopSeq
            ? ('past' as const)
            : stop.seq === currentStopSeq
              ? ('active' as const)
              : ('future' as const),
    }));

  // Sayaç, kapının gerçekten işlediği öğrencilerden gelir; durak üyeliğinden
  // türetilirse akşam okul kapısı "0/0" gösteriyordu (bkz. `stopWorkload`).
  const stopWork = focus.currentStop ? stopWorkload(crew, focus.currentStop) : null;
  const atStopTotal = stopWork?.total;
  const atStopDone = stopWork?.done;

  const studentSync: SyncState = (() => {
    if (!activeStudent) return null;
    const pending = tripQueueItems.find(
      (item) =>
        item.tripStudentId === activeStudent.id &&
        (item.status === 'PENDING' || item.status === 'IN_FLIGHT'),
    );
    if (!pending) return null;
    return pending.status === 'IN_FLIGHT' ? 'sending' : 'queued';
  })();

  const undoableTap =
    lastTap && isUndoableStudentAction(lastTap.action) && Date.now() - lastTap.at < UNDO_WINDOW_MS
      ? lastTap
      : null;
  const deliverTap =
    lastTap && lastTap.action === 'DELIVER' && Date.now() - lastTap.at < UNDO_WINDOW_MS
      ? lastTap
      : null;
  const toastTap = undoableTap ?? deliverTap;
  const toastStudentName = toastTap
    ? (detail.students.find((row) => row.id === toastTap.tripStudentId)?.fullName ?? 'Öğrenci')
    : '';

  const confirmTitle =
    confirmPending?.kind === 'student' && confirmPending.action === 'MARK_NO_SHOW'
      ? 'Binmedi olarak işaretle'
      : confirmPending?.kind === 'student' && confirmPending.action === 'MARK_DELIVERY_FAILED'
        ? 'Teslim edilemedi'
        : confirmPending?.kind === 'COMPLETE'
          ? 'Seferi kapat'
          : confirmPending?.kind === 'VEHICLE_CHECK_AFTER'
            ? 'Sefer sonu kontrolü'
            : '';

  const confirmBody =
    confirmPending?.kind === 'student' && confirmPending.action === 'MARK_NO_SHOW'
      ? `${confirmPending.student.fullName} bu durakta binmedi olarak kaydedilecek.`
      : confirmPending?.kind === 'student' && confirmPending.action === 'MARK_DELIVERY_FAILED'
        ? `${confirmPending.student.fullName} teslim edilemedi olarak kaydedilecek.`
        : confirmPending?.kind === 'COMPLETE'
          ? openQueueCount > 0
            ? `Gönderilmeyi bekleyen ${String(openQueueCount)} işlem var. Kuyruk bitmeden sefer kapanmaz.`
            : 'Sefer kapanacak. Devam etmek istiyor musunuz?'
          : confirmPending?.kind === 'VEHICLE_CHECK_AFTER'
            ? 'Araç boş — sefer sonu kontrolünü onaylıyor musunuz?'
            : '';

  // During normal boarding, counts already explain the unfinished trip.
  // Keep intervention warnings visible; show all closure blockers when no student action remains.
  const displayedBlockers = activeStudent ? blockers.filter((row) => row.needsAdmin) : blockers;

  /**
   * Kod, velinin BELİRLEDİĞİ alıcının telefonuna gider — velinin kendi
   * numarasına değil (bkz. migration 0032). Eskiden burada `guardianPhone`
   * yazıyordu; farklı teslimatın var oluş sebebi olan durumda (çocuğu teyze
   * alacak) şoföre kapıda yanlış numara gösteriyordu. Alıcının numarası
   * personel yanıtında yoktur ve olmamalıdır; adıyla söylüyoruz.
   */
  const otpReceiverHint = activeStudent?.receiverName
    ? `${activeStudent.receiverName} adlı kişinin telefonuna`
    : 'teslim alacak kişinin telefonuna';

  /**
   * Eve teslimde "kime" sorusu ekranda yazılı DEĞİLDİ.
   *
   * Tek yetkili varsa uygulama onu sessizce seçip kayda geçiyor (bkz.
   * `preferredReceiverId`); ekranda hiçbir yerde adı geçmiyordu. Yani şoför
   * kapıda karşısındakinin yetkili olup olmadığını bilmeden "Teslim edildi"
   * diyor, olay kaydına ise hiç görmediği bir isim yazılıyordu. İsim kartta
   * durursa hem kapıda doğrulama mümkün olur hem de kayıt dürüst kalır.
   */
  const handoverTo =
    activeStudent &&
    activeStudent.handoverPolicy === 'GUARDIAN_REQUIRED' &&
    activeStudent.deliveryTarget === 'HOME' &&
    activeStudent.receivers.length > 0
      ? activeStudent.receivers.map((row) => `${row.fullName} (${row.relation})`).join(' · ')
      : null;

  return (
    <Screen padded={false} style={styles.screen}>
      <View style={styles.header}>
        <IconButton label="← Seferler" onPress={onBack} />
        <View style={styles.headerMid}>
          <VehicleIdentity plate={detail.plate} compact />
        </View>
        <ConnectionStatus mode={connectionMode} queueCount={connectionQueueCount} />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AppText preset="section" style={styles.stopTitle}>
          {focus.destinationLabel}
        </AppText>
        <TripSummary
          atStopDone={atStopDone}
          atStopTotal={atStopTotal}
          onBoard={focus.remainingOnBoard}
          remainingExpected={focus.remainingExpected}
        />
        <StopSpine
          stops={spineStops}
          progressLabel={
            typeof atStopDone === 'number' && typeof atStopTotal === 'number'
              ? `Bu kapıda ${String(atStopDone)}/${String(atStopTotal)}`
              : undefined
          }
        />

        {gate.kind === 'DONE' ? (
          <InlineAlert
            tone="ok"
            title={`Sefer kapandı · ${tripStateLabel(detail.state)}`}
            body="Araç boş onaylandı, kayıt tamamlandı."
          />
        ) : null}
        {gps.message ? <InlineAlert title={gps.message} tone="warn" /> : null}
        {error ? <InlineAlert title={error} tone="danger" /> : null}

        {activeStudent ? (
          <FocusCard
            name={activeStudent.fullName}
            stateLabel={studentStateLabel(activeStudent.state)}
            stopLabel={activeStudent.expectedStopLabel ?? focus.currentStop?.addressText}
            phone={activeStudent.guardianPhone}
            tempDelivery={activeStudent.deliveryTarget === 'TEMP'}
            tempReceiverName={activeStudent.receiverName}
            handoverTo={handoverTo}
            needsReview={activeStudent.needsReview}
            manualOverride={Boolean(focusStudentId)}
            onReturnToSequence={() => setFocusStudentId(null)}
            syncState={studentSync}
          />
        ) : (
          <AppText preset="meta" style={styles.empty}>
            Bu durakta işaretlenecek öğrenci kalmadı.
          </AppText>
        )}

        {displayedBlockers.length > 0 ? (
          <InlineAlert
            title="Sefer kapanamıyor"
            tone="danger"
            body={displayedBlockers
              .map(
                (row) =>
                  `${row.fullName} — ${studentStateLabel(row.state)}${
                    row.needsAdmin ? ' · yönetici çözecek' : ''
                  }`,
              )
              .join('\n')}
          />
        ) : null}
      </ScrollView>

      <StickyActionBand
        onHeight={setBandHeight}
        primaryLabel={bandPrimaryLabel}
        onPrimary={onBandPrimary}
        primaryDisabled={
          busy ||
          Boolean(blockingAlert) ||
          (Boolean(gateLabel) && queueOpen && !otpNow && !primaryStudentAction)
        }
        primaryLoading={busy && !confirmPending}
        secondaryLabel={secondaryLabel}
        onSecondary={
          secondaryStudentAction && activeStudent
            ? () => {
                void queueAction(activeStudent, secondaryStudentAction);
              }
            : undefined
        }
        secondaryDisabled={busy || Boolean(blockingAlert)}
        dangerLabel={dangerLabel}
        onDanger={
          dangerStudentAction && activeStudent
            ? () => {
                void triggerHaptic('risk');
                setConfirmPending({
                  kind: 'student',
                  student: activeStudent,
                  action: dangerStudentAction,
                });
              }
            : undefined
        }
        dangerDisabled={busy || Boolean(blockingAlert)}
        tools={[
          {
            label: `Liste (${detail.students.length})`,
            onPress: () => {
              setStudentQuery('');
              setListFilter('ALL');
              setOverlay('list');
            },
          },
          {
            label: 'Navigasyon',
            onPress: () => {
              const stop = focus.currentStop;
              if (stop) void openNavigation(stop.lat, stop.lng, stop.label);
            },
          },
          { label: 'Sorun', onPress: () => setOverlay('incident') },
        ]}
      />

      <ActionToast
        bottomOffset={bandHeight}
        visible={toastVisible && Boolean(toastTap)}
        title={
          toastTap?.action === 'BOARD'
            ? 'Araca bindi'
            : toastTap?.action === 'DELIVER'
              ? 'Teslim edildi'
              : toastTap
                ? actionLabel(toastTap.action)
                : ''
        }
        detail={
          toastTap?.action === 'DELIVER' ? 'Bu işlem geri alınamaz' : toastStudentName || undefined
        }
        onUndo={
          undoableTap && !busy && !blockingAlert
            ? () => {
                void undoLast();
              }
            : undefined
        }
      />

      <BottomSheet
        visible={overlay === 'list'}
        level="standard"
        title="Öğrenci listesi"
        onClose={() => setOverlay('none')}
      >
        <Field
          label="Öğrenci veya durak ara"
          value={studentQuery}
          onChangeText={setStudentQuery}
          placeholder="Ad soyad veya durak adı"
          autoCorrect={false}
          returnKeyType="search"
        />
        <View style={styles.listFilters}>
          {(
            [
              { key: 'ALL', label: `Tümü · ${detail.students.length}` },
              { key: 'PENDING', label: `Bu durak · ${focus.pendingAtStop.length}` },
              { key: 'ON_BOARD', label: `Araçta · ${focus.remainingOnBoard}` },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: listFilter === item.key }}
              onPress={() => setListFilter(item.key)}
              style={[styles.listFilter, listFilter === item.key && styles.listFilterActive]}
            >
              <AppText
                preset="caption"
                color={listFilter === item.key ? colors.paper : colors.rail}
              >
                {item.label}
              </AppText>
            </Pressable>
          ))}
        </View>
        <AppText preset="caption" style={styles.listHint}>
          Bu durakta işaretlenecek bir öğrenciyi seçerek işlem kartını açabilirsin.
        </AppText>
        {listGroups.length === 0 ? (
          <View style={styles.listEmpty}>
            <AppText preset="section">Eşleşen öğrenci yok</AppText>
            <AppText preset="meta">Aramayı veya seçili filtreyi değiştir.</AppText>
            <Button
              label="Tüm öğrencileri göster"
              variant="secondary"
              onPress={() => {
                setStudentQuery('');
                setListFilter('ALL');
              }}
            />
          </View>
        ) : null}
        <View>
          {listGroups.map(([stopLabel, rows]) => (
            <View key={stopLabel} style={styles.listGroup}>
              <AppText preset="meta" style={styles.listGroupTitle}>
                {stopLabel}
              </AppText>
              {rows.map((row) => {
                const pending = focus.pendingAtStop.some((item) => item.id === row.id);
                return (
                  <ListRow
                    key={row.id}
                    title={row.fullName}
                    meta={`${studentStateLabel(row.state)}${pending ? ' · işaretle' : ''}`}
                    emphasized={pending}
                    disabled={!pending}
                    onPress={
                      pending
                        ? () => {
                            setFocusStudentId(row.id);
                            setOverlay('none');
                          }
                        : undefined
                    }
                  />
                );
              })}
            </View>
          ))}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={overlay === 'incident'}
        level="action"
        title="Sorun bildir"
        onClose={() => setOverlay('none')}
      >
        <Field
          label="Ne oldu?"
          multiline
          placeholder="Kısa açıklama"
          value={incidentBody}
          onChangeText={setIncidentBody}
          style={styles.incidentInput}
        />
        <Button
          label="Gönder"
          onPress={() => void sendIncident()}
          disabled={busy || incidentBody.trim().length < 3}
          loading={busy}
          size="crewPrimary"
        />
      </BottomSheet>

      <BottomSheet
        visible={overlay === 'otp'}
        level="action"
        title="Teslim kodu"
        onClose={() => {
          setOtpCode('');
          setOtpError(null);
          setOtpStudentId(null);
          setOverlay('none');
        }}
      >
        <AppText preset="body" style={styles.otpCopy}>
          Kod {otpReceiverHint} gönderildi. Bu cihaza gelmez.
        </AppText>
        {otpError ? <InlineAlert title={otpError} tone="danger" /> : null}
        <Field
          label="6 haneli kod"
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          value={otpCode}
          onChangeText={(text) => {
            const next = text.replace(/\D/g, '').slice(0, 6);
            setOtpCode(next);
            if (otpError) setOtpError(null);
            if (next.length === 6) {
              void submitOtp(next);
            }
          }}
          style={styles.otpInput}
        />
        <Button
          label="Doğrula"
          onPress={() => void submitOtp()}
          disabled={busy || otpCode.length !== 6}
          loading={busy}
          size="crewPrimary"
        />
      </BottomSheet>

      <BottomSheet
        visible={overlay === 'receiver'}
        level="action"
        title="Teslim alan kişi"
        onClose={() => {
          setPendingReceiverAction(null);
          setOverlay('none');
        }}
      >
        <AppText preset="meta" style={styles.otpCopy}>
          Kapıdaki yetkili velini seç.
        </AppText>
        <ScrollView style={styles.sheetScroll}>
          {(pendingReceiverAction?.student.receivers ?? []).map((receiver) => (
            <ListRow
              key={receiver.membershipId}
              title={receiver.fullName}
              meta={receiver.relation}
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
            />
          ))}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={blockingAlert !== null}
        level="critical"
        title="Kritik değişiklik"
        dismissible={false}
      >
        <AppText preset="body" style={styles.criticalBody}>
          {blockingAlert?.body}
        </AppText>
        <Button
          label="Okudum, anladım"
          onPress={() => {
            if (blockingAlert) void ackAlert(blockingAlert.id);
          }}
          disabled={busy}
          loading={busy}
          size="crewPrimary"
        />
      </BottomSheet>

      <BottomSheet visible={conflict !== null} level="critical" title="Çakışma" dismissible={false}>
        <AppText preset="strong" style={styles.criticalName}>
          {detail.students.find((row) => row.id === conflict?.tripStudentId)?.fullName ?? 'Öğrenci'}
        </AppText>
        <AppText preset="body" style={styles.criticalBody}>
          İki cihaz aynı anda işaretledi. Sunucudaki durum:{' '}
          {conflictState ? studentStateLabel(conflictState) : 'bilinmiyor'}
        </AppText>
        <Button
          label="Anladım, yeniden işaretlerim"
          onPress={() => void ackConflict()}
          size="crewPrimary"
        />
      </BottomSheet>

      <ConfirmSheet
        visible={confirmPending !== null}
        title={confirmTitle}
        body={confirmBody}
        confirmLabel={
          confirmPending?.kind === 'COMPLETE'
            ? 'Seferi kapat'
            : confirmPending?.kind === 'VEHICLE_CHECK_AFTER'
              ? 'Onayla'
              : 'İşaretle'
        }
        danger={confirmPending?.kind !== 'VEHICLE_CHECK_AFTER'}
        busy={busy}
        onCancel={() => setConfirmPending(null)}
        onConfirm={() => {
          const pending = confirmPending;
          setConfirmPending(null);
          if (!pending) return;
          if (pending.kind === 'student') {
            void queueAction(pending.student, pending.action);
            return;
          }
          if (hasOpenCommands(tripId)) {
            setError('Kuyruk gönderilene kadar bu işlem yapılamaz');
            return;
          }
          void runGate();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listFilters: { flexDirection: 'row', gap: 6, marginBottom: space.md },
  listFilter: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.railSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  listFilterActive: { backgroundColor: colors.rail },
  listHint: { marginBottom: space.md },
  listEmpty: { gap: space.md, paddingVertical: space.lg },
  screen: { flex: 1, backgroundColor: colors.mist },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    gap: space.xs,
  },
  headerMid: { flex: 1, alignItems: 'center' },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  stopTitle: { marginBottom: space.xxs },
  loader: { marginTop: space.xl },
  empty: { textAlign: 'center', marginVertical: space.lg },
  sheetScroll: { maxHeight: 420 },
  listGroup: { marginBottom: space.md },
  listGroupTitle: { marginBottom: space.xs, color: colors.mute },
  incidentInput: { minHeight: 120, textAlignVertical: 'top' },
  otpCopy: { marginBottom: space.md },
  otpInput: {
    minHeight: 64,
    textAlign: 'center',
    fontSize: 28,
    letterSpacing: 8,
    fontFamily: fontFamilies.monoSemiBold,
  },
  criticalBody: { marginBottom: space.lg },
  criticalName: { marginBottom: space.sm },
});
