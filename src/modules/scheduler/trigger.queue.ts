import { Queue } from 'bullmq';
import { redisConnection } from '../../config/redis';
import { Contest } from '../../db/schema';
import { ReminderType } from '../notification/delivery.queue';
import { logger } from '../../shared/logger';

export interface ContestTriggerJobPayload {
  contestId: string;
  reminderType: ReminderType;
}

export const CONTEST_TRIGGER_QUEUE_NAME = 'contest-trigger-queue';

export const contestTriggerQueue = new Queue<ContestTriggerJobPayload>(
  CONTEST_TRIGGER_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: 100,
    },
  }
);

const REMINDER_OFFSETS_MS: Record<ReminderType, number> = {
  '24H_BEFORE': 24 * 60 * 60 * 1000,
  '30M_BEFORE': 30 * 60 * 1000,
};

/**
 * Deterministic Job ID (No colons allowed in BullMQ v5 custom jobIds)
 */
export function buildTriggerJobId(contestId: string, reminderType: ReminderType): string {
  return `trigger_${contestId}_${reminderType}`;
}

/**
 * Schedules or reschedules the 24H_BEFORE and 30M_BEFORE triggers for a contest.
 */
export async function scheduleContestTriggers(
  contest: Contest,
  isRescheduled = false
): Promise<number> {
  const now = Date.now();
  const startTimeMs = contest.startTime.getTime();
  let scheduledCount = 0;

  for (const reminderType of ['24H_BEFORE', '30M_BEFORE'] as const) {
    const jobId = buildTriggerJobId(contest.id, reminderType);
    const triggerTimeMs = startTimeMs - REMINDER_OFFSETS_MS[reminderType];
    const delayMs = triggerTimeMs - now;

    // If the contest was rescheduled, remove any existing job with this deterministic ID first
    if (isRescheduled) {
      const existingJob = await contestTriggerQueue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
        logger.info({ jobId, contestName: contest.name }, '♻️ Removed stale trigger job for rescheduled contest');
      }
    }

    // Skip if the reminder window has already passed (e.g., contest starts in 10 hours -> skip 24H_BEFORE)
    if (delayMs <= 0) {
      logger.debug(
        { contestName: contest.name, reminderType },
        '⏭️ Skipping trigger (reminder window already in the past)'
      );
      continue;
    }

    await contestTriggerQueue.add(
      reminderType,
      {
        contestId: contest.id,
        reminderType,
      },
      {
        jobId,
        delay: delayMs,
      }
    );

    scheduledCount++;
    logger.debug(
      {
        jobId,
        contestName: contest.name,
        reminderType,
        firesInHours: +(delayMs / (1000 * 60 * 60)).toFixed(2),
      },
      '⏰ Scheduled contest trigger in Redis'
    );
  }

  return scheduledCount;
}