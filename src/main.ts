import { loadConfig } from './config.js';
import { getRedisClient, closeRedis } from './redis.js';
import { BinomClient } from './binomClient.js';
import { AdMavenClient } from './admavenClient.js';
import { logger } from './logger.js';
import { runBlocker } from './blocker.js';
import { startServer } from './web/server.js';

const mode = process.argv.includes('--web') ? 'web' : 'worker';

async function main(): Promise<void> {
  const config = loadConfig();
  const redis = getRedisClient();

  if (mode === 'web') {
    startServer(redis, logger);
    // Keep process alive; Redis and Express manage their own lifecycle
    return;
  }

  const binom = new BinomClient(config.binom.base_url, config.binom.api_key, logger);
  const admaven = new AdMavenClient(config.admaven.base_url, config.admaven.api_token, logger);

  const intervalMin = Number(process.env.RUN_INTERVAL_MINUTES ?? 0);

  if (intervalMin > 0) {
    // Auto/loop mode: keep running on an interval (good for Docker single-container).
    logger.info({ interval_minutes: intervalMin }, 'worker started in auto (loop) mode');
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await runBlocker(config, redis, binom, admaven, logger);
      } catch (err) {
        logger.error({ err }, 'run failed; will retry next interval');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMin * 60 * 1000));
    }
  }

  // One-shot mode (good for host crontab): run once, then exit.
  try {
    await runBlocker(config, redis, binom, admaven, logger);
  } finally {
    await closeRedis();
  }
}

main().catch((err) => {
  logger.error({ err }, 'fatal error');
  process.exit(1);
});
