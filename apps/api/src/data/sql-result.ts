export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function firstRow(result: unknown): Record<string, unknown> | undefined {
  let rows: unknown;
  if (Array.isArray(result)) {
    rows = result;
  } else if (isRecord(result) && 'rows' in result) {
    rows = result['rows'];
  } else {
    return undefined;
  }
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row: unknown = rows[0];
  return isRecord(row) ? row : undefined;
}

export function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isRecord(value) ? value : undefined;
}

export function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
