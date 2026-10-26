import { verifyDbConnection, pgPool } from '../config/db';
import { redisConnection } from '../config/redis';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { contestTriggerQueue } from '../modules/scheduler/trigger.queue';
import { logger } from '../shared/logger';

async function main() {
  try {
    await verifyDbConnection();
    const ingestionService = new IngestionService();

    // Ensure all 18 contests in DB have their delayed jobs scheduled in Redis
    await ingestionService.reconcileAllUpcomingTriggers();

    const jobCounts = await contestTriggerQueue.getJobCounts('delayed', 'waiting', 'active');
    const delayedJobs = await contestTriggerQueue.getDelayed(0, 10);

    console.log('\n================ BULLMQ REDIS TRIGGER QUEUE ================');
    console.log('Queue Counts:', jobCounts);
    console.log('\nSample Delayed Jobs in Redis (First 10):');
    for (const job of delayedJobs) {
      const fireDate = new Date(job.timestamp + (job.opts.delay ?? 0));
      console.log(
        `• JobID: ${job.id} | Type: ${job.data.reminderType.padEnd(10)} | Fires At: ${fireDate.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
        })} IST`
      );
    }
    console.log('============================================================\n');
  } catch (err) {
    logger.error({ err }, 'Scheduler test failed');
  } finally {
    await contestTriggerQueue.close();
    await pgPool.end();
    await redisConnection.quit();
    process.exit(0);
  }
}

main();