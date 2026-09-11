import type {
  CloneRouteVersionInput,
  CreateRouteInput,
  CreateStopInput,
  ReplaceRouteStopsInput,
} from '@servisapp/contracts';
import {
  address,
  route,
  routeStop,
  routeStopStudent,
  routeVersion,
  school,
  stop,
  student,
  vehicle,
  withTenant,
  type Database,
} from '@servisapp/db';
import {
  evaluateRouteCapacity,
  evaluateRoutePlan,
  exhaustive,
  hasUsableCoordinates,
  suggestWaypointOrder,
  type RoutePlanIssue,
  type RoutePlanStop,
  type RouteSegment,
} from '@servisapp/domain';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { badRequest, conflict, HttpError, notFound } from '../http-error.js';
import { mapDbError } from './db-error.js';
import type { RouteAdminPort, RouteVersionView } from './ports.js';

export function createRouteAdminPort(db: Database): RouteAdminPort {
  return {
    createStop(tenantId, input: CreateStopInput) {
      return withAdmin(db, tenantId, async (tx) => {
        const [owned] = await tx
          .select({ id: address.id })
          .from(address)
          .where(and(eq(address.id, input.addressId), eq(address.tenantId, tenantId)));
        if (!owned) throw badRequest('invalid_reference', 'Adres bulunamadı');
        const [row] = await tx
          .insert(stop)
          .values({
            tenantId,
            addressId: input.addressId,
            label: input.label,
            lat: input.lat,
            lng: input.lng,
          })
          .returning({ id: stop.id });
        if (!row) throw new HttpError(500, 'insert_failed', 'Durak kaydedilemedi');
        return row;
      });
    },

    listStops(tenantId) {
      return withAdmin(db, tenantId, async (tx) => {
        return tx
          .select({
            id: stop.id,
            label: stop.label,
            lat: stop.lat,
            lng: stop.lng,
            addressId: stop.addressId,
          })
          .from(stop);
      });
    },

    createRoute(tenantId, input: CreateRouteInput) {
      return withAdmin(db, tenantId, async (tx) => {
        const [ownedVehicle] = await tx
          .select({ id: vehicle.id })
          .from(vehicle)
          .where(and(eq(vehicle.id, input.vehicleId), eq(vehicle.tenantId, tenantId)));
        if (!ownedVehicle) throw badRequest('invalid_reference', 'Araç bulunamadı');
        const [ownedSchool] = await tx
          .select({ id: school.id })
          .from(school)
          .where(and(eq(school.id, input.schoolId), eq(school.tenantId, tenantId)));
        if (!ownedSchool) throw badRequest('invalid_reference', 'Okul bulunamadı');

        const [created] = await tx
          .insert(route)
          .values({
            tenantId,
            vehicleId: input.vehicleId,
            schoolId: input.schoolId,
            segment: input.segment,
            shiftNo: input.shiftNo,
            maxDetourM: input.maxDetourM,
          })
          .returning({ id: route.id });
        if (!created) throw new HttpError(500, 'insert_failed', 'Rota kaydedilemedi');

        const [draft] = await tx
          .insert(routeVersion)
          .values({
            tenantId,
            routeId: created.id,
            versionNo: 1,
            status: 'DRAFT',
            effectiveFrom: input.effectiveFrom,
          })
          .returning({ id: routeVersion.id });
        if (!draft) throw new HttpError(500, 'insert_failed', 'Rota taslağı kaydedilemedi');
        return { id: created.id, draftVersionId: draft.id };
      });
    },

    listRoutes(tenantId) {
      return withAdmin(db, tenantId, async (tx) => {
        const routes = await tx
          .select({
            id: route.id,
            vehicleId: route.vehicleId,
            schoolId: route.schoolId,
            segment: route.segment,
            shiftNo: route.shiftNo,
          })
          .from(route);
        const versions = await tx
          .select({
            id: routeVersion.id,
            routeId: routeVersion.routeId,
            status: routeVersion.status,
            versionNo: routeVersion.versionNo,
          })
          .from(routeVersion);

        return routes.map((item) => {
          const related = versions.filter((version) => version.routeId === item.id);
          const published = related.find((version) => version.status === 'PUBLISHED');
          const draft = related
            .filter((version) => version.status === 'DRAFT')
            .sort((a, b) => b.versionNo - a.versionNo)[0];
          return {
            id: item.id,
            vehicleId: item.vehicleId,
            schoolId: item.schoolId,
            segment: item.segment,
            shiftNo: item.shiftNo,
            publishedVersionId: published?.id ?? null,
            draftVersionId: draft?.id ?? null,
          };
        });
      });
    },

    getRoute(tenantId, routeId) {
      return withAdmin(db, tenantId, async (tx) => {
        const [item] = await tx
          .select({
            id: route.id,
            vehicleId: route.vehicleId,
            schoolId: route.schoolId,
            segment: route.segment,
            shiftNo: route.shiftNo,
            maxDetourM: route.maxDetourM,
          })
          .from(route)
          .where(and(eq(route.id, routeId), eq(route.tenantId, tenantId)));
        if (!item) return null;

        const versions = await tx
          .select({
            id: routeVersion.id,
            versionNo: routeVersion.versionNo,
            status: routeVersion.status,
            effectiveFrom: routeVersion.effectiveFrom,
          })
          .from(routeVersion)
          .where(and(eq(routeVersion.routeId, routeId), eq(routeVersion.tenantId, tenantId)))
          .orderBy(asc(routeVersion.versionNo));

        return {
          ...item,
          versions: versions.map((version) => ({
            id: version.id,
            versionNo: version.versionNo,
            status: version.status,
            effectiveFrom: dateOnly(version.effectiveFrom),
          })),
        };
      });
    },

    getRouteVersion(tenantId, versionId) {
      return withAdmin(db, tenantId, (tx) => loadVersionView(tx, tenantId, versionId));
    },

    replaceRouteStops(tenantId, versionId, input: ReplaceRouteStopsInput) {
      return withAdmin(db, tenantId, async (tx) => {
        const ctx = await requireDraft(tx, tenantId, versionId);
        assertReplacePayload(input);
        await assertStopsAndStudents(tx, tenantId, ctx.schoolId, ctx.segment, input);
        await rewriteStops(tx, tenantId, versionId, input);
        const view = await loadVersionView(tx, tenantId, versionId);
        if (!view) throw new HttpError(500, 'insert_failed', 'Rota durakları okunamadı');
        return view;
      });
    },

    suggestRouteStopOrder(tenantId, versionId) {
      return withAdmin(db, tenantId, async (tx) => {
        await requireDraft(tx, tenantId, versionId);
        const view = await loadVersionView(tx, tenantId, versionId);
        if (!view) throw notFound('Rota sürümü bulunamadı');
        const schools = view.stops.filter((item) => item.kind === 'SCHOOL');
        if (schools.length === 0) {
          throw badRequest('missing_school_stop', 'Sıra önerisi için okul durağı gerekli');
        }
        if (schools.length > 1) {
          throw badRequest('multiple_school_stops', 'Rotada tek okul durağı olmalı');
        }
        const schoolStop = schools[0];
        if (!schoolStop) {
          throw badRequest('missing_school_stop', 'Sıra önerisi için okul durağı gerekli');
        }
        const plan = evaluateRoutePlan(view.segment, toPlanStops(view));
        if (!plan.ok && plan.issue.code !== 'INVALID_SEQUENCE') {
          throw routePlanHttpError(plan.issue);
        }
        const others = view.stops.filter((item) => item.kind !== 'SCHOOL');
        const orderedStopIds = suggestWaypointOrder({
          school: { id: schoolStop.stopId, lat: schoolStop.lat, lng: schoolStop.lng },
          stops: others.map((item) => ({ id: item.stopId, lat: item.lat, lng: item.lng })),
          schoolAnchor: view.segment === 'MORNING' ? 'end' : 'start',
        });
        await shiftSeqThenAssign(tx, tenantId, view.stops, orderedStopIds);
        const next = await loadVersionView(tx, tenantId, versionId);
        if (!next) throw new HttpError(500, 'insert_failed', 'Rota durakları okunamadı');
        return next;
      });
    },

    publishRouteVersion(tenantId, versionId) {
      return withAdmin(db, tenantId, async (tx) => {
        const ctx = await requireDraft(tx, tenantId, versionId);
        const view = await loadVersionView(tx, tenantId, versionId);
        if (!view) throw notFound('Rota sürümü bulunamadı');

        const plan = evaluateRoutePlan(view.segment, toPlanStops(view));
        if (!plan.ok) throw routePlanHttpError(plan.issue);

        const capacity = evaluateRouteCapacity(view.segment, toPlanStops(view), view.seatCount);
        if (!capacity.ok) {
          throw badRequest(
            'capacity_exceeded',
            `Anlık zirve ${capacity.peak} öğrenci, araçta ${capacity.seatCount} koltuk var`,
          );
        }

        await assertPublishGuards(tx, tenantId, view);

        await assertStudentsFreeForSegment(
          tx,
          tenantId,
          ctx.routeId,
          view.segment,
          view.stops.flatMap((item) => item.studentIds),
        );

        await tx.execute(
          sql`select id from route_version
              where route_id = ${ctx.routeId}::uuid
                and tenant_id = ${tenantId}::uuid
                and status in ('PUBLISHED', 'DRAFT')
              for update`,
        );

        await tx
          .update(routeVersion)
          .set({ status: 'ARCHIVED' })
          .where(
            and(
              eq(routeVersion.tenantId, tenantId),
              eq(routeVersion.routeId, ctx.routeId),
              eq(routeVersion.status, 'PUBLISHED'),
            ),
          );
        await tx
          .update(routeVersion)
          .set({ status: 'PUBLISHED' })
          .where(and(eq(routeVersion.id, versionId), eq(routeVersion.tenantId, tenantId)));

        const published = await loadVersionView(tx, tenantId, versionId);
        if (!published) throw new HttpError(500, 'insert_failed', 'Yayınlanan sürüm okunamadı');
        return published;
      });
    },

    cloneRouteVersion(tenantId, routeId, input: CloneRouteVersionInput) {
      return withAdmin(db, tenantId, async (tx) => {
        const [owned] = await tx
          .select({ id: route.id })
          .from(route)
          .where(and(eq(route.id, routeId), eq(route.tenantId, tenantId)));
        if (!owned) throw notFound('Rota bulunamadı');

        await tx.execute(
          sql`select id from route_version where route_id = ${routeId}::uuid and tenant_id = ${tenantId}::uuid for update`,
        );

        const versions = await tx
          .select({
            id: routeVersion.id,
            versionNo: routeVersion.versionNo,
            status: routeVersion.status,
            effectiveFrom: routeVersion.effectiveFrom,
          })
          .from(routeVersion)
          .where(and(eq(routeVersion.routeId, routeId), eq(routeVersion.tenantId, tenantId)))
          .orderBy(asc(routeVersion.versionNo));
        if (versions.length === 0) throw notFound('Rota sürümü bulunamadı');
        if (versions.some((version) => version.status === 'DRAFT')) {
          throw conflict('draft_exists', 'Bu rotada zaten bir taslak var');
        }

        const published = [...versions].reverse().find((version) => version.status === 'PUBLISHED');
        const source =
          (input.fromVersionId
            ? versions.find((version) => version.id === input.fromVersionId)
            : (published ?? versions[versions.length - 1])) ?? null;
        if (!source) throw notFound('Kaynak sürüm bulunamadı');

        const nextNo = Math.max(...versions.map((version) => version.versionNo)) + 1;
        const [created] = await tx
          .insert(routeVersion)
          .values({
            tenantId,
            routeId,
            versionNo: nextNo,
            status: 'DRAFT',
            effectiveFrom: dateOnly(source.effectiveFrom),
          })
          .returning({ id: routeVersion.id, versionNo: routeVersion.versionNo });
        if (!created) throw new HttpError(500, 'insert_failed', 'Yeni taslak açılamadı');

        const sourceView = await loadVersionView(tx, tenantId, source.id);
        if (sourceView && sourceView.stops.length > 0) {
          await rewriteStops(tx, tenantId, created.id, {
            stops: sourceView.stops.map((item) => ({
              stopId: item.stopId,
              kind: item.kind,
              seq: item.seq,
              studentIds: item.studentIds,
            })),
          });
        }
        return created;
      });
    },
  };
}

