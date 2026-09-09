import type {
  CreateGuardianInput,
  CreateSchoolInput,
  CreateStaffInput,
  CreateStudentInput,
  CreateVehicleInput,
  PinAddressInput,
  PlatformConfig,
  SessionSnapshot,
} from '@servisapp/contracts';

export interface SessionPort {
  resolve(input: {
    authUserId: string;
    phone: string | null;
    email: string | null;
  }): Promise<SessionSnapshot>;
}

export interface AdminPort {
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
