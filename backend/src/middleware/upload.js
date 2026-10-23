// =====================================================================
// Файл upload (multer) — uploads/<хавтас>/ дотор санамсаргүй нэрээр хадгална
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../lib/httpError.js';

const ALLOWED = {
  document: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  media: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/wav',
    'audio/x-wav', 'audio/webm', 'audio/ogg', 'video/webm', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

export function uploader(folder, kind = 'document') {
  const dir = path.join(env.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: env.uploadMaxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      // Excel суулгаагүй компьютерын браузер .xlsx-ийг octet-stream гэж илгээдэг;
      // агуулгыг exceljs уншихдаа шалгана
      const xlsxByName = kind === 'excel' && path.extname(file.originalname).toLowerCase() === '.xlsx';
      if (ALLOWED[kind].includes(file.mimetype) || xlsxByName) cb(null, true);
      else cb(badRequest(`Энэ төрлийн файл зөвшөөрөгдөхгүй: ${file.mimetype}`));
    },
  });
}

// DB-д хадгалах харьцангуй зам: "materials/123-abc.pdf"
export const storedPath = (folder, file) => (file ? `${folder}/${file.filename}` : null);

export const absolutePath = (relPath) => {
  const full = path.resolve(env.uploadDir, relPath);
  if (!full.startsWith(env.uploadDir + path.sep)) throw badRequest('Файлын зам буруу');
  return full;
};
