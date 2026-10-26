import { env } from '../config/env';
import { db, verifyDbConnection, pgPool } from '../config/db';
import { users, userChannels, userPreferences } from '../db/schema';
import { logger } from '../shared/logger';

async function seed() {
  await verifyDbConnection();

  const email =
    env.SMTP_USER && env.SMTP_USER !== 'your-email@gmail.com'
      ? env.SMTP_USER
      : 'afzal@pulsecp.local';

  const [user] = await db
    .insert(users)
    .values({
      email,
      name: 'Md Afzal Ansari',
      timezone: 'Asia/Kolkata',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { isActive: true },
    })
    .returning();

  if (!user) throw new Error('Failed to upsert seed user');

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
    { userId: user.id, email: user.email, ntfyTopic: env.NTFY_DEFAULT_TOPIC },
    '✅ Seed complete! Use this userId with /api/preferences/:userId'
  );

  await pgPool.end();
  process.exit(0);
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});