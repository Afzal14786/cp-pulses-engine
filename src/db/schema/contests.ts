import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { platformEnum, contestPhaseEnum } from './enums';

export const contests = pgTable(
  'contests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    platform: platformEnum('platform').notNull(),
    externalId: varchar('external_id', { length: 128 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 512 }).notNull(),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    phase: contestPhaseEnum('phase').default('UPCOMING').notNull(),
    /**
     * SHA-256 or deterministic string of (startTime + durationSeconds).
     * Allows the Ingestion Engine to immediately detect if a platform rescheduled a contest.
     */
    scheduleHash: varchar('schedule_hash', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    platformExternalIdUnique: uniqueIndex('uq_contests_platform_external_id').on(
      table.platform,
      table.externalId
    ),
    startTimeIdx: index('idx_contests_start_time').on(table.startTime),
  })
);

export type Contest = typeof contests.$inferSelect;
export type NewContest = typeof contests.$inferInsert;