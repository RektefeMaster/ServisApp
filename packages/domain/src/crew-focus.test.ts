import { describe, expect, it } from 'vitest';
import {
  completionBlockers,
  crewActionsForStudent,
  resumeOpenTrip,
  stopWorkload,
  tripFocus,
  tripGate,
  type CrewStudent,
  type CrewTripView,
} from './crew-focus.js';
import type { StudentState } from './states.js';

function student(
  overrides: Partial<CrewStudent> & Pick<CrewStudent, 'id' | 'studentId' | 'fullName'>,
): CrewStudent {
  return {
    state: 'EXPECTED',
    stateSeq: 0,
    deliveryTarget: 'SCHOOL',
    deliveryVerified: false,
    expectedStopId: 'home-stop',
    needsReview: false,
    ...overrides,
  };
}

const morning: CrewTripView = {
  segment: 'MORNING',
  state: 'ACTIVE',
  checks: { before: true, after: false },
  stops: [
    {
      id: 'home-stop',
      seq: 1,
      kind: 'PICKUP',
      label: 'Caferağa',
      lat: 40.97,
      lng: 29.06,
      addressText: 'Caferağa Sk.',
      studentIds: ['efe', 'ada'],
    },
    {
      id: 'school-stop',
      seq: 2,
      kind: 'SCHOOL',
      label: 'Güneş İlkokulu',
      lat: 40.99,
      lng: 29.03,
      addressText: 'Okul',
      studentIds: [],
    },
  ],
  students: [
    student({ id: 'ts-efe', studentId: 'efe', fullName: 'Efe Demir' }),
    student({ id: 'ts-ada', studentId: 'ada', fullName: 'Ada Demir' }),
  ],
};

