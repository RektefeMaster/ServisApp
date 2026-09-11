import type {
  CancelTripInput,
  CloneRouteVersionInput,
  CommitImportInput,
  CreateAddressChangeInput,
  CreateDeliveryOverrideInput,
  CreateGuardianInput,
  CreateHolidayInput,
  CreateRouteInput,
  CreateSchoolInput,
  CreateStaffInput,
  CreateStopInput,
  CreateStudentInput,
  CreateRideExceptionInput,
  CreateVehicleInput,
  GenerateTripsInput,
  PinAddressInput,
  PlatformConfig,
  AdminEventsList,
  AdminPrioritiesList,
  AssignTripCrewInput,
  AssignTripVehicleInput,
  CreateStudentTripMoveInput,
  LocationIngestResult,
  LocationPingInput,
  ParentDayPlan,
  StudentTripMoveResult,
  ParentHome,
  ParentTrackingView,
  PreviewImportInput,
  RecordVehicleCheckInput,
  ReplaceRouteStopsInput,
  ReportIncidentInput,
  SessionSnapshot,
  StudentCommandInput,
  UndoStudentCommandInput,
  VehicleBroadcast,
  VerifyDeliveryOtpInput,
  AdminOverrideDeliveryInput,
  AdminExceptionsList,
  DeliveryOverrideView,
  RideExceptionView,
  AddressChangeView,
} from '@servisapp/contracts';
import type { MembershipRole } from '@servisapp/contracts';

export interface DevLoginIdentity {
  authUserId: string | null;
  identityId: string;
  fullName: string;
  phone: string;
  email: string;
  hasCrewRole: boolean;
}

export interface DevParentIdentity {
  authUserId: string | null;
  identityId: string;
  fullName: string;
  phone: string;
  email: string | null;
}

export interface SessionPort {
  resolve(input: {
    authUserId: string;
    phone: string | null;
    email: string | null;
  }): Promise<SessionSnapshot>;
  findDevLoginIdentity(email: string): Promise<DevLoginIdentity | null>;
  findDevParentIdentity(phone: string): Promise<DevParentIdentity | null>;
}

export interface RouteStopView {
  id: string;
  stopId: string;
  seq: number;
  kind: 'PICKUP' | 'DROPOFF' | 'SCHOOL';
  label: string;
  lat: number;
  lng: number;
  studentIds: string[];
}

export interface RouteVersionView {
  id: string;
  routeId: string;
  versionNo: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  effectiveFrom: string;
  segment: 'MORNING' | 'AFTERNOON';
  vehicleId: string;
  schoolId: string;
  seatCount: number;
  stops: RouteStopView[];
}

export interface RouteSummary {
  id: string;
  vehicleId: string;
  schoolId: string;
  segment: 'MORNING' | 'AFTERNOON';
  shiftNo: number;
  publishedVersionId: string | null;
  draftVersionId: string | null;
}

export interface RouteDetail {
  id: string;
  vehicleId: string;
  schoolId: string;
  segment: 'MORNING' | 'AFTERNOON';
  shiftNo: number;
  maxDetourM: number;
  versions: Array<{
    id: string;
    versionNo: number;
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    effectiveFrom: string;
  }>;
}

export interface RouteAdminPort {
  createStop(tenantId: string, input: CreateStopInput): Promise<{ id: string }>;
  listStops(
    tenantId: string,
  ): Promise<Array<{ id: string; label: string; lat: number; lng: number; addressId: string }>>;
  createRoute(
    tenantId: string,
    input: CreateRouteInput,
  ): Promise<{ id: string; draftVersionId: string }>;
  listRoutes(tenantId: string): Promise<RouteSummary[]>;
  getRoute(tenantId: string, routeId: string): Promise<RouteDetail | null>;
  getRouteVersion(tenantId: string, versionId: string): Promise<RouteVersionView | null>;
  replaceRouteStops(
    tenantId: string,
    versionId: string,
    input: ReplaceRouteStopsInput,
  ): Promise<RouteVersionView>;
  suggestRouteStopOrder(tenantId: string, versionId: string): Promise<RouteVersionView>;
  publishRouteVersion(tenantId: string, versionId: string): Promise<RouteVersionView>;
  cloneRouteVersion(
    tenantId: string,
    routeId: string,
    input: CloneRouteVersionInput,
  ): Promise<{ id: string; versionNo: number }>;
}

export interface TripActor {
  membershipId: string;
  roles: MembershipRole[];
  deviceId: string | null;
  platform: 'IOS' | 'ANDROID';
  appVersion: string | null;
}

