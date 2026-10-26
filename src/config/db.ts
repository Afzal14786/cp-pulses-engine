import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from './env';
import { logger } from '../shared/logger';
import * as schema from '../db/schema';

export const pgPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20, // Connection pool size for high-concurrency worker queries
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pgPool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

export const db = drizzle(pgPool, { schema });

export async function verifyDbConnection(): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('✅ PostgreSQL connection established successfully');
  } finally {
    client.release();
  }
}