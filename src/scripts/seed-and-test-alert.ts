import { asc, gt } from 'drizzle-orm';
import { env } from '../config/env';
import { db, verifyDbConnection, pgPool } from '../config/db';
import { redisConnection } from '../config/redis';
import { contests, users, userChannels, userPreferences } from '../db/schema';
import { FanoutService } from '../modules/scheduler/fanout.service';
import { createDeliveryWorker } from '../modules/notification/delivery.worker';
import { deliveryQueue } from '../modules/notification/delivery.queue';
import { logger } from '../shared/logger';

async function main() {
  await verifyDbConnection();

  // 1. Upsert your personal user record
  const [user] = await db
    .insert(users)
    .values({
      email: env.SMTP_USER && env.SMTP_USER !== 'your-email@gmail.com'
        ? env.SMTP_USER
        : 'afzal@pulsecp.local',
      name: 'Md Afzal Ansari',
      timezone: 'Asia/Kolkata',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { isActive: true },
    })
    .returning();

  if (!user) throw new Error('Failed to seed user');

  // 2. Register your ntfy.sh phone channel & Email channel
  await db
    .insert(userChannels)
    .values([
      {
        userId: user.id,
        channelType: 'NTFY',
        destination: env.NTFY_DEFAULT_TOPIC,
        isEnabled: true,
      },
      {
        userId: user.id,
        channelType: 'EMAIL',
        destination: user.email,
        isEnabled: true,
      },
    ])
    .onConflictDoNothing();

  // 3. Subscribe you to all 4 platforms (24H and 30M reminders enabled)
  for (const platform of ['LEETCODE', 'CODEFORCES', 'CODECHEF', 'ATCODER'] as const) {
    await db
      .insert(userPreferences)
      .values({
        userId: user.id,
        platform,
        remind24h: true,
        remind30m: true,
      })
      .onConflictDoNothing();
  }

  logger.info(
    { userId: user.id, ntfyTopic: env.NTFY_DEFAULT_TOPIC },
    '✅ Seeded personal user profile, channels, and all 4 platform preferences!'
  );

  // 4. Pick the very next upcoming contest in PostgreSQL to test the full pipeline
  const [nextContest] = await db
    .select()
    .from(contests)
    .where(gt(contests.startTime, new Date()))
    .orderBy(asc(contests.startTime))
    .limit(1);

  if (!nextContest) {
    logger.warn('No upcoming contests found in DB. Run test-ingestion.ts first.');
    process.exit(0);
  }

  // 5. Start the Delivery Worker temporarily and trigger a real Fan-Out!
  const deliveryWorker = createDeliveryWorker();
  const fanoutService = new FanoutService();

  logger.info(
    { contest: nextContest.name, platform: nextContest.platform },
    '🧪 Firing live end-to-end Fan-Out test to your phone...'
  );

  await fanoutService.executeContestFanout(nextContest.id, '30M_BEFORE');

  // Wait 4 seconds for the BullMQ Delivery Worker to finish sending the HTTP push
  await new Promise((resolve) => setTimeout(resolve, 4000));

  await deliveryWorker.close();
  await deliveryQueue.close();
  await pgPool.end();
  await redisConnection.quit();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Seed and test script failed');
  process.exit(1);
});