describe('personel saha odağı', () => {
  it('sabah ilk durakta stop.studentIds sırasını korur', () => {
    const focus = tripFocus(morning);
    expect(focus.currentStop?.label).toBe('Caferağa');
    expect(focus.nextStudent?.fullName).toBe('Efe Demir');
    expect(focus.pendingAtStop.map((row) => row.fullName)).toEqual(['Efe Demir', 'Ada Demir']);
    expect(focus.remainingExpected).toBe(2);
  });

  it('binen çocuklar bitince odak okula kayar', () => {
    const boarded: CrewTripView = {
      ...morning,
      students: morning.students.map((row) => ({ ...row, state: 'ON_BOARD', stateSeq: 1 })),
    };
    const focus = tripFocus(boarded);
    expect(focus.currentStop?.kind).toBe('SCHOOL');
    expect(focus.destinationLabel).toBe('Güneş İlkokulu');
    expect(focus.nextStudent?.fullName).toBe('Efe Demir');
    expect(focus.remainingOnBoard).toBe(2);
    expect(crewActionsForStudent(boarded.students[0]!, 'ACTIVE', 'DRIVER')).toEqual([
      'DELIVER',
      'MARK_DELIVERY_FAILED',
    ]);
  });

  it('teslim edilemeyen çocuk hâlâ araçta sayılır', () => {
    const stuck: CrewTripView = {
      ...morning,
      students: [
        { ...morning.students[0]!, state: 'DELIVERY_FAILED', stateSeq: 2 },
        { ...morning.students[1]!, state: 'DELIVERED', stateSeq: 2 },
      ],
    };
    expect(tripFocus(stuck).remainingOnBoard).toBe(1);
    expect(tripGate(stuck)).toEqual({ kind: 'OPERATE' });
  });

  it('akşam okulda biner, ev durağında teslim eder', () => {
    const afternoon: CrewTripView = {
      segment: 'AFTERNOON',
      state: 'ACTIVE',
      checks: { before: true, after: false },
      stops: [
        {
          id: 'school-stop',
          seq: 1,
          kind: 'SCHOOL',
          label: 'Güneş İlkokulu',
          lat: 40.99,
          lng: 29.03,
          addressText: 'Okul',
          studentIds: [],
        },
        {
          id: 'home-stop',
          seq: 2,
          kind: 'DROPOFF',
          label: 'Caferağa',
          lat: 40.97,
          lng: 29.06,
          addressText: 'Caferağa Sk.',
          studentIds: ['efe'],
        },
      ],
      students: [
        student({
          id: 'ts-efe',
          studentId: 'efe',
          fullName: 'Efe Demir',
          deliveryTarget: 'HOME',
          expectedStopId: 'home-stop',
          handoverPolicy: 'MAY_LEAVE_ALONE',
        }),
      ],
    };
    expect(tripFocus(afternoon).currentStop?.kind).toBe('SCHOOL');
    const boarded: CrewTripView = {
      ...afternoon,
      students: afternoon.students.map((row) => ({ ...row, state: 'ON_BOARD', stateSeq: 1 })),
    };
    expect(tripFocus(boarded).currentStop?.kind).toBe('DROPOFF');
    expect(crewActionsForStudent(boarded.students[0]!, 'ACTIVE', 'DRIVER')).toEqual([
      'DELIVER',
      'MARK_DELIVERY_FAILED',
      'RETURN_HOME',
    ]);
  });

  it('TEMP teslimatta kod yokken Teslim eylemi çıkmaz', () => {
    const onboard = student({
      id: 'ts-efe',
      studentId: 'efe',
      fullName: 'Efe Demir',
      state: 'ON_BOARD',
      deliveryTarget: 'TEMP',
      deliveryVerified: false,
    });
    expect(crewActionsForStudent(onboard, 'ACTIVE', 'ATTENDANT')).toEqual(['MARK_DELIVERY_FAILED']);
  });

  it('sefer kapısı araç boş → başlat → işle → son kontrol → kapat', () => {
    expect(
      tripGate({ ...morning, state: 'PLANNED', checks: { before: false, after: false } }),
    ).toEqual({
      kind: 'VEHICLE_CHECK',
      phase: 'BEFORE',
    });
    expect(
      tripGate({ ...morning, state: 'READY', checks: { before: true, after: false } }),
    ).toEqual({
      kind: 'START',
    });
    expect(tripGate(morning)).toEqual({ kind: 'OPERATE' });
    const cleared: CrewTripView = {
      ...morning,
      students: morning.students.map((row) => ({ ...row, state: 'DELIVERED' })),
    };
    expect(tripGate(cleared)).toEqual({ kind: 'VEHICLE_CHECK', phase: 'AFTER' });
    expect(tripGate({ ...cleared, checks: { before: true, after: true } })).toEqual({
      kind: 'COMPLETE',
    });
  });

  it('sabah okula taşınmış çocuk okul durağında biner', () => {
    const movedIn: CrewTripView = {
      ...morning,
      students: [
        ...morning.students.map((row) => ({ ...row, state: 'ON_BOARD' as const, stateSeq: 1 })),
        student({
          id: 'ts-can',
          studentId: 'can',
          fullName: 'Can Yılmaz',
          expectedStopId: 'school-stop',
        }),
      ],
    };
    const focus = tripFocus(movedIn);
    expect(focus.currentStop?.kind).toBe('SCHOOL');
    expect(focus.pendingAtStop.map((row) => row.fullName)).toEqual([
      'Efe Demir',
      'Ada Demir',
      'Can Yılmaz',
    ]);
    expect(crewActionsForStudent(focus.pendingAtStop[2]!, 'ACTIVE', 'DRIVER')).toEqual([
      'BOARD',
      'MARK_NO_SHOW',
    ]);
  });

  it('öldürülen uygulamada ACTIVE seferi öne alır', () => {
    expect(
      resumeOpenTrip(
        [
          { id: 'planned', state: 'PLANNED' },
          { id: 'live', state: 'ACTIVE' },
        ],
        'planned',
      ),
    ).toEqual({ id: 'live', reason: 'ACTIVE' });
    expect(resumeOpenTrip([{ id: 'planned', state: 'PLANNED' }], 'planned')).toEqual({
      id: 'planned',
      reason: 'LAST_OPEN',
    });
  });
});

