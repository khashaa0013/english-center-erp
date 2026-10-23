// =====================================================================
// Анхны өгөгдөл (давтан ажиллуулахад давхардахгүй — upsert)
//   npm run db:seed          → эрх, түвшин, салбар, захирлын эрх
//   npm run db:seed -- --demo → дээр нь туршилтын жишиг өгөгдөл
//
// Нууц үг: SEED_ADMIN_PASSWORD (.env) эсвэл хөгжүүлэлтэд "Admin12345!"
// Туршилтын хэрэглэгчид: "Demo12345!" — зөвхөн хөгжүүлэлтийн орчинд.
// =====================================================================
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const demo = process.argv.includes('--demo');
const rounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);

const ROLES = [
  ['SUPER_ADMIN', 'Захирал'],
  ['BRANCH_ADMIN', 'Салбарын админ'],
  ['FINANCE', 'Санхүүгийн ажилтан'],
  ['TEACHER', 'Багш'],
  ['STUDENT', 'Сурагч'],
  ['PARENT', 'Эцэг эх'],
];
const LEVELS = [
  ['A1', 'Анхан (Beginner)'], ['A2', 'Суурь (Elementary)'], ['B1', 'Дунд (Intermediate)'],
  ['B2', 'Ахисан дунд (Upper-Intermediate)'], ['C1', 'Ахисан (Advanced)'], ['C2', 'Мэргэжлийн (Proficiency)'],
];

async function upsertUser(username, displayName, roleCode, branchId, password) {
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, displayName, roleId: role.id, branchId, passwordHash: await bcrypt.hash(password, rounds) },
  });
}

async function main() {
  if (demo && process.env.NODE_ENV === 'production') throw new Error('Production орчинд --demo ажиллуулахгүй');

  for (const [code, name] of ROLES) {
    await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name } });
  }
  for (const [i, [code, name]] of LEVELS.entries()) {
    await prisma.englishLevel.upsert({ where: { code }, update: {}, create: { code, name, sortOrder: i + 1 } });
  }
  const branch = await prisma.branch.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { code: 'MAIN', name: 'Алхам англи хэлний сургалтын төв — Төв салбар', address: 'Улаанбаатар', phone: '77000000' },
  });

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin12345!';
  await upsertUser('admin', 'Захирал', 'SUPER_ADMIN', null, adminPassword);
  console.log('✔ Эрх, түвшин, салбар, захирал (admin) бэлэн');

  if (!demo) return;
  const pw = 'Demo12345!';

  await upsertUser('branchadmin', 'Салбарын админ', 'BRANCH_ADMIN', branch.id, pw);
  await upsertUser('finance', 'Санхүүгийн ажилтан', 'FINANCE', branch.id, pw);

  for (const name of ['101', '102', '103']) {
    await prisma.classroom.upsert({ where: { branchId_name: { branchId: branch.id, name } }, update: {}, create: { branchId: branch.id, name, capacity: 15 } });
  }

  const program = await prisma.program.upsert({
    where: { name: 'Хүүхдийн англи хэл' },
    update: {},
    create: { name: 'Хүүхдийн англи хэл', targetGroup: '8–12 нас', description: 'Сонсох, унших, бичих, ярих чадварыг хөгжүүлэх' },
  });
  const a1 = await prisma.englishLevel.findUnique({ where: { code: 'A1' } });
  const course = await prisma.course.upsert({
    where: { code: 'KIDS-A1' },
    update: {},
    create: { programId: program.id, levelId: a1.id, code: 'KIDS-A1', name: 'Kids English A1', totalSessions: 24, sessionMinutes: 90 },
  });
  if (!(await prisma.trainingPackage.findFirst({ where: { courseId: course.id } }))) {
    await prisma.trainingPackage.create({ data: { courseId: course.id, name: '3 сарын багц (24 хичээл)', sessionsCount: 24, durationWeeks: 12, price: 600000 } });
  }

  const tUser = await upsertUser('teacher1', 'Бат Сарнай', 'TEACHER', branch.id, pw);
  const teacher = await prisma.teacher.upsert({
    where: { userId: tUser.id },
    update: {},
    create: { userId: tUser.id, branchId: branch.id, teacherCode: 'T2026-0001', lastName: 'Бат', firstName: 'Сарнай', phone: '99110011', courses: { create: [{ courseId: course.id }] } },
  });
  if (!(await prisma.teacherRate.findFirst({ where: { teacherId: teacher.id } }))) {
    const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
    await prisma.teacherRate.create({ data: { teacherId: teacher.id, hourlyRate: 30000, effectiveFrom: new Date('2026-01-01T00:00:00Z'), createdBy: admin.id } });
  }

  const sUser = await upsertUser('st2026-0001', 'Дорж Тэмүүлэн', 'STUDENT', branch.id, pw);
  const student = await prisma.student.upsert({
    where: { studentCode: 'ST2026-0001' },
    update: {},
    create: { branchId: branch.id, userId: sUser.id, studentCode: 'ST2026-0001', lastName: 'Дорж', firstName: 'Тэмүүлэн', gender: 'MALE', birthDate: new Date('2015-05-10T00:00:00Z'), currentLevelId: a1.id },
  });

  const pUser = await upsertUser('99887766', 'Дорж Болд', 'PARENT', branch.id, pw);
  const parent = await prisma.parent.upsert({
    where: { userId: pUser.id },
    update: {},
    create: { userId: pUser.id, lastName: 'Дорж', firstName: 'Болд', phone: '99887766' },
  });
  await prisma.parentStudent.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId: student.id } },
    update: {},
    create: { parentId: parent.id, studentId: student.id, relationship: 'FATHER', verifiedBy: tUser.id, verifiedAt: new Date() },
  });

  console.log('✔ Туршилтын өгөгдөл бэлэн. Хэрэглэгчид: branchadmin, finance, teacher1, st2026-0001, 99887766 (нууц үг: Demo12345!)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
