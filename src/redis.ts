import Redis from 'ioredis';

const CAMPAIGN_MAP_KEY = 'binom:campaign_map';

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    client.on('error', (err) => {
      console.error('[redis] connection error:', err.message);
    });
  }
  return client;
}

export interface CampaignMapping {
  binom_id: string;
  admaven_id: string;
}

/** Returns all Binom→AdMaven campaign mappings, sorted by Binom id. */
export async function getCampaignMap(redis: Redis): Promise<CampaignMapping[]> {
  const map = await redis.hgetall(CAMPAIGN_MAP_KEY);
  return Object.entries(map)
    .map(([binom_id, admaven_id]) => ({ binom_id, admaven_id }))
    .sort((a, b) => a.binom_id.localeCompare(b.binom_id, undefined, { numeric: true }));
}

/**
 * Adds or updates a mapping. Returns true if a new field was created,
 * false if an existing Binom id was overwritten.
 */
export async function setMapping(redis: Redis, binomId: string, admavenId: string): Promise<boolean> {
  const created = await redis.hset(CAMPAIGN_MAP_KEY, binomId, admavenId);
  return created === 1;
}

export async function removeMapping(redis: Redis, binomId: string): Promise<boolean> {
  const removed = await redis.hdel(CAMPAIGN_MAP_KEY, binomId);
  return removed === 1;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
