import { Queue, Worker } from 'bullmq';
import { verifyDbConnection, pgPool } from './config/db';
import { redisConnection } from './config/redis';
import { logger } from './shared/logger';
import { IngestionService } from './modules/ingestion/ingestion.service';
import { createTriggerWorker } from './modules/scheduler/trigger.worker';
import { createDeliveryWorker } from './modules/notification/delivery.worker';

const INGESTION_CRON_QUEUE = 'ingestion-cron-queue';

async function bootstrapWorker() {
  await verifyDbConnection();
  const ingestionService = new IngestionService();

  // 1. Run an immediate sync + trigger reconciliation on boot
  await ingestionService.syncAllPlatforms();
  await ingestionService.reconcileAllUpcomingTriggers();

  // 2. Schedule repeating 6-hour ingestion job in BullMQ
  const cronQueue = new Queue(INGESTION_CRON_QUEUE, { connection: redisConnection });
  await cronQueue.add(
    'sync-all-platforms',
    {},
    {
      repeat: { pattern: '0 */6 * * *' }, // Every 6 hours
      jobId: 'cron_sync_all_platforms',
    }
  );

  const cronWorker = new Worker(
    INGESTION_CRON_QUEUE,
    async () => {
      await ingestionService.syncAllPlatforms();
    },
    { connection: redisConnection }
  );

  // 3. Spin up Stage 1 (Trigger -> Fanout) and Stage 2 (Delivery) workers
  const triggerWorker = createTriggerWorker();
  const deliveryWorker = createDeliveryWorker();

  logger.info('⚙️ PulseCP Background Workers (Ingestion Cron + Trigger + Delivery) are LIVE');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down workers gracefully...');
    await Promise.all([
      cronWorker.close(),
      triggerWorker.close(),
      deliveryWorker.close(),
      cronQueue.close(),
    ]);
    await pgPool.end();
    await redisConnection.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrapWorker().catch((err) => {
  logger.fatal({ err }, 'Failed to bootstrap worker process');
  process.exit(1);
});