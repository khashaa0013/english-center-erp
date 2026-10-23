// =====================================================================
// Zod validation — body / query-г шалгаад req.body / req.valid-д хадгална
// =====================================================================
import { z } from 'zod';
import { badRequest } from '../lib/httpError.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('Оролтын өгөгдөл буруу байна', details);
  }
  if (source === 'body') req.body = result.data;
  else req.valid = result.data;
  next();
};

// Түгээмэл хэрэглэдэг төрлүүд
export const zId = z.coerce.number().int().positive();
export const zOptId = z.coerce.number().int().positive().optional().nullable();
export const zMoney = z.coerce.number().nonnegative().max(9999999999.99);
export const zPositiveMoney = z.coerce.number().positive().max(9999999999.99);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD форматтай байна');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM форматтай байна');
export const zReason = z.string().trim().min(3, 'Шалтгаан заавал бичнэ').max(500);
export const zStr = (max = 150) => z.string().trim().min(1).max(max);
// undefined = өөрчлөхгүй, хоосон мөр = null
export const zOptStr = (max = 255) => z.string().trim().max(max).optional().nullable()
  .transform((v) => (v === undefined ? undefined : v || null));

export const idParam = (req, name = 'id') => {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw badRequest(`${name} буруу байна`);
  return value;
};

// multipart form-оос ирэх "true"/"false" мөрийг boolean болгоно
export const zBool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
