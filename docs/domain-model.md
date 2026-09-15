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

## Kimlik: bilerek verilmiş iki karar

**Kimlik küresel, üyelik kiracıya aittir.** `identity.phone_e164` tüm sistemde
tekildir. Bunun iki bilinen sonucu var; ikisi de ürün kararıdır, hata değil.

1. **Personel daveti ilk girişte ACTIVE olur.** Bir yönetici telefon numarası
   ekleyip DRIVER/ATTENDANT/ADMIN rolü verdiğinde, o kişi bir sonraki girişinde
   (başka bir şirket için giriyor olsa bile) o üyeliğe ACTIVE olarak bağlanır —
   ayrıca bir kabul adımı yoktur. Veli tarafı böyle DEĞİLDİR: GUARDIAN üyeliği
   yalnız davet jetonunun aktivasyonuyla açılır (migration 0022). Personel için
   de açık kabul istenirse `resolve_session`'daki otomatik ACTIVE bloğu
   kaldırılır ve personel davet akışı eklenir; bu, saha kurulumunu yavaşlatan
   bir ürün değişikliğidir, tek satırlık bir düzeltme değil.

2. **`phone_in_use` bir varlık kehanetidir.** Bir yönetici, sistemde zaten
   kayıtlı bir numarayı eklemeye çalışınca bu hatayı alır ve numaranın
   _bir yerde_ kayıtlı olduğunu öğrenir. Kimin olduğunu öğrenemez: çapraz
   kiracı kimlik adı ve id'si maskelenir (`classifyRow`,
   `resolveGuardianIdentity`); başka şirketteki kimliğe bağlanmak yalnız açık
   `reuseIdentityId` ile mümkündür ve o id dışarıya hiç verilmez. Küresel tekil
   telefon kısıtının kaçınılmaz yan etkisidir.
