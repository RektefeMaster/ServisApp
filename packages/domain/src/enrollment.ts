/** enrollment_end dahil son servis günüdür; ertesi günden itibaren bitmiş sayılır. */
export function isEnrollmentEnded(
  enrollmentEnd: string | null | undefined,
  asOfYmd: string,
): boolean {
  if (!enrollmentEnd) return false;
  return enrollmentEnd < asOfYmd;
}
