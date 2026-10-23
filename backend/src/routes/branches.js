// =====================================================================
// M7 — Салбар (захирал бүгдийг удирдана, салбарын админ өөрийнхийг харна)
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/httpError.js';
import { writeAudit } from '../lib/audit.js';
import { authorize } from '../middleware/auth.js';
import { assertBranch, isSuper } from '../middleware/scope.js';
import { idParam, validate, zOptStr, zStr } from '../middleware/validate.js';
import { storedPath, uploader } from '../middleware/upload.js';

const router = Router();

const branchSchema = z.object({
  code: zStr(20),
  name: zStr(150),
  address: zOptStr(255),
  phone: zOptStr(30),
  lateThresholdMinutes: z.coerce.number().int().min(0).max(120).optional(),
  qrTtlSeconds: z.coerce.number().int().min(15).max(600).optional(),
  isActive: z.boolean().optional(),
});

router.get('/', async (req, res) => {
  const where = isSuper(req) ? {} : { id: req.user.branchId ?? -1 };
  res.json(await prisma.branch.findMany({ where, orderBy: { id: 'asc' } }));
});

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  assertBranch(req, id);
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) throw notFound();
  res.json(branch);
});

router.post('/', authorize('SUPER_ADMIN'), validate(branchSchema), async (req, res) => {
  const branch = await prisma.branch.create({ data: req.body });
  await writeAudit(req, { action: 'CREATE', entityType: 'Branch', entityId: branch.id, newValues: branch, branchId: branch.id });
  res.status(201).json(branch);
});

router.put('/:id', authorize('SUPER_ADMIN', 'BRANCH_ADMIN'), validate(branchSchema.partial()), async (req, res) => {
  const id = idParam(req);
  assertBranch(req, id);
  const old = await prisma.branch.findUnique({ where: { id } });
  if (!old) throw notFound();
  // Салбарын админ код, идэвхийг өөрчлөхгүй
  const data = isSuper(req) ? req.body : { ...req.body, code: undefined, isActive: undefined };
  const branch = await prisma.branch.update({ where: { id }, data });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Branch', entityId: id, oldValues: old, newValues: branch, branchId: id });
  res.json(branch);
});

// Тамга, гарын үсгийн зураг — гэрээ, гэрчилгээний PDF-д ашиглана
const imageUpload = uploader('branding', 'image');
router.post('/:id/branding/:kind', authorize('SUPER_ADMIN', 'BRANCH_ADMIN'), imageUpload.single('file'), async (req, res) => {
  const id = idParam(req);
  assertBranch(req, id);
  const field = req.params.kind === 'stamp' ? 'stampPath' : req.params.kind === 'signature' ? 'signaturePath' : null;
  if (!field || !req.file) throw notFound('stamp эсвэл signature зураг илгээнэ');
  const branch = await prisma.branch.update({ where: { id }, data: { [field]: storedPath('branding', req.file) } });
  await writeAudit(req, { action: 'UPDATE', entityType: 'Branch', entityId: id, newValues: { [field]: branch[field] }, branchId: id });
  res.json(branch);
});

export default router;
