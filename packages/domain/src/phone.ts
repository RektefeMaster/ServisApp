/** Türkiye cep: 05xx, 5xx veya +90. Diğer E.164 numaralar + ile olduğu gibi kalır. */
export function toPhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const digits = trimmed.replace(/\D/g, '');
  let candidate: string;
  if (trimmed.startsWith('+')) {
    candidate = `+${digits}`;
  } else if (digits.startsWith('90') && digits.length === 12) {
    candidate = `+${digits}`;
  } else if (digits.startsWith('0') && digits.length === 11) {
    candidate = `+90${digits.slice(1)}`;
  } else if (digits.length === 10 && digits.startsWith('5')) {
    candidate = `+90${digits}`;
  } else {
    return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null;
}
