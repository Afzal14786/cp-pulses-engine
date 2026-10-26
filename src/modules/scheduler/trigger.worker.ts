import { Worker, Job } from 'bullmq';
import { redisConnection } from '../../config/redis';
import { logger } from '../../shared/logger';
import {
  CONTEST_TRIGGER_QUEUE_NAME,
  ContestTriggerJobPayload,
} from './trigger.queue';
import { FanoutService } from './fanout.service';

const fanoutService = new FanoutService();

export function createTriggerWorker(): Worker<ContestTriggerJobPayload> {
  const worker = new Worker<ContestTriggerJobPayload>(
    CONTEST_TRIGGER_QUEUE_NAME,
    async (job: Job<ContestTriggerJobPayload>) => {
      const { contestId, reminderType } = job.data;
      logger.info(
        { jobId: job.id, contestId, reminderType },
        '🔔 Stage 1 Contest Trigger fired! Initiating Stage 2 Fan-Out...'
      );

      return await fanoutService.executeContestFanout(contestId, reminderType);
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  worker.on('completed', (job, result) => {
    logger.info(
      { jobId: job.id, result },
      '✅ Trigger worker job completed successfully'
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      '❌ Trigger worker job failed'
    );
  });

  return worker;
}