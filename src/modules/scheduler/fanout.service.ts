import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../../config/db';
import { contests, userChannels, userPreferences, users } from '../../db/schema';
import { logger } from '../../shared/logger';
import {
  ChannelType,
  DeliveryBatchJobPayload,
  DeliveryTarget,
  ReminderType,
  deliveryQueue,
} from '../notification/delivery.queue';

const CURSOR_BATCH_SIZE = 1000;

export class FanoutService {
  /**
   * Executes O(1) cursor-based pagination over subscribed users for a contest
   * and pushes channel-grouped batches into the Stage 2 delivery queue.
   */
  public async executeContestFanout(
    contestId: string,
    reminderType: ReminderType
  ): Promise<{ totalUsersMatched: number; totalBatchesEnqueued: number }> {
    const contest = await db.query.contests.findFirst({
      where: eq(contests.id, contestId),
    });

    if (!contest) {
      logger.warn({ contestId }, '⚠️ Contest not found during fan-out; aborting');
      return { totalUsersMatched: 0, totalBatchesEnqueued: 0 };
    }

    if (contest.phase === 'FINISHED') {
      logger.info({ contestId, name: contest.name }, '⏭️ Contest already finished; skipping fan-out');
      return { totalUsersMatched: 0, totalBatchesEnqueued: 0 };
    }

    logger.info(
      { contestId: contest.id, contestName: contest.name, platform: contest.platform, reminderType },
      '📣 Starting cursor-based fan-out for contest...'
    );

    let lastCursorUserId: string | null = null;
    let totalUsersMatched = 0;
    let totalBatchesEnqueued = 0;

    const reminderColumn =
      reminderType === '24H_BEFORE'
        ? userPreferences.remind24h
        : userPreferences.remind30m;

    while (true) {
      // 1. Fetch up to 1,000 subscribed & active user IDs using the composite index
      const whereConditions = [
        eq(userPreferences.platform, contest.platform),
        eq(reminderColumn, true),
        eq(users.isActive, true),
      ];

      if (lastCursorUserId) {
        whereConditions.push(gt(userPreferences.userId, lastCursorUserId));
      }

      const matchedPrefs = await db
        .select({ userId: userPreferences.userId })
        .from(userPreferences)
        .innerJoin(users, eq(userPreferences.userId, users.id))
        .where(and(...whereConditions))
        .orderBy(asc(userPreferences.userId))
        .limit(CURSOR_BATCH_SIZE);

      if (matchedPrefs.length === 0) {
        break;
      }

      const batchUserIds = matchedPrefs.map((row) => row.userId);
      lastCursorUserId = batchUserIds[batchUserIds.length - 1] ?? null;
      totalUsersMatched += batchUserIds.length;

      // 2. Fetch all enabled notification channels for these 1,000 users in a single query
      const channels = await db
        .select({
          userId: userChannels.userId,
          channelType: userChannels.channelType,
          destination: userChannels.destination,
        })
        .from(userChannels)
        .where(
          and(
            inArray(userChannels.userId, batchUserIds),
            eq(userChannels.isEnabled, true)
          )
        );

      if (channels.length === 0) {
        if (matchedPrefs.length < CURSOR_BATCH_SIZE) break;
        continue;
      }

      // 3. Group targets by ChannelType (EMAIL, NTFY, TELEGRAM)
      const groupedByChannel: Record<ChannelType, DeliveryTarget[]> = {
        EMAIL: [],
        NTFY: [],
        TELEGRAM: [],
      };

      for (const ch of channels) {
        groupedByChannel[ch.channelType].push({
          userId: ch.userId,
          destination: ch.destination,
        });
      }

      // 4. Bulk enqueue one job per active channel for this cursor chunk
      const bulkJobs: {
        name: string;
        data: DeliveryBatchJobPayload;
      }[] = [];

      for (const channelType of ['EMAIL', 'NTFY', 'TELEGRAM'] as const) {
        const targets = groupedByChannel[channelType];
        if (targets.length === 0) continue;

        bulkJobs.push({
          name: `dispatch_${channelType}_${reminderType}`,
          data: {
            contest: {
              id: contest.id,
              platform: contest.platform,
              name: contest.name,
              url: contest.url,
              startTimeIso: contest.startTime.toISOString(),
              durationSeconds: contest.durationSeconds,
            },
            reminderType,
            channelType,
            targets,
          },
        });
      }

      if (bulkJobs.length > 0) {
        await deliveryQueue.addBulk(bulkJobs);
        totalBatchesEnqueued += bulkJobs.length;
      }

      // If we got fewer than 1,000 rows, we've reached the end of the cursor
      if (matchedPrefs.length < CURSOR_BATCH_SIZE) {
        break;
      }
    }

    logger.info(
      {
        contestName: contest.name,
        reminderType,
        totalUsersMatched,
        totalBatchesEnqueued,
      },
      '✅ Contest fan-out completed'
    );

    return { totalUsersMatched, totalBatchesEnqueued };
  }
}