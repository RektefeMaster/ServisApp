/** Telefon eşleşmesinde isim karşılaştırması — merge kararı değil, sinyal. */

export function normalizePersonName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr-TR');
}

export function namesLikelySame(left: string, right: string): boolean {
  const a = normalizePersonName(left);
  const b = normalizePersonName(right);
  return a.length > 0 && a === b;
}
