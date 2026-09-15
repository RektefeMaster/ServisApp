import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Android donanım geri tuşu.
 *
 * İki uygulama da elde yazılmış bir yönlendirici kullanıyor; Android'de geri
 * tuşunu kimse dinlemediği için tuş **uygulamayı kapatıyordu**. Şoför aktif
 * seferin ortasında geri tuşuna basınca uygulama kapanıyor, veli canlı takipten
 * çıkmak isterken ana ekrana değil dışarı düşüyordu.
 *
 * `onBack` null/undefined ise varsayılan davranışa (uygulamadan çık) izin
 * verilir — kök ekran için doğru olan budur. Dinleyici yalnız bir kez
 * kaydedilir; gövde her render'da tazelenen ref'ten okunur, böylece satır içi
 * ok fonksiyonları abonelik trafiği yaratmaz.
 */
export function useHardwareBack(onBack?: (() => void) | null): void {
  const latest = useRef(onBack);
  latest.current = onBack;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const handler = latest.current;
      if (!handler) return false;
      handler();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
