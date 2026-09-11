import { device, withTenant, type Database } from '@servisapp/db';
import { and, eq } from 'drizzle-orm';
import { conflict, forbidden } from '../http-error.js';
import type { DevicesPort } from './ports.js';

export function createDevicePort(db: Database): DevicesPort {
  return {
    registerPushToken(tenantId, membershipId, input) {
      return withTenant(db, { tenantId, membershipId, role: null }, async (tx) => {
        const [existing] = await tx
          .select({
            membershipId: device.membershipId,
            revokedAt: device.revokedAt,
          })
          .from(device)
          .where(and(eq(device.id, input.deviceId), eq(device.tenantId, tenantId)));
        if (existing) {
          if (existing.membershipId !== membershipId) {
            throw conflict('device_bound', 'Bu cihaz başka bir üyeliğe bağlı');
          }
          if (existing.revokedAt) throw forbidden('Bu cihaz iptal edilmiş');
          await tx
            .update(device)
            .set({
              pushToken: input.pushToken,
              platform: input.platform,
              appVersion: input.appVersion,
              lastSyncAt: new Date(),
            })
            .where(and(eq(device.id, input.deviceId), eq(device.tenantId, tenantId)));
          return { ok: true as const };
        }
        await tx.insert(device).values({
          id: input.deviceId,
          tenantId,
          membershipId,
          platform: input.platform,
          pushToken: input.pushToken,
          appVersion: input.appVersion,
          lastSyncAt: new Date(),
        });
        return { ok: true as const };
      });
    },
  };
}
