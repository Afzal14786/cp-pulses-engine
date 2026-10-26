import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { contests } from './contests';
import { users } from './users';
import { channelTypeEnum, reminderTypeEnum, deliveryStatusEnum } from './enums';

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contestId: uuid('contest_id')
      .notNull()
      .references(() => contests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelType: channelTypeEnum('channel_type').notNull(),
    reminderType: reminderTypeEnum('reminder_type').notNull(),
    destination: varchar('destination', { length: 255 }).notNull(),
    status: deliveryStatusEnum('status').default('PENDING').notNull(),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('uq_outbox_idempotency_key').on(
      table.contestId,
      table.userId,
      table.channelType,
      table.reminderType
    ),
  })
);