import { z } from 'zod';

/** Tüm kimlikler UUIDv7 — sıralı ama tahmin edilemez, numaralandırmaya kapalı. */
export const uuid = z.uuid();

/** Türkiye cep telefonu, E.164: +905XXXXXXXXX */
export const phoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Telefon E.164 biçiminde olmalı (ör. +905321234567)');

/**
 * Servis günü — takvim günü, an değil. Cihaz saatinden ASLA türetilmez;
 * olaylar tarihi ait oldukları seferden alır (bkz. SPEC §7 "Zaman kuralı").
 */
export const serviceDate = z.iso.date();

/** Sunucu/cihaz anları daima UTC instant olarak taşınır. */
export const instant = z.iso.datetime({ offset: true });

export const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type Coordinate = z.infer<typeof coordinate>;