describe('completionBlockers', () => {
  function tripWith(states: StudentState[]): CrewTripView {
    return {
      segment: 'AFTERNOON',
      state: 'ACTIVE',
      checks: { before: true, after: false },
      stops: [],
      students: states.map((state, index) => ({
        id: `ts${String(index)}`,
        studentId: `s${String(index)}`,
        fullName: `Çocuk ${String(index)}`,
        state,
        stateSeq: 0,
        deliveryTarget: 'HOME' as const,
        deliveryVerified: false,
        expectedStopId: null,
        needsReview: false,
      })),
    };
  }

  it('teslim edilemeyen çocuğu yönetici gerektiren engel olarak bildirir', () => {
    const blockers = completionBlockers(tripWith(['DELIVERED', 'DELIVERY_FAILED']));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.needsAdmin).toBe(true);
    expect(blockers[0]?.fullName).toBe('Çocuk 1');
  });

  it('araçtaki çocuk şoförün çözebileceği engeldir', () => {
    const blockers = completionBlockers(tripWith(['ON_BOARD']));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.needsAdmin).toBe(false);
  });

  it('herkes çözülmüşse engel yoktur', () => {
    expect(completionBlockers(tripWith(['DELIVERED', 'NO_SHOW', 'ABSENT_PLANNED']))).toEqual([]);
  });
});

describe('kapı sayacı', () => {
  const afternoon: CrewTripView = {
    segment: 'AFTERNOON',
    state: 'ACTIVE',
    checks: { before: true, after: false },
    stops: [
      {
        id: 'school-stop',
        seq: 1,
        kind: 'SCHOOL',
        label: 'Güneş İlkokulu',
        lat: 40.99,
        lng: 29.03,
        addressText: 'Okul',
        studentIds: [],
      },
      {
        id: 'home-stop',
        seq: 2,
        kind: 'DROPOFF',
        label: 'Caferağa',
        lat: 40.97,
        lng: 29.06,
        addressText: 'Caferağa Sk.',
        studentIds: ['efe', 'ada'],
      },
    ],
    students: [
      student({
        id: 'ts-efe',
        studentId: 'efe',
        fullName: 'Efe Demir',
        deliveryTarget: 'HOME',
        expectedStopId: 'home-stop',
      }),
      student({
        id: 'ts-ada',
        studentId: 'ada',
        fullName: 'Ada Demir',
        deliveryTarget: 'HOME',
        expectedStopId: 'home-stop',
      }),
    ],
  };
  const schoolStop = afternoon.stops[0]!;
  const homeStop = afternoon.stops[1]!;

  it('akşam okul kapısında binecek herkesi sayar', () => {
    // Öğrenciler iniş duraklarına bağlı; okul kapısında üyelikleri yok.
    expect(stopWorkload(afternoon, schoolStop)).toEqual({ done: 0, total: 2 });
  });

  it('okulda her binişte ilerler', () => {
    const half: CrewTripView = {
      ...afternoon,
      students: [
        { ...afternoon.students[0]!, state: 'ON_BOARD', stateSeq: 1 },
        afternoon.students[1]!,
      ],
    };
    expect(stopWorkload(half, schoolStop)).toEqual({ done: 1, total: 2 });
  });

  it('bugün binmeyecek çocuk hiçbir kapıda sayılmaz', () => {
    const absent: CrewTripView = {
      ...afternoon,
      students: [{ ...afternoon.students[0]!, state: 'ABSENT_PLANNED' }, afternoon.students[1]!],
    };
    expect(stopWorkload(absent, schoolStop)).toEqual({ done: 0, total: 1 });
    // İniş kapısı yalnız araca binmiş çocuğu işler: binmemiş çocuk bu kapının
    // işi değildir, sefer sonu engelleri onu ayrıca gösterir.
    expect(stopWorkload(absent, homeStop)).toEqual({ done: 0, total: 0 });
  });

  it('iniş durağında teslim edileni biten sayar', () => {
    const arrived: CrewTripView = {
      ...afternoon,
      students: [
        { ...afternoon.students[0]!, state: 'DELIVERED', stateSeq: 2 },
        { ...afternoon.students[1]!, state: 'ON_BOARD', stateSeq: 1 },
      ],
    };
    expect(stopWorkload(arrived, homeStop)).toEqual({ done: 1, total: 2 });
  });

  it('sabah okul kapısında yalnız araca binmiş olanları sayar', () => {
    const arrivedAtSchool: CrewTripView = {
      ...morning,
      students: [
        { ...morning.students[0]!, state: 'ON_BOARD', stateSeq: 1 },
        { ...morning.students[1]!, state: 'NO_SHOW', stateSeq: 1 },
      ],
    };
    const school = morning.stops[1]!;
    expect(stopWorkload(arrivedAtSchool, school)).toEqual({ done: 0, total: 1 });
  });
});
