import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { platformEnum, channelTypeEnum } from './enums';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).default('Asia/Kolkata').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userChannels = pgTable(
  'user_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelType: channelTypeEnum('channel_type').notNull(),
    destination: varchar('destination', { length: 255 }).notNull(), // Email address, ntfy topic, or Telegram chat ID
    isEnabled: boolean('is_enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userChannelUnique: uniqueIndex('uq_user_channel_dest').on(
      table.userId,
      table.channelType,
      table.destination
    ),
    userIdIdx: index('idx_user_channels_user_id').on(table.userId),
  })
);

export const userPreferences = pgTable(
  'user_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    remind24h: boolean('remind_24h').default(true).notNull(),
    remind30m: boolean('remind_30m').default(true).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userPlatformUnique: uniqueIndex('uq_user_prefs_user_platform').on(
      table.userId,
      table.platform
    ),
    // Composite B-Tree indexes for O(1) cursor-based fan-out pagination at 1M scale
    fanout24hIdx: index('idx_user_prefs_fanout_24h').on(
      table.platform,
      table.remind24h,
      table.userId
    ),
    fanout30mIdx: index('idx_user_prefs_fanout_30m').on(
      table.platform,
      table.remind30m,
      table.userId
    ),
  })
);