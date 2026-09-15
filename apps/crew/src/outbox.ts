import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  applyServerResult,
  nextDeviceSeq,
  nextFlushBatch,
  recoverInFlight,
  STUDENT_ACTIONS,
  type OutboxItem,
  type OutboxStatus,
} from '@servisapp/domain';
import * as SQLite from 'expo-sqlite';
import { ApiError, postCommand, type CrewSession } from './api/client';
import { getSecret, setSecret } from './secure-storage';

const MEMORY_KEY = 'crew.outbox.v1';
/** Cihaz kimliğiyle aynı kalıcı depoda tutulur; ikisi birlikte yaşar, birlikte ölür. */
const DEVICE_SEQ_KEY = 'crew.deviceSeq';
/** Çözülmemiş çakışma/ret satırlarından bellekte tutulacak en yeni kayıt sayısı. */
const TERMINAL_KEEP = 50;
const STATUSES: readonly OutboxStatus[] = [
  'PENDING',
  'IN_FLIGHT',
  'CONFLICT',
  'REJECTED',
  'APPLIED',
];

let db: SQLite.SQLiteDatabase | null = null;
let memory: OutboxItem[] = [];
let useMemory = false;
let chain: Promise<void> = Promise.resolve();

export interface FlushOutcome {
  conflicts: OutboxItem[];
  rejected: OutboxItem[];
  /**
   * Gönderimi durduran taşıma/sunucu hatası. Eskiden bu hata sessizce yutulup
   * döngü kırılıyordu: şoför ekranda hiçbir uyarı görmeden, komutlarının
   * gittiğini sanıyordu. `offline` ayrı tutulur çünkü ekranda farklı anlatılır.
   */
  failure?: { code: string; message: string; offline: boolean };
}

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function openOutbox(): Promise<void> {
  try {
    db = await SQLite.openDatabaseAsync('crew-outbox.db');
    await db.execAsync(`
      create table if not exists outbox (
        client_event_id text primary key not null,
        trip_id text not null,
        trip_student_id text not null,
        action text not null,
        expected_state_seq integer not null,
        device_seq integer not null,
        occurred_at_device text not null,
        status text not null,
        conflict_state text,
        conflict_state_seq integer,
        reject_reason text,
        receiver_membership_id text
      );
    `);
    try {
      await db.execAsync('alter table outbox add column receiver_membership_id text');
    } catch {
      // kolon zaten var
    }
    // Bitmiş satırlar (APPLIED zaten silinir; CONFLICT/REJECTED şoför çözmezse
    // kalır) sınırsız birikiyordu: her açılışta hepsi belleğe yükleniyor ve her
    // render'da taranıyordu. Bir dönem sonra tablo şoförün telefonunda yük olur.
    await db.execAsync(
      `delete from outbox where status in ('CONFLICT', 'REJECTED')
       and client_event_id not in (
         select client_event_id from outbox
         where status in ('CONFLICT', 'REJECTED')
         order by device_seq desc limit ${String(TERMINAL_KEEP)}
       )`,
    );
    const rows = await db.getAllAsync<OutboxRow>('select * from outbox order by device_seq asc');
    const loaded = rows.flatMap((row) => {
      const item = fromRow(row);
      return item ? [item] : [];
    });
    memory = recoverInFlight(loaded);
    for (let i = 0; i < loaded.length; i += 1) {
      const previous = loaded[i];
      const next = memory[i];
      if (previous && next && previous.status === 'IN_FLIGHT') {
        await persist(next);
      }
    }
  } catch {
    useMemory = true;
    db = null;
    const raw = await AsyncStorage.getItem(MEMORY_KEY);
    let parsed: unknown = [];
    if (raw) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = [];
      }
    }
    const loaded = Array.isArray(parsed)
      ? parsed.flatMap((value) => {
          const item = coerceItem(value);
          return item ? [item] : [];
        })
      : [];
    memory = recoverInFlight(loaded);
    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  }
}

