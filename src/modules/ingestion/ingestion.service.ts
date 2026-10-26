import crypto from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../../config/db';
import { contests, Contest } from '../../db/schema';
import { logger } from '../../shared/logger';
import {
  IContestProvider,
  NormalizedContest,
} from './interfaces/contest-provider.interface';
import { CodeforcesProvider } from './providers/codeforces.provider';
import { LeetCodeProvider } from './providers/leetcode.provider';
import { CodeChefProvider } from './providers/codechef.provider';
import { AtCoderProvider } from './providers/atcoder.provider';
import { scheduleContestTriggers } from '../scheduler/trigger.queue';

export interface SyncResult {
  inserted: Contest[];
  rescheduled: Contest[];
  unchangedCount: number;
  triggersScheduled: number;
}

export class IngestionService {
  private readonly providers: IContestProvider[];

  constructor() {
    this.providers = [
      new CodeforcesProvider(),
      new LeetCodeProvider(),
      new CodeChefProvider(),
      new AtCoderProvider(),
    ];
  }

  private computeScheduleHash(contest: NormalizedContest): string {
    const payload = `${contest.startTime.toISOString()}|${contest.durationSeconds}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  public async syncAllPlatforms(): Promise<SyncResult> {
    logger.info('🚀 Starting multi-platform contest ingestion sync...');

    const results = await Promise.allSettled(
      this.providers.map((provider) => provider.fetchUpcomingContests())
    );

    const fetchedContests: NormalizedContest[] = [];

    results.forEach((result, idx) => {
      const platformName = this.providers[idx]?.platform ?? 'UNKNOWN';
      if (result.status === 'fulfilled') {
        logger.info(
          { platform: platformName, fetched: result.value.length },
          '✅ Provider fetch succeeded'
        );
        fetchedContests.push(...result.value);
      } else {
        logger.error(
          { platform: platformName, err: result.reason },
          '❌ Provider fetch failed (isolated via Promise.allSettled)'
        );
      }
    });

    const syncSummary: SyncResult = {
      inserted: [],
      rescheduled: [],
      unchangedCount: 0,
      triggersScheduled: 0,
    };

    for (const item of fetchedContests) {
      const newHash = this.computeScheduleHash(item);

      const existing = await db.query.contests.findFirst({
        where: and(
          eq(contests.platform, item.platform),
          eq(contests.externalId, item.externalId)
        ),
      });

      if (!existing) {
        const [insertedRow] = await db
          .insert(contests)
          .values({
            platform: item.platform,
            externalId: item.externalId,
            name: item.name,
            url: item.url,
            startTime: item.startTime,
            durationSeconds: item.durationSeconds,
            phase: 'UPCOMING',
            scheduleHash: newHash,
          })
          .returning();

        if (insertedRow) {
          syncSummary.inserted.push(insertedRow);
          syncSummary.triggersScheduled += await scheduleContestTriggers(
            insertedRow,
            false
          );
        }
      } else if (existing.scheduleHash !== newHash) {
        const [updatedRow] = await db
          .update(contests)
          .set({
            name: item.name,
            url: item.url,
            startTime: item.startTime,
            durationSeconds: item.durationSeconds,
            scheduleHash: newHash,
            updatedAt: new Date(),
          })
          .where(eq(contests.id, existing.id))
          .returning();

        if (updatedRow) {
          syncSummary.rescheduled.push(updatedRow);
          syncSummary.triggersScheduled += await scheduleContestTriggers(
            updatedRow,
            true
          );
        }
      } else {
        syncSummary.unchangedCount++;
      }
    }

    logger.info(
      {
        insertedCount: syncSummary.inserted.length,
        rescheduledCount: syncSummary.rescheduled.length,
        unchangedCount: syncSummary.unchangedCount,
        triggersScheduled: syncSummary.triggersScheduled,
      },
      '🏁 Contest ingestion sync complete'
    );

    return syncSummary;
  }

  /**
   * Ensures all future contests in PostgreSQL have active BullMQ triggers in Redis.
   * Useful on worker startup or after a Redis flush.
   */
  public async reconcileAllUpcomingTriggers(): Promise<number> {
    const upcomingContests = await db.query.contests.findMany({
      where: gt(contests.startTime, new Date()),
    });

    let count = 0;
    for (const contest of upcomingContests) {
      count += await scheduleContestTriggers(contest, false);
    }

    logger.info(
      { upcomingContests: upcomingContests.length, triggersEnsured: count },
      '🔄 Reconciled Redis delayed triggers with PostgreSQL upcoming contests'
    );
    return count;
  }
}