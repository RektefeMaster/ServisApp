export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function unauthorized(message = 'Oturum gerekli'): HttpError {
  return new HttpError(401, 'unauthorized', message);
}

export function forbidden(message = 'Bu işlem için yetkiniz yok'): HttpError {
  return new HttpError(403, 'forbidden', message);
}

export function notFound(message = 'Kayıt bulunamadı'): HttpError {
  return new HttpError(404, 'not_found', message);
}

export function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}

export function upgradeRequired(minimum: string): HttpError {
  return new HttpError(
    426,
    'upgrade_required',
    `Uygulama sürümü artık desteklenmiyor. En düşük sürüm ${minimum}.`,
  );
}

export function badRequest(code: string, message: string): HttpError {
  return new HttpError(400, code, message);
}