async function withAdmin<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  try {
    return await withTenant(db, { tenantId, membershipId: '', role: 'ADMIN' }, fn);
  } catch (error) {
    mapDbError(error);
  }
}

async function requireDraft(
  tx: Database,
  tenantId: string,
  versionId: string,
): Promise<{ routeId: string; schoolId: string; segment: RouteSegment }> {
  await tx.execute(
    sql`select id from route_version where id = ${versionId}::uuid and tenant_id = ${tenantId}::uuid for update`,
  );
  const [row] = await tx
    .select({
      id: routeVersion.id,
      status: routeVersion.status,
      routeId: routeVersion.routeId,
      schoolId: route.schoolId,
      segment: route.segment,
    })
    .from(routeVersion)
    .innerJoin(route, and(eq(route.id, routeVersion.routeId), eq(route.tenantId, tenantId)))
    .where(and(eq(routeVersion.id, versionId), eq(routeVersion.tenantId, tenantId)));
  if (!row) throw notFound('Rota sürümü bulunamadı');
  if (row.status !== 'DRAFT') {
    throw conflict('version_not_draft', 'Yalnız taslak sürüm düzenlenebilir');
  }
  return { routeId: row.routeId, schoolId: row.schoolId, segment: row.segment };
}

function assertReplacePayload(input: ReplaceRouteStopsInput): void {
  const seqs = new Set<number>();
  const stopIds = new Set<string>();
  const studentIds = new Set<string>();
  for (const item of input.stops) {
    if (seqs.has(item.seq)) {
      throw badRequest('invalid_sequence', 'Durak sırası 1..n olmalı');
    }
    seqs.add(item.seq);
    if (stopIds.has(item.stopId)) {
      throw badRequest('duplicate_stop', 'Aynı durak rotada iki kez olamaz');
    }
    stopIds.add(item.stopId);
    if (item.kind === 'SCHOOL' && item.studentIds.length > 0) {
      throw badRequest('student_on_school_stop', 'Öğrenci okul durağına bağlanmaz');
    }
    for (const studentId of item.studentIds) {
      if (studentIds.has(studentId)) {
        throw badRequest('duplicate_student', 'Öğrenci rotada bir kez yer alır');
      }
      studentIds.add(studentId);
    }
  }
  for (let i = 1; i <= input.stops.length; i += 1) {
    if (!seqs.has(i)) throw badRequest('invalid_sequence', 'Durak sırası 1..n olmalı');
  }
}

