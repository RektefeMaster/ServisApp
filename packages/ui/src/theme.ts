export const colors = {
  mist: '#F5F4F0',
  paper: '#FFFFFF',
  accent: '#D4B58A',
  accentSoft: '#F4ECE0',
  ink: '#222824',
  /**
   * Yardımcı metin. Eskiden #68716A idi; renkli yüzeylerde (accentSoft 4.31,
   * railSoft 4.37, dangerSoft 4.25) WCAG AA 4.5:1 eşiğinin ALTINDA kalıyordu —
   * yani kart açıklamaları ve uyarı gövdeleri okunaklılık ölçüsünü geçmiyordu.
   * Bu ton, paletteki bütün zeminlerde en az 5:1 verir.
   */
  mute: '#5D665F',
  /** Ayraç ve kart kenarı. Dekoratif; metin taşımaz. */
  line: '#E2E5DF',
  /**
   * Form alanı kenarı. Ayraçtan AYRI bir ton: alanın nerede başladığını yalnız
   * kenarlık gösteriyor (dolgu da zemin de beyaza yakın), bu yüzden WCAG 1.4.11
   * gereği 3:1 ister. `line` beyazda 1.27 ile bunun çok altındaydı.
   */
  field: '#7C8878',
  rail: '#253A38',
  warn: '#98450B',
  danger: '#B42318',
  ok: '#396B4C',
  railSoft: '#EAF0ED',
  dangerSoft: '#F8E8E6',
  warnSoft: '#F8EEDF',
  okSoft: '#EDF4ED',
} as const;

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  sheet: 28,
} as const;

export const touchTargets = {
  min: 48,
  crewPrimary: 72,
  parentPrimary: 56,
} as const;

export const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export const elevation = {
  card: {
    shadowColor: '#222824',
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  band: {
    shadowColor: '#222824',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 4,
  },
  sheet: {
    shadowColor: '#222824',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  toast: {
    shadowColor: '#222824',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;

export const layout = {
  screenPaddingX: space.lg,
  screenPaddingTop: 56,
  maxContentWidth: 560,
} as const;

export const fontFamilies = {
  uiRegular: 'Figtree_400Regular',
  uiMedium: 'Figtree_500Medium',
  uiSemiBold: 'Figtree_600SemiBold',
  uiBold: 'Figtree_700Bold',
  monoRegular: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const;

export const typography = {
  caption: {
    fontFamily: fontFamilies.uiMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.mute,
  },
  meta: {
    fontFamily: fontFamilies.uiRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.mute,
  },
  body: {
    fontFamily: fontFamilies.uiRegular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  strong: {
    fontFamily: fontFamilies.uiSemiBold,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  section: {
    fontFamily: fontFamilies.uiSemiBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
  },
  title: {
    fontFamily: fontFamilies.uiBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: colors.ink,
  },
  focus: {
    fontFamily: fontFamilies.uiBold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.ink,
  },
  display: {
    fontFamily: fontFamilies.uiBold,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -1.2,
    color: colors.ink,
  },
  monoSmall: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 14,
    lineHeight: 18,
    color: colors.ink,
  },
  mono: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
  },
  monoLarge: {
    fontFamily: fontFamilies.monoSemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
  },
} as const;

export type ColorToken = keyof typeof colors;
export type SpaceToken = keyof typeof space;
export type AppTextPreset = keyof typeof typography;

/**
 * Sistem yazı boyutu büyütmesinin üst sınırı, sunum rolüne göre.
 *
 * Metin ölçeklenmesi kapatılmaz: gövde, açıklama ve etiketler kullanıcının
 * ayarını sonuna kadar takip eder — okunması gereken bilgi onlardır. Sınır
 * yalnız BÜYÜK gösterim tipine konur; "Sefer merkezi" başlığı ya da sayaç
 * rakamları 3 katına çıktığında satır taşıyor, üç sütunlu sayaç şeridi ve
 * bilet kartı yatayda kırılıyordu. Sınırlı büyüme okunaklı kalır, düzen ayakta
 * durur; asıl içerik zaten tam ölçeklenir.
 */
export const fontScaleCaps: Partial<Record<AppTextPreset, number>> = {
  display: 1.5,
  focus: 1.5,
  title: 1.6,
  monoLarge: 1.5,
  mono: 1.7,
  monoSmall: 1.7,
};
