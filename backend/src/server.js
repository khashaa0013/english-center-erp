// =====================================================================
// Сервер эхлүүлэх цэг
// =====================================================================
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`English Center ERP API: http://localhost:${env.port}/api (${env.nodeEnv})`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