async function assertStopsAndStudents(
  tx: Database,
  tenantId: string,
  schoolId: string,
  segment: RouteSegment,
  input: ReplaceRouteStopsInput,
): Promise<void> {
  const stopIds = [...new Set(input.stops.map((item) => item.stopId))];
  const foundStops = await tx
    .select({ id: stop.id })
    .from(stop)
    .where(and(eq(stop.tenantId, tenantId), inArray(stop.id, stopIds)));
  if (foundStops.length !== stopIds.length) {
    throw badRequest('invalid_reference', 'Durak bulunamadı');
  }

  const studentIds = [...new Set(input.stops.flatMap((item) => item.studentIds))];
  if (studentIds.length === 0) return;
  const foundStudents = await tx
    .select({
      id: student.id,
      schoolId: student.schoolId,
      enrollmentEnd: student.enrollmentEnd,
      usesMorning: student.usesMorning,
      usesEvening: student.usesEvening,
    })
    .from(student)
    .where(and(eq(student.tenantId, tenantId), inArray(student.id, studentIds)));
  if (foundStudents.length !== studentIds.length) {
    throw badRequest('invalid_reference', 'Öğrenci bulunamadı');
  }
  if (foundStudents.some((item) => item.schoolId !== schoolId)) {
    throw badRequest('student_wrong_school', 'Öğrenci bu rotanın okuluna kayıtlı değil');
  }
  if (foundStudents.some((item) => item.enrollmentEnd)) {
    throw badRequest('student_ended', 'Pasif öğrenci rotaya yazılmaz');
  }
  switch (segment) {
    case 'MORNING':
      if (foundStudents.some((item) => !item.usesMorning)) {
        throw badRequest('student_segment_mismatch', 'Öğrenci bu segmentte servis kullanmıyor');
      }
      break;
    case 'AFTERNOON':
      if (foundStudents.some((item) => !item.usesEvening)) {
        throw badRequest('student_segment_mismatch', 'Öğrenci bu segmentte servis kullanmıyor');
      }
      break;
    default: {
      const unexpected: never = segment;
      void unexpected;
      throw new Error('unknown segment');
    }
  }
}

