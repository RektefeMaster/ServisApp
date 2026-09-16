/** Takvim günü adımları saat dilimi ve yaz saati kaymalarından etkilenmez. */
export function shiftDay(ymd: string, days: number): string {
  const next = new Date(`${ymd}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
