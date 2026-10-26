import { eq, asc, gt } from 'drizzle-orm';
import { db } from '../../config/db';
import {
  users,
  userChannels,
  userPreferences,
  contests,
} from '../../db/schema';
import { AppError } from '../../shared/errors';
import { PlatformType } from '../ingestion/interfaces/contest-provider.interface';
import { ChannelType, deliveryQueue } from '../notification/delivery.queue';

export class PreferencesService {
  public async getAllUsers() {
    return await db.select().from(users).orderBy(asc(users.createdAt));
  }

  public async getUserProfile(userId: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new AppError(`User with ID ${userId} not found`, 404);
    }

    const [channels, preferences] = await Promise.all([
      db.select().from(userChannels).where(eq(userChannels.userId, userId)),
      db.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    ]);

    return {
      user,
      channels,
      preferences,
    };
  }

  public async upsertPlatformPreference(
    userId: string,
    platform: PlatformType,
    remind24h: boolean,
    remind30m: boolean
  ) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new AppError('User not found', 404);

    const [updated] = await db
      .insert(userPreferences)
      .values({
        userId,
        platform,
        remind24h,
        remind30m,
      })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.platform],
        set: {
          remind24h,
          remind30m,
          updatedAt: new Date(),
        },
      })
      .returning();

    return updated;
  }

  public async upsertUserChannel(
    userId: string,
    channelType: ChannelType,
    destination: string,
    isEnabled: boolean
  ) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new AppError('User not found', 404);

    const [channel] = await db
      .insert(userChannels)
      .values({
        userId,
        channelType,
        destination,
        isEnabled,
      })
      .onConflictDoUpdate({
        target: [
          userChannels.userId,
          userChannels.channelType,
          userChannels.destination,
        ],
        set: { isEnabled },
      })
      .returning();

    return channel;
  }

  public async sendInstantTestAlert(userId: string) {
    const profile = await this.getUserProfile(userId);
    const activeChannels = profile.channels.filter((c) => c.isEnabled);

    if (activeChannels.length === 0) {
      throw new AppError('No enabled notification channels found for this user', 400);
    }

    const [nextContest] = await db
      .select()
      .from(contests)
      .where(gt(contests.startTime, new Date()))
      .orderBy(asc(contests.startTime))
      .limit(1);

    if (!nextContest) {
      throw new AppError('No upcoming contests in database to test with', 404);
    }

    for (const ch of activeChannels) {
      await deliveryQueue.add(`manual_test_${ch.channelType}`, {
        contest: {
          id: nextContest.id,
          platform: nextContest.platform,
          name: `[TEST] ${nextContest.name}`,
          url: nextContest.url,
          startTimeIso: nextContest.startTime.toISOString(),
          durationSeconds: nextContest.durationSeconds,
        },
        reminderType: '30M_BEFORE',
        channelType: ch.channelType,
        targets: [{ userId: profile.user.id, destination: ch.destination }],
      });
    }

    return {
      message: 'Test alert enqueued to delivery worker',
      contestTested: nextContest.name,
      channelsTriggered: activeChannels.map((c) => ({
        type: c.channelType,
        destination: c.destination,
      })),
    };
  }
}