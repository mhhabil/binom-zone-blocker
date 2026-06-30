import { loadConfig } from './config.js';
import { getRedisClient, closeRedis } from './redis.js';
import { BinomClient } from './binomClient.js';
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

  // Worker mode: one-shot, then exit
  const client = new BinomClient(config.binom.base_url, config.binom.api_key, logger);

  try {
    await runBlocker(config, redis, client, logger);
  } finally {
    await closeRedis();
  }
}

main().catch((err) => {
  logger.error({ err }, 'fatal error');
  process.exit(1);
});
