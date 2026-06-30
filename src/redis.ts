import Redis from 'ioredis';

const CAMPAIGNS_KEY = 'binom:tracked_campaigns';

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

export async function getCampaigns(redis: Redis): Promise<string[]> {
  const members = await redis.smembers(CAMPAIGNS_KEY);
  return members.sort();
}

export async function addCampaign(redis: Redis, id: string): Promise<boolean> {
  const added = await redis.sadd(CAMPAIGNS_KEY, id);
  return added === 1;
}

export async function removeCampaign(redis: Redis, id: string): Promise<boolean> {
  const removed = await redis.srem(CAMPAIGNS_KEY, id);
  return removed === 1;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
