// =====================================================================
// Нийтлэг алдаа боловсруулагч
// =====================================================================
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { HttpError } from '../lib/httpError.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Зам олдсонгүй: ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'Давхардсан бичлэг байна', details: { fields: err.meta?.target } },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Бичлэг олдсонгүй' } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Холбоотой бичлэг байгаа тул үйлдэл хийх боломжгүй' } });
    }
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: `Файл хүлээн авахад алдаа: ${err.message}` } });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'JSON формат буруу' } });
  }

  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Серверийн алдаа гарлаа' } });
}
