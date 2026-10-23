// =====================================================================
// Audit log — хэн, хэзээ, юуг, ямар шалтгаанаар өөрчилсөн
// tx дамжуулбал тухайн transaction дотор бичигдэнэ.
// =====================================================================
import { prisma } from './prisma.js';

const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

export async function writeAudit(req, { action, entityType, entityId, oldValues, newValues, reason, approvedBy, branchId }, tx = prisma) {
  await tx.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      branchId: branchId ?? req?.user?.branchId ?? null,
      action,
      entityType,
      entityId: entityId ?? null,
      oldValues: json(oldValues),
      newValues: json(newValues),
      reason: reason ?? null,
      approvedBy: approvedBy ?? null,
      ipAddress: req?.ip ?? null,
    },
  });
}