export function listOutbox(): OutboxItem[] {
  return [...memory];
}

export function pendingConflicts(): OutboxItem[] {
  return memory.filter((item) => item.status === 'CONFLICT');
}

export function pendingRejected(): OutboxItem[] {
  return memory.filter((item) => item.status === 'REJECTED');
}

export function hasOpenCommands(tripId: string): boolean {
  return memory.some(
    (item) => item.tripId === tripId && (item.status === 'PENDING' || item.status === 'IN_FLIGHT'),
  );
}

/**
 * Sıra numarasını ayırır ve kalıcı olarak işaretler. Kilit `runExclusive`
 * tarafından tutulduğu için aynı numara iki komuta verilemez.
 */
async function reserveDeviceSeq(): Promise<number> {
  const stored = await getSecret(DEVICE_SEQ_KEY);
  const parsed = stored === null ? Number.NaN : Number(stored);
  const floor = Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
  const next = nextDeviceSeq(memory, floor);
  await setSecret(DEVICE_SEQ_KEY, String(next));
  return next;
}

export async function enqueueCommand(
  input: Omit<OutboxItem, 'deviceSeq' | 'status'>,
): Promise<OutboxItem> {
  return runExclusive(async () => {
    const item: OutboxItem = {
      ...input,
      deviceSeq: await reserveDeviceSeq(),
      status: 'PENDING',
    };
    memory = [...memory, item];
    await persist(item);
    return item;
  });
}

export async function flushOutbox(session: CrewSession): Promise<FlushOutcome> {
  return runExclusive(async () => {
    memory = recoverInFlight(memory);
    const batch = nextFlushBatch(memory);
    const conflicts: OutboxItem[] = [];
    const rejected: OutboxItem[] = [];
    // Parti başta hesaplanır; ama aynı çocuğun bir komutu çakışırsa SONRAKİ
    // komutları gönderilmemeli. "Bindi" reddedilmişken "teslim edildi"yi
    // sunucuya yollamak nedenselliği bozar.
    const halted = new Set<string>();
    let failure: FlushOutcome['failure'];
    for (const item of batch) {
      if (halted.has(item.tripStudentId)) continue;
      await patchItem({ ...item, status: 'IN_FLIGHT' });
      try {
        const result = await postCommand(session, item.tripId, {
          clientEventId: item.clientEventId,
          tripStudentId: item.tripStudentId,
          action: item.action,
          expectedStateSeq: item.expectedStateSeq,
          deviceSeq: item.deviceSeq,
          occurredAtDevice: item.occurredAtDevice,
          ...(item.receiverMembershipId ? { receiverMembershipId: item.receiverMembershipId } : {}),
        });
        const next = applyServerResult(item, result);
        if (next.status === 'APPLIED') {
          await removeOutboxUnlocked(next.clientEventId);
          continue;
        }
        await patchItem(next);
        if (next.status === 'CONFLICT') {
          conflicts.push(next);
          halted.add(next.tripStudentId);
        }
        if (next.status === 'REJECTED') {
          rejected.push(next);
          halted.add(next.tripStudentId);
        }
        if (next.status === 'PENDING') halted.add(next.tripStudentId);
      } catch (error) {
        await patchItem({ ...item, status: 'PENDING' });
        if (error instanceof ApiError && (error.status === 401 || error.status === 426)) {
          throw error;
        }
        failure =
          error instanceof ApiError
            ? { code: error.code, message: error.message, offline: error.status === 0 }
            : { code: 'unknown', message: 'Komut gönderilemedi', offline: false };
        break;
      }
    }
    return { conflicts, rejected, ...(failure ? { failure } : {}) };
  });
}

/**
 * Bir öğrencinin bekleyen komutlarını düşürür ve KAÇ TANE düştüğünü söyler.
 * Sessizce silmek, şoförün kapıda kaydettiği teslimin yok olması ve bunu
 * öğrenmesinin hiçbir yolu olmaması demekti.
 */