async function assertPublishGuards(
  tx: Database,
  tenantId: string,
  view: RouteVersionView,
): Promise<void> {
  if (view.stops.length === 0) {
    throw badRequest('empty_route', 'Rotada durak yok');
  }
  const [schoolRow] = await tx
    .select({
      addressId: school.addressId,
      lat: address.lat,
      lng: address.lng,
    })
    .from(school)
    .innerJoin(address, and(eq(address.id, school.addressId), eq(address.tenantId, tenantId)))
    .where(and(eq(school.id, view.schoolId), eq(school.tenantId, tenantId)));
  if (!schoolRow || !hasUsableCoordinates(schoolRow.lat, schoolRow.lng)) {
    throw badRequest('invalid_school_address', 'Okul adresi geçersiz veya koordinatsız');
  }
  for (const stopRow of view.stops) {
    if (!hasUsableCoordinates(stopRow.lat, stopRow.lng)) {
      throw badRequest('missing_stop_coordinates', 'Durak koordinatı yok');
    }
  }
  const studentIds = [...new Set(view.stops.flatMap((item) => item.studentIds))];
  if (studentIds.length === 0) {
    throw badRequest('need_passenger_stop', 'Okul dışında en az bir durak gerekli');
  }
  const enrolled = await tx
    .select({
      id: student.id,
      enrollmentEnd: student.enrollmentEnd,
      suspended: student.suspended,
      usesMorning: student.usesMorning,
      usesEvening: student.usesEvening,
    })
    .from(student)
    .where(and(eq(student.tenantId, tenantId), inArray(student.id, studentIds)));
  if (enrolled.length !== studentIds.length) {
    throw badRequest('student_not_found', 'Rotadaki öğrenci bulunamadı');
  }
  if (enrolled.some((item) => item.enrollmentEnd)) {
    throw badRequest('student_ended', 'Pasif öğrenci yayınlı rotada olamaz');
  }
  if (enrolled.some((item) => item.suspended)) {
    throw badRequest('student_suspended', 'Askıdaki öğrenci yayınlı rotada olamaz');
  }
  switch (view.segment) {
    case 'MORNING':
      if (enrolled.some((item) => !item.usesMorning)) {
        throw badRequest('student_segment_mismatch', 'Öğrenci bu segmentte servis kullanmıyor');
      }
      break;
    case 'AFTERNOON':
      if (enrolled.some((item) => !item.usesEvening)) {
        throw badRequest('student_segment_mismatch', 'Öğrenci bu segmentte servis kullanmıyor');
      }
      break;
    default: {
      const unexpected: never = view.segment;
      void unexpected;
      throw new Error('unknown segment');
    }
  }
}