export interface TripSummary {
  id: string;
  routeId: string;
  serviceDate: string;
  segment: 'MORNING' | 'AFTERNOON';
  state: string;
  plannedDepartureAt: string;
  vehicleId: string;
  plate: string;
  schoolName: string;
}

export interface TripStudentView {
  id: string;
  studentId: string;
  fullName: string;
  state: string;
  stateSeq: number;
  deliveryTarget: string;
  expectedStopId: string | null;
  expectedStopLabel: string | null;
  needsReview: boolean;
  photoPath: string | null;
  guardianPhone: string | null;
  guardianName: string | null;
  deliveryVerified: boolean;
  handoverPolicy: 'GUARDIAN_REQUIRED' | 'MAY_LEAVE_ALONE';
  receivers: Array<{ membershipId: string; fullName: string; relation: string }>;
  snapshotDropoffText: string | null;
  receiverName: string | null;
}

export interface TripStopView {
  id: string;
  seq: number;
  kind: 'PICKUP' | 'DROPOFF' | 'SCHOOL';
  label: string;
  lat: number;
  lng: number;
  addressText: string;
  studentIds: string[];
}

export interface TripDetail extends TripSummary {
  routeVersionId: string;
  checks: { before: boolean; after: boolean };
  stops: TripStopView[];
  students: TripStudentView[];
  locationSessionEpoch: number;
  locationSourceDeviceId: string | null;
  driverMembershipId: string | null;
  attendantMembershipId: string | null;
  driverName: string | null;
  attendantName: string | null;
  seatCount: number;
  live: {
    lat: number;
    lng: number;
    heading: number | null;
    recordedAt: string;
    quality: 'GOOD' | 'LOW';
    isStale: boolean;
  } | null;
  pendingAlerts: Array<{
    id: string;
    tripId: string;
    body: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    stopId: string | null;
    requiresAck: boolean;
  }>;
}

export interface GenerateHorizonResult {
  created: number;
  skipped: number;
  tripIds: string[];
}

export interface CommandResult {
  replay: boolean;
  status: 'APPLIED' | 'CONFLICT' | 'REJECTED' | 'PENDING';
  tripStudentId: string;
  state: string;
  stateSeq: number;
  reason?: string;
}

export interface TripPort {
  generateHorizon(
    tenantId: string,
    actor: { membershipId: string | null; role: string },
    input: GenerateTripsInput,
  ): Promise<GenerateHorizonResult>;
  listForDate(tenantId: string, actor: TripActor, date: string): Promise<TripSummary[]>;
  getDetail(tenantId: string, actor: TripActor, tripId: string): Promise<TripDetail | null>;
  recordVehicleCheck(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: RecordVehicleCheckInput,
  ): Promise<TripSummary>;
  startTrip(tenantId: string, actor: TripActor, tripId: string): Promise<TripSummary>;
  completeTrip(tenantId: string, actor: TripActor, tripId: string): Promise<TripSummary>;
  cancelTrip(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: CancelTripInput,
  ): Promise<TripSummary>;
  applyStudentCommand(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: StudentCommandInput,
  ): Promise<CommandResult>;
  undoStudentCommand(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: UndoStudentCommandInput,
  ): Promise<CommandResult>;
  reportIncident(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: ReportIncidentInput,
  ): Promise<{ ok: true }>;
  ingestLocation(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: LocationPingInput,
  ): Promise<LocationIngestResult>;
  verifyDeliveryOtp(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: VerifyDeliveryOtpInput,
  ): Promise<{ ok: true; overrideId: string }>;
  ackCriticalChange(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    alertId: string,
  ): Promise<{ ok: true }>;
}

export interface StaffListItem {
  membershipId: string;
  identityId: string;
  fullName: string;
  phone: string;
  email: string | null;
  roles: MembershipRole[];
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REVOKED';
}

export interface StudentGuardianView {
  membershipId: string;
  identityId: string;
  inviteId: string | null;
  fullName: string;
  phone: string;
  relation: string;
  status: 'ACTIVE' | 'REVOKED';
  inviteStatus: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED' | null;
  smsStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED' | null;
}

export interface StudentListItem {
  id: string;
  fullName: string;
  schoolId: string;
  schoolName: string;
  grade: string | null;
  enrollmentEnd: string | null;
  usesMorning: boolean;
  usesEvening: boolean;
  suspended: boolean;
  morningPlanStatus: 'PREPARING' | 'READY' | 'NO_SERVICE' | 'SUSPENDED';
  eveningPlanStatus: 'PREPARING' | 'READY' | 'NO_SERVICE' | 'SUSPENDED';
  addressVerification: 'PINNED' | 'PENDING';
  guardians: StudentGuardianView[];
}

