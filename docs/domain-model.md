# Domain modeli (Faz 1)

Kaynak: [SPEC.md](../SPEC.md) §4–§7. Bu belge şemanın niyetini özetler; kolon listesi
`packages/db` içindedir.

## Üç katman

| Katman | Değişir mi?           | Örnek                                                |
| ------ | --------------------- | ---------------------------------------------------- |
| Kimlik | Yavaş                 | `identity` → `tenant_membership` → `membership_role` |
| Kalıcı | Rota/öğrenci kurulumu | `route`, `stop`, `address`, `student`                |
| Günlük | Her sefer             | `trip`, `trip_stop` (snapshot), `trip_student`       |

Günlük katman kalıcı katmanı **asla** değiştirmez. Sefer `ACTIVE` olduktan sonra
`route` / `stop` / `address` okunmadan tamamlanabilir: operasyon `trip_stop.snapshot_*`
ve `trip_student.snapshot_dropoff_*` kolonlarını kullanır.

Aynı telefon iki şirkette veli, birinde şoför olabilir. Supabase Auth kimliği
globaldir (`identity`); yetki tenant üyeliğindedir.

## Durum makineleri

Sefer: `PLANNED → READY → ACTIVE → COMPLETED`. `CANCELLED` yalnız ACTIVE öncesi.
`AUTO_CLOSED` enum'da vardır, otomasyonu V1.1.

Öğrenci (tek makine; sabah/akşam farkı `delivery_target`):

```
EXPECTED → ON_BOARD → DELIVERED
        ↘ ABSENT_PLANNED
        ↘ NO_SHOW → ON_BOARD
        ↘ MOVED_OUT
ON_BOARD → DELIVERY_FAILED → { DELIVERED_LATE | RETURNED_TO_SCHOOL | HANDED_TO_ADMIN }
ON_BOARD → RETURNED_HOME
```

`TEMP` teslimat `DELIVERED` olamaz: `delivery_method IN ('OTP','ADMIN_OVERRIDE')` ve
`delivery_verified_at` zorunlu (satır CHECK + `mark_delivery_verified` /
`admin_override_delivery`).

Sefer, `EXPECTED` / `ON_BOARD` / `DELIVERY_FAILED` varken kapanamaz (`complete_trip`

- `BEFORE UPDATE` tetikleyicisi).

## Reconcile

İstisnalar girdidir. `reconcileStudent` yalnız plan üretir; `ON_BOARD` ve diğer
operasyonel gerçekleri ezmez. Tablo `packages/domain` içindedir.

## Idempotency ≠ olay kaydı

`event` append-only denetim izidir. `command_receipt` komut makbuzudur
(`PENDING` transaction rollback olursa kaybolur). Hedefinden önce gelen geri alma
`pending_command_dependency` tombstone'una yazılır.