async function assertStudentsFreeForSegment(
  tx: Database,
  tenantId: string,
  routeId: string,
  segment: RouteSegment,
  studentIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(studentIds)].sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) return;

  for (const id of unique) {
    await tx.execute(
      sql`select id from student where id = ${id}::uuid and tenant_id = ${tenantId}::uuid for update`,
    );
  }

  const taken = await tx
    .select({ studentId: routeStopStudent.studentId })
    .from(routeStopStudent)
    .innerJoin(
      routeStop,
      and(eq(routeStop.id, routeStopStudent.routeStopId), eq(routeStop.tenantId, tenantId)),
    )
    .innerJoin(
      routeVersion,
      and(
        eq(routeVersion.id, routeStop.routeVersionId),
        eq(routeVersion.tenantId, tenantId),
        eq(routeVersion.status, 'PUBLISHED'),
      ),
    )
    .innerJoin(
      route,
      and(
        eq(route.id, routeVersion.routeId),
        eq(route.tenantId, tenantId),
        eq(route.segment, segment),
        ne(route.id, routeId),
      ),
    )
    .where(
      and(eq(routeStopStudent.tenantId, tenantId), inArray(routeStopStudent.studentId, unique)),
    );
  if (taken.length > 0) {
    throw conflict('student_already_on_route', 'Öğrenci bu sefer türünde başka bir yayınlı rotada');
  }
}

