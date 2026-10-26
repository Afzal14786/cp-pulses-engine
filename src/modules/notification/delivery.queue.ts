import { Queue } from 'bullmq';
import { redisConnection } from '../../config/redis';
import { PlatformType } from '../ingestion/interfaces/contest-provider.interface';

export type ChannelType = 'EMAIL' | 'NTFY' | 'TELEGRAM';
export type ReminderType = '24H_BEFORE' | '30M_BEFORE';

export interface DeliveryTarget {
  userId: string;
  destination: string;
}

export interface DeliveryBatchJobPayload {
  contest: {
    id: string;
    platform: PlatformType;
    name: string;
    url: string;
    startTimeIso: string;
    durationSeconds: number;
  };
  reminderType: ReminderType;
  channelType: ChannelType;
  targets: DeliveryTarget[];
}

export const DELIVERY_QUEUE_NAME = 'delivery-queue';

export const deliveryQueue = new Queue<DeliveryBatchJobPayload>(
  DELIVERY_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000, // 3s -> 6s -> 12s retry backoff on rate-limit or network blips
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }
);