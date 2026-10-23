// =====================================================================
// Орчны тохиргоо (.env) — эхлэх үед шалгаж, нэг газраас уншина
// =====================================================================
import 'dotenv/config';
import path from 'node:path';

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`.env файлд ${key} тохируулагдаагүй байна`);
  }
}

const backendRoot = path.resolve(import.meta.dirname, '..', '..');

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  bcryptRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: path.resolve(backendRoot, process.env.UPLOAD_DIR ?? 'uploads'),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB ?? 10) * 1024 * 1024,
  // PDF-д кирилл үсэг гаргах TTF фонт (Windows-ийн Arial анхдагч)
  pdfFontPath: process.env.PDF_FONT_PATH ?? 'C:/Windows/Fonts/arial.ttf',
  // QPay туршилтын callback-ийн нууц түлхүүр (хоосон бол callback хаалттай)
  qpayWebhookSecret: process.env.QPAY_WEBHOOK_SECRET ?? '',
  // Гэрчилгээний QR-д бичих frontend-ийн хаяг
  publicAppUrl: process.env.PUBLIC_APP_URL ?? 'http://localhost:5173',
};