export interface ImportRowView {
  rowNo: number;
  status: 'PENDING' | 'READY' | 'NEEDS_FIX' | 'ADDRESS_UNVERIFIED' | 'COMMITTED' | 'FAILED';
  errorCode: string | null;
  existingIdentityId: string | null;
  existingFullName: string | null;
  studentId: string | null;
  identityId: string | null;
  membershipId: string | null;
  guardianPhone: string | null;
  studentFullName: string | null;
}

export interface ImportBatchView {
  id: string;
  fileName: string | null;
  fileHash: string | null;
  summary: {
    total: number;
    ready: number;
    needsFix: number;
    addressUnverified: number;
    committed: number;
    failed: number;
    uniqueGuardianPhones: number;
    pendingInvites: number;
  };
  rows: ImportRowView[];
}

export interface GuardianInviteView {
  id: string;
  membershipId: string;
  identityId: string;
  status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  smsStatus: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED' | null;
  inviteUrl: string | null;
  token: string | null;
}

export interface PublicInviteView {
  tenantName: string;
  phoneHint: string;
  status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
}

export interface ParentChildView {
  studentId: string;
  fullName: string;
  schoolName: string;
  morningPlanStatus: 'PREPARING' | 'READY' | 'NO_SERVICE' | 'SUSPENDED';
  eveningPlanStatus: 'PREPARING' | 'READY' | 'NO_SERVICE' | 'SUSPENDED';
}

export interface AdminPort extends RouteAdminPort {
  pinAddress(tenantId: string, input: PinAddressInput): Promise<{ id: string }>;
  listAddresses(
    tenantId: string,
  ): Promise<Array<{ id: string; text: string; lat: number; lng: number }>>;
  createSchool(tenantId: string, input: CreateSchoolInput): Promise<{ id: string }>;
  listSchools(tenantId: string): Promise<Array<{ id: string; name: string; level: string }>>;
  createVehicle(tenantId: string, input: CreateVehicleInput): Promise<{ id: string }>;
  listVehicles(tenantId: string): Promise<Array<{ id: string; plate: string; seatCount: number }>>;
  createStaff(
    tenantId: string,
    membershipId: string,
    input: CreateStaffInput,
  ): Promise<{ identityId: string; membershipId: string }>;
  listStaff(tenantId: string): Promise<StaffListItem[]>;
  setStaffStatus(
    tenantId: string,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
  ): Promise<StaffListItem>;
  listStaffDevices(
    tenantId: string,
    membershipId: string,
  ): Promise<
    Array<{
      deviceId: string;
      platform: string;
      revokedAt: string | null;
      lastSyncAt: string | null;
    }>
  >;
  revokeDevice(tenantId: string, deviceId: string): Promise<{ ok: true }>;
  serviceDateToday(tenantId: string): Promise<string>;
  createStudent(tenantId: string, input: CreateStudentInput): Promise<{ id: string }>;
  listStudents(tenantId: string): Promise<StudentListItem[]>;
  getStudent(tenantId: string, studentId: string): Promise<StudentListItem | null>;
  endStudent(
    tenantId: string,
    studentId: string,
    enrollmentEnd: string,
  ): Promise<{ id: string; enrollmentEnd: string }>;
  createGuardian(
    tenantId: string,
    studentId: string,
    input: CreateGuardianInput,
  ): Promise<{ identityId: string; membershipId: string }>;
  revokeGuardian(
    tenantId: string,
    studentId: string,
    membershipId: string,
  ): Promise<{ status: 'REVOKED' }>;
  changeUnactivatedPhone(
    tenantId: string,
    identityId: string,
    phone: string,
  ): Promise<{ identityId: string; phone: string }>;
  previewImport(
    tenantId: string,
    actorMembershipId: string,
    input: PreviewImportInput,
  ): Promise<ImportBatchView>;
  getImport(tenantId: string, batchId: string): Promise<ImportBatchView | null>;
  commitImport(
    tenantId: string,
    batchId: string,
    input: CommitImportInput,
  ): Promise<ImportBatchView>;
  createInvite(
    tenantId: string,
    actorMembershipId: string,
    membershipId: string,
  ): Promise<GuardianInviteView>;
  sendInviteSms(tenantId: string, inviteId: string): Promise<GuardianInviteView>;
  createHoliday(
    tenantId: string,
    schoolId: string,
    input: CreateHolidayInput,
  ): Promise<{ schoolId: string; date: string; type: 'HOLIDAY' }>;
  generateHorizon(
    tenantId: string,
    membershipId: string,
    input: GenerateTripsInput,
  ): Promise<GenerateHorizonResult>;
  listTripsForDate(tenantId: string, actor: TripActor, date: string): Promise<TripSummary[]>;
  getTripDetail(tenantId: string, actor: TripActor, tripId: string): Promise<TripDetail | null>;
  assignTripVehicle(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: AssignTripVehicleInput,
  ): Promise<TripSummary>;
  assignTripCrew(
    tenantId: string,
    actor: TripActor,
    tripId: string,
    input: AssignTripCrewInput,
  ): Promise<TripSummary>;
  transferStudent(
    tenantId: string,
    actor: TripActor,
    input: CreateStudentTripMoveInput,
  ): Promise<StudentTripMoveResult>;
  listEvents(tenantId: string, membershipId: string, date: string): Promise<AdminEventsList>;
  listPriorities(tenantId: string, membershipId: string, date: string): Promise<AdminPrioritiesList>;
  listExceptions(tenantId: string, membershipId: string): Promise<AdminExceptionsList>;
  approveDeliveryOverride(
    tenantId: string,
    membershipId: string,
    overrideId: string,
  ): Promise<{ ok: true }>;
  rejectDeliveryOverride(
    tenantId: string,
    membershipId: string,
    overrideId: string,
  ): Promise<{ ok: true }>;
  adminOverrideDelivery(
    tenantId: string,
    membershipId: string,
    overrideId: string,
    input: AdminOverrideDeliveryInput,
  ): Promise<{ ok: true }>;
  approveAddressChange(
    tenantId: string,
    membershipId: string,
    requestId: string,
  ): Promise<{ ok: true }>;
  rejectAddressChange(
    tenantId: string,
    membershipId: string,
    requestId: string,
  ): Promise<{ ok: true }>;
}

