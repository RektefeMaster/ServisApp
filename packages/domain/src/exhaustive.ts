/**
 * Durum makinesi switch'lerinde kullanılır: yeni bir duruma karşılık gelen dal
 * eklenmediğinde derleme zamanında hata verir, çalışma zamanında da patlar.
 */
export function exhaustive(value: never, context: string): never {
  throw new Error(`${context}: beklenmeyen değer ${JSON.stringify(value)}`);
}