export async function dropPendingFor(tripStudentId: string): Promise<number> {
  return runExclusive(async () => {
    const pending = memory.filter(
      (item) => item.tripStudentId === tripStudentId && item.status === 'PENDING',
    );
    for (const item of pending) {
      await removeOutboxUnlocked(item.clientEventId);
    }
    return pending.length;
  });
}

export async function removeOutbox(clientEventId: string): Promise<void> {
  await runExclusive(() => removeOutboxUnlocked(clientEventId));
}

interface OutboxRow {
  client_event_id: string;
  trip_id: string;
  trip_student_id: string;
  action: OutboxItem['action'];
  expected_state_seq: number;
  device_seq: number;
  occurred_at_device: string;
  status: string;
  conflict_state: string | null;
  conflict_state_seq: number | null;
  reject_reason: string | null;
  receiver_membership_id: string | null;
}

function coerceItem(value: unknown): OutboxItem | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<OutboxRow & OutboxItem>;
  const clientEventId = String(row.clientEventId ?? row.client_event_id ?? '');
  const tripId = String(row.tripId ?? row.trip_id ?? '');
  const tripStudentId = String(row.tripStudentId ?? row.trip_student_id ?? '');
  const action = row.action;
  if (
    !clientEventId ||
    !tripId ||
    !tripStudentId ||
    !action ||
    !(STUDENT_ACTIONS as readonly string[]).includes(action)
  ) {
    return null;
  }
  return {
    clientEventId,
    tripId,
    tripStudentId,
    action,
    expectedStateSeq: Number(row.expectedStateSeq ?? row.expected_state_seq ?? 0),
    deviceSeq: Number(row.deviceSeq ?? row.device_seq ?? 0),
    occurredAtDevice: String(row.occurredAtDevice ?? row.occurred_at_device ?? ''),
    status: asStatus(String(row.status ?? 'PENDING')),
    conflictState: (row.conflictState ??
      row.conflict_state ??
      undefined) as OutboxItem['conflictState'],
    conflictStateSeq: row.conflictStateSeq ?? row.conflict_state_seq ?? undefined,
    rejectReason: row.rejectReason ?? row.reject_reason ?? undefined,
    receiverMembershipId:
      (row.receiverMembershipId ?? row.receiver_membership_id ?? undefined) || undefined,
  };
}

function fromRow(row: OutboxRow): OutboxItem | null {
  return coerceItem(row);
}

function asStatus(value: string): OutboxStatus {
  return STATUSES.includes(value as OutboxStatus) ? (value as OutboxStatus) : 'PENDING';
}

async function persist(item: OutboxItem): Promise<void> {
  if (useMemory || !db) {
    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    return;
  }
  await db.runAsync(
    `insert or replace into outbox (
      client_event_id, trip_id, trip_student_id, action, expected_state_seq,
      device_seq, occurred_at_device, status, conflict_state, conflict_state_seq, reject_reason,
      receiver_membership_id
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.clientEventId,
    item.tripId,
    item.tripStudentId,
    item.action,
    item.expectedStateSeq,
    item.deviceSeq,
    item.occurredAtDevice,
    item.status,
    item.conflictState ?? null,
    item.conflictStateSeq ?? null,
    item.rejectReason ?? null,
    item.receiverMembershipId ?? null,
  );
}

async function patchItem(item: OutboxItem): Promise<void> {
  memory = memory.map((row) => (row.clientEventId === item.clientEventId ? item : row));
  await persist(item);
}

async function removeOutboxUnlocked(clientEventId: string): Promise<void> {
  memory = memory.filter((item) => item.clientEventId !== clientEventId);
  if (useMemory || !db) {
    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
    return;
  }
  await db.runAsync('delete from outbox where client_event_id = ?', clientEventId);
}
