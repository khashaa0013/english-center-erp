// =====================================================================
// Express app — бүх модулийн route-уудыг холбоно
// =====================================================================
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
// M7
import branchRoutes from './routes/branches.js';
import userRoutes from './routes/users.js';
import notificationRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import reportRoutes from './routes/reports.js';
import fileRoutes from './routes/files.js';
// M1
import leadRoutes from './routes/leads.js';
import studentRoutes from './routes/students.js';
import parentRoutes from './routes/parents.js';
import enrollmentRoutes from './routes/enrollments.js';
// M4
import catalogRoutes from './routes/catalog.js';
import classRoutes from './routes/classes.js';
import sessionRoutes from './routes/sessions.js';
import assignmentRoutes from './routes/assignments.js';
import examRoutes from './routes/exams.js';
import certificateRoutes from './routes/certificates.js';
// M2
import attendanceRoutes from './routes/attendance.js';
// M3
import financeRoutes from './routes/finance.js';
// M5
import portalRoutes, { requestsRouter } from './routes/portal.js';
// M6
import teacherRoutes, { hoursRouter } from './routes/teachers.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date() }));
  app.use('/api/public', publicRoutes);
  app.use('/api/auth', authRoutes);

  // Доорх бүх зам нэвтрэлт шаардана
  app.use('/api', authenticate);
  app.use('/api/branches', branchRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/files', fileRoutes);

  app.use('/api/leads', leadRoutes);
  app.use('/api/students', studentRoutes);
  app.use('/api/parents', parentRoutes);
  app.use('/api/enrollments', enrollmentRoutes);

  app.use('/api/catalog', catalogRoutes);
  app.use('/api/classes', classRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/assignments', assignmentRoutes);
  app.use('/api/exams', examRoutes);
  app.use('/api', certificateRoutes);
  app.use('/api', attendanceRoutes);

  app.use('/api/finance', financeRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/requests', requestsRouter);
  app.use('/api/teachers', teacherRoutes);
  app.use('/api/teaching-hours', hoursRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