async function rewriteStops(
  tx: Database,
  tenantId: string,
  versionId: string,
  input: ReplaceRouteStopsInput,
): Promise<void> {
  const existing = await tx
    .select({ id: routeStop.id })
    .from(routeStop)
    .where(and(eq(routeStop.routeVersionId, versionId), eq(routeStop.tenantId, tenantId)));
  const existingIds = existing.map((row) => row.id);
  if (existingIds.length > 0) {
    await tx
      .delete(routeStopStudent)
      .where(
        and(
          eq(routeStopStudent.tenantId, tenantId),
          inArray(routeStopStudent.routeStopId, existingIds),
        ),
      );
    await tx
      .delete(routeStop)
      .where(and(eq(routeStop.routeVersionId, versionId), eq(routeStop.tenantId, tenantId)));
  }

  for (const item of input.stops) {
    const [created] = await tx
      .insert(routeStop)
      .values({
        tenantId,
        routeVersionId: versionId,
        stopId: item.stopId,
        seq: item.seq,
        kind: item.kind,
      })
      .returning({ id: routeStop.id });
    if (!created) throw new HttpError(500, 'insert_failed', 'Rota durağı kaydedilemedi');
    if (item.studentIds.length === 0) continue;
    await tx.insert(routeStopStudent).values(
      item.studentIds.map((studentId) => ({
        tenantId,
        routeStopId: created.id,
        studentId,
      })),
    );
  }
}

async function shiftSeqThenAssign(
  tx: Database,
  tenantId: string,
  current: RouteVersionView['stops'],
  orderedStopIds: string[],
): Promise<void> {
  const uniqueOrdered = new Set(orderedStopIds);
  if (uniqueOrdered.size !== orderedStopIds.length || orderedStopIds.length !== current.length) {
    throw new HttpError(500, 'suggest_incomplete', 'Sıra önerisi tüm durakları kapsamadı');
  }
  const byStopId = new Map(current.map((item) => [item.stopId, item]));
  for (const stopId of orderedStopIds) {
    if (!byStopId.has(stopId)) {
      throw badRequest('invalid_reference', 'Sıra önerisi bilinmeyen durak döndürdü');
    }
  }
  for (const item of current) {
    await tx
      .update(routeStop)
      .set({ seq: item.seq + 1000 })
      .where(and(eq(routeStop.id, item.id), eq(routeStop.tenantId, tenantId)));
  }
  for (let i = 0; i < orderedStopIds.length; i += 1) {
    const stopId = orderedStopIds[i];
    if (!stopId) continue;
    const row = byStopId.get(stopId);
    if (!row) throw badRequest('invalid_reference', 'Sıra önerisi bilinmeyen durak döndürdü');
    await tx
      .update(routeStop)
      .set({ seq: i + 1 })
      .where(and(eq(routeStop.id, row.id), eq(routeStop.tenantId, tenantId)));
  }
}

