import IORedis from 'ioredis';
import { env } from './env';
import { logger } from '../shared/logger';

export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  logger.info('✅ Redis connection established successfully');
});

redisConnection.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});