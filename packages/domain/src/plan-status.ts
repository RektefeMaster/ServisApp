export const STUDENT_PLAN_STATUSES = ['PREPARING', 'READY', 'NO_SERVICE', 'SUSPENDED'] as const;
export type StudentPlanStatus = (typeof STUDENT_PLAN_STATUSES)[number];

export interface SegmentPlanInput {
  studentEnded: boolean;
  studentSuspended: boolean;
  usesSegment: boolean;
  publishedAssignment: boolean;
  stopHasCoordinates: boolean;
}

/**
 * Veli uygulaması bu değeri tahmin etmez. Segment ayrı hesaplanır:
 * yalnız akşam servisi → sabah NO_SERVICE, akşam PREPARING veya READY.
 */
export function segmentPlanStatus(input: SegmentPlanInput): StudentPlanStatus {
  if (input.studentEnded) return 'NO_SERVICE';
  if (input.studentSuspended) return 'SUSPENDED';
  if (!input.usesSegment) return 'NO_SERVICE';
  if (input.publishedAssignment && input.stopHasCoordinates) return 'READY';
  return 'PREPARING';
}
