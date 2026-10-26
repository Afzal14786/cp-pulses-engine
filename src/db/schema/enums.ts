import { pgEnum } from 'drizzle-orm/pg-core';

export const platformEnum = pgEnum('platform_type', [
  'LEETCODE',
  'CODEFORCES',
  'CODECHEF',
  'ATCODER',
]);

export const contestPhaseEnum = pgEnum('contest_phase', [
  'UPCOMING',
  'ONGOING',
  'FINISHED',
]);

export const channelTypeEnum = pgEnum('channel_type', [
  'EMAIL',
  'NTFY',
  'TELEGRAM',
]);

export const reminderTypeEnum = pgEnum('reminder_type', [
  '24H_BEFORE',
  '30M_BEFORE',
]);

export const deliveryStatusEnum = pgEnum('delivery_status', [
  'PENDING',
  'SENT',
  'FAILED',
]);