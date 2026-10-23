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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`${env.port} порт ашиглагдаж байна. Өөр сервер ажиллаж байгаа эсэхийг шалгана уу (эсвэл .env-д PORT солино).`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
