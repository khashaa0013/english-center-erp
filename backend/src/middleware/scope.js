// =====================================================================
// Салбарын хязгаар (M7): захирал бүх салбарыг, бусад нь зөвхөн өөрийнхийг
// =====================================================================
import { badRequest, forbidden } from '../lib/httpError.js';

export const isSuper = (req) => req.user.role === 'SUPER_ADMIN';

// Жагсаалтын where нөхцөлд нэмэх салбарын шүүлтүүр
export function branchFilter(req, field = 'branchId') {
  if (isSuper(req)) {
    const q = Number(req.query.branchId);
    return q ? { [field]: q } : {};
  }
  return { [field]: req.user.branchId };
}

// Бичлэг хэрэглэгчийн салбарт хамаарах эсэх
export function assertBranch(req, branchId) {
  if (isSuper(req)) return;
  if (branchId !== req.user.branchId) throw forbidden('Өөр салбарын мэдээлэлд хандах эрхгүй');
}

// Шинэ бичлэгийн салбар: захирал body-оос сонгоно, бусад нь өөрийн салбар
export function resolveBranchId(req, bodyBranchId) {
  if (isSuper(req)) {
    if (!bodyBranchId) throw badRequest('branchId заавал шаардлагатай');
    return Number(bodyBranchId);
  }
  if (!req.user.branchId) throw forbidden('Хэрэглэгч салбарт харьяалагдаагүй');
  return req.user.branchId;
}
