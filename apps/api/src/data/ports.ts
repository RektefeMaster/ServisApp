import type {
  CloneRouteVersionInput,
  CreateGuardianInput,
  CreateRouteInput,
  CreateSchoolInput,
  CreateStaffInput,
  CreateStopInput,
  CreateStudentInput,
  CreateVehicleInput,
  PinAddressInput,
  PlatformConfig,
  ReplaceRouteStopsInput,
  SessionSnapshot,
} from '@servisapp/contracts';

export interface SessionPort {
  resolve(input: {
    authUserId: string;
    phone: string | null;
    email: string | null;
  }): Promise<SessionSnapshot>;
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
  createStudent(tenantId: string, input: CreateStudentInput): Promise<{ id: string }>;
  listStudents(
    tenantId: string,
  ): Promise<Array<{ id: string; fullName: string; schoolId: string }>>;
  createGuardian(
    tenantId: string,
    studentId: string,
    input: CreateGuardianInput,
  ): Promise<{ identityId: string; membershipId: string }>;
}

export interface AppData {
  getPlatform(): Promise<PlatformConfig>;
  session: SessionPort;
  admin: AdminPort;
}
