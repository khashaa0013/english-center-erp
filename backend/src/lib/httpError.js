// =====================================================================
// Нийтлэг алдааны формат: { error: { code, message, details? } }
// =====================================================================

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Нэвтрэх шаардлагатай') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Энэ үйлдлийг хийх эрхгүй') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Олдсонгүй') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new HttpError(409, 'CONFLICT', message, details);
