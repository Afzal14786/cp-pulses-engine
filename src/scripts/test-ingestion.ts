import { verifyDbConnection, pgPool } from '../config/db';
import { IngestionService } from '../modules/ingestion/ingestion.service';
import { logger } from '../shared/logger';

async function main() {
  try {
    await verifyDbConnection();
    const ingestionService = new IngestionService();
    const summary = await ingestionService.syncAllPlatforms();

    console.log('\n================ UPCOMING CONTESTS SYNCED ================');
    for (const c of summary.inserted) {
      console.log(
        `[${c.platform.padEnd(10)}] ${c.name} | Starts: ${c.startTime.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
        })} IST`
      );
    }
    console.log('==========================================================\n');
  } catch (err) {
    logger.error({ err }, 'Ingestion test script failed');
  } finally {
    await pgPool.end();
    process.exit(0);
  }
}

main();