async function loadVersionView(
  tx: Database,
  tenantId: string,
  versionId: string,
): Promise<RouteVersionView | null> {
  const [header] = await tx
    .select({
      id: routeVersion.id,
      routeId: routeVersion.routeId,
      versionNo: routeVersion.versionNo,
      status: routeVersion.status,
      effectiveFrom: routeVersion.effectiveFrom,
      segment: route.segment,
      vehicleId: route.vehicleId,
      schoolId: route.schoolId,
      seatCount: vehicle.seatCount,
    })
    .from(routeVersion)
    .innerJoin(route, and(eq(route.id, routeVersion.routeId), eq(route.tenantId, tenantId)))
    .innerJoin(vehicle, and(eq(vehicle.id, route.vehicleId), eq(vehicle.tenantId, tenantId)))
    .where(and(eq(routeVersion.id, versionId), eq(routeVersion.tenantId, tenantId)));
  if (!header) return null;

  const stopRows = await tx
    .select({
      id: routeStop.id,
      stopId: routeStop.stopId,
      seq: routeStop.seq,
      kind: routeStop.kind,
      label: stop.label,
      lat: stop.lat,
      lng: stop.lng,
    })
    .from(routeStop)
    .innerJoin(stop, and(eq(stop.id, routeStop.stopId), eq(stop.tenantId, tenantId)))
    .where(and(eq(routeStop.routeVersionId, versionId), eq(routeStop.tenantId, tenantId)))
    .orderBy(asc(routeStop.seq));

  const stopPk = stopRows.map((row) => row.id);
  const students =
    stopPk.length === 0
      ? []
      : await tx
          .select({
            routeStopId: routeStopStudent.routeStopId,
            studentId: routeStopStudent.studentId,
          })
          .from(routeStopStudent)
          .where(
            and(
              eq(routeStopStudent.tenantId, tenantId),
              inArray(routeStopStudent.routeStopId, stopPk),
            ),
          );

  const studentsByStop = new Map<string, string[]>();
  for (const row of students) {
    const list = studentsByStop.get(row.routeStopId) ?? [];
    list.push(row.studentId);
    studentsByStop.set(row.routeStopId, list);
  }
  for (const list of studentsByStop.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }

  return {
    id: header.id,
    routeId: header.routeId,
    versionNo: header.versionNo,
    status: header.status,
    effectiveFrom: dateOnly(header.effectiveFrom),
    segment: header.segment,
    vehicleId: header.vehicleId,
    schoolId: header.schoolId,
    seatCount: header.seatCount,
    stops: stopRows.map((row) => ({
      id: row.id,
      stopId: row.stopId,
      seq: row.seq,
      kind: row.kind,
      label: row.label,
      lat: row.lat,
      lng: row.lng,
      studentIds: studentsByStop.get(row.id) ?? [],
    })),
  };
}

function toPlanStops(view: RouteVersionView): RoutePlanStop[] {
  return view.stops.map((item) => ({
    stopId: item.stopId,
    seq: item.seq,
    kind: item.kind,
    studentIds: item.studentIds,
  }));
}

function dateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match?.[1]) return match[1];
    throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
  }
  if (Number.isNaN(value.getTime())) {
    throw new HttpError(500, 'invalid_date', 'Tarih okunamadı');
  }
  const utcMidnight =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;
  if (utcMidnight) return value.toISOString().slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function routePlanHttpError(issue: RoutePlanIssue): HttpError {
  switch (issue.code) {
    case 'EMPTY_ROUTE':
      return badRequest('empty_route', 'Rotada durak yok');
    case 'NEED_PASSENGER_STOP':
      return badRequest('need_passenger_stop', 'Okul dışında en az bir durak gerekli');
    case 'MISSING_SCHOOL_STOP':
      return badRequest('missing_school_stop', 'Rotada okul durağı zorunlu');
    case 'MULTIPLE_SCHOOL_STOPS':
      return badRequest('multiple_school_stops', 'Rotada tek okul durağı olmalı');
    case 'INVALID_SEQUENCE':
      return badRequest('invalid_sequence', 'Durak sırası 1..n olmalı');
    case 'DUPLICATE_STOP':
      return badRequest('duplicate_stop', 'Aynı durak rotada iki kez olamaz');
    case 'WRONG_KIND_FOR_SEGMENT':
      return badRequest('wrong_stop_kind', `Bu sefer türünde ${issue.kind} durağı olmaz`);
    case 'SCHOOL_POSITION':
      return badRequest(
        'school_position',
        issue.expected === 'end'
          ? 'Sabah rotasında okul sonda olmalı'
          : 'Akşam rotasında okul başta olmalı',
      );
    case 'PASSENGER_STOP_EMPTY':
      return badRequest('passenger_stop_empty', `${issue.seq}. durakta öğrenci yok`);
    case 'STUDENT_ON_SCHOOL_STOP':
      return badRequest('student_on_school_stop', 'Öğrenci okul durağına bağlanmaz');
    case 'DUPLICATE_STUDENT':
      return badRequest('duplicate_student', 'Öğrenci rotada bir kez yer alır');
    default: {
      const unexpected: never = issue;
      return exhaustive(unexpected, 'route plan');
    }
  }
}