export interface ParentPort {
  listChildren(tenantId: string, membershipId: string): Promise<ParentChildView[]>;
  previewInvite(token: string): Promise<PublicInviteView | null>;
  activateInvite(
    token: string,
    auth: { authUserId: string; phone: string | null; identityId: string },
  ): Promise<{ membershipId: string; children: ParentChildView[] }>;
  getHome(tenantId: string, membershipId: string): Promise<ParentHome>;
  pollTracking(
    tenantId: string,
    membershipId: string,
    tripId: string,
    studentId?: string,
  ): Promise<ParentTrackingView>;
  createRideException(
    tenantId: string,
    membershipId: string,
    input: CreateRideExceptionInput,
  ): Promise<{ items: RideExceptionView[] }>;
  cancelRideException(
    tenantId: string,
    membershipId: string,
    exceptionId: string,
  ): Promise<{ ok: true }>;
  createDeliveryOverride(
    tenantId: string,
    membershipId: string,
    input: CreateDeliveryOverrideInput,
  ): Promise<DeliveryOverrideView>;
  cancelDeliveryOverride(
    tenantId: string,
    membershipId: string,
    overrideId: string,
  ): Promise<{ ok: true }>;
  resendDeliveryOtp(
    tenantId: string,
    membershipId: string,
    overrideId: string,
  ): Promise<{ id: string; otpCode: string; addressText: string; resendCount: number }>;
  getParentDayPlan(
    tenantId: string,
    membershipId: string,
    studentId: string,
    date?: string,
  ): Promise<ParentDayPlan>;
  createAddressChange(
    tenantId: string,
    membershipId: string,
    input: CreateAddressChangeInput,
  ): Promise<AddressChangeView>;
}

export interface RealtimeProbe {
  vehicleBroadcasts(tripId?: string): Array<{ tripId: string; payload: VehicleBroadcast }>;
  endedTripIds(): string[];
  viewerCount(tripId: string): number;
}

export interface DevicesPort {
  registerPushToken(
    tenantId: string,
    membershipId: string,
    input: {
      deviceId: string;
      platform: 'IOS' | 'ANDROID';
      pushToken: string;
      appVersion?: string;
    },
  ): Promise<{ ok: true }>;
}

export interface AppData {
  getPlatform(): Promise<PlatformConfig>;
  session: SessionPort;
  admin: AdminPort;
  trips: TripPort;
  parent: ParentPort;
  devices: DevicesPort;
  realtime: RealtimeProbe;
}
