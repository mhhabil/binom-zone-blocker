import type { Config } from './config.js';
import type { BinomClient, ZoneStat } from './binomClient.js';
import type { Logger } from './logger.js';
import type Redis from 'ioredis';
import { getCampaigns } from './redis.js';
import { evaluateZone } from './rulesEngine.js';
import { sendTelegramSummary } from './notifier.js';

export interface BlockedZoneInfo {
  zone_id: string;
  clicks: number;
  bot_count: number;
  bot_rate: number;
  rule: string;
}

export interface CampaignResult {
  campaign_id: string;
  blocked: BlockedZoneInfo[];
  skipped: number;
  errors: string[];
}

function getDateRange(lookbackHours: number): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
  return { dateFrom: fmt(from), dateTo: fmt(now) };
}

export async function runBlocker(
  config: Config,
  redis: Redis,
  client: BinomClient,
  logger: Logger
): Promise<CampaignResult[]> {
  const campaignIds = await getCampaigns(redis);

  if (campaignIds.length === 0) {
    logger.warn('No campaigns tracked in Redis. Add campaigns via the Web UI.');
    return [];
  }

  logger.info({ campaigns: campaignIds, dry_run: config.dry_run }, 'blocker run started');

  const { dateFrom, dateTo } = getDateRange(config.lookback_hours ?? 24);
  const results: CampaignResult[] = [];

  for (const campaignId of campaignIds) {
    const result: CampaignResult = { campaign_id: campaignId, blocked: [], skipped: 0, errors: [] };

    let zones: ZoneStat[];
    try {
      zones = await client.getZoneStats(campaignId, dateFrom, dateTo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
      logger.error({ campaign_id: campaignId, err: msg }, 'failed to fetch zone stats');
      results.push(result);
      continue;
    }

    const toBlock: string[] = [];

    for (const zone of zones) {
      const decision = evaluateZone(zone, config.thresholds, config.whitelist_zones ?? []);

      const logEntry = {
        timestamp: new Date().toISOString(),
        campaign_id: campaignId,
        zone_id: zone.zone_id,
        impressions: zone.clicks,
        bot_count: zone.bot_count,
        bot_rate: parseFloat(decision.bot_rate.toFixed(4)),
        rule_matched: decision.rule,
        action: decision.shouldBlock ? (config.dry_run ? 'would_block' : 'blocked') : 'skipped',
        dry_run: config.dry_run,
      };

      logger.info(logEntry);

      if (decision.shouldBlock) {
        toBlock.push(zone.zone_id);
        result.blocked.push({
          zone_id: zone.zone_id,
          clicks: zone.clicks,
          bot_count: zone.bot_count,
          bot_rate: decision.bot_rate,
          rule: decision.rule ?? '',
        });
      } else {
        result.skipped++;
      }
    }

    if (toBlock.length > 0 && !config.dry_run) {
      try {
        await client.updateZoneBlacklist(campaignId, toBlock);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(msg);
        logger.error({ campaign_id: campaignId, err: msg }, 'failed to update blacklist');
      }
    }

    results.push(result);
  }

  logger.info(
    {
      total_campaigns: results.length,
      total_blocked: results.reduce((s, r) => s + r.blocked.length, 0),
      dry_run: config.dry_run,
    },
    'blocker run completed'
  );

  if (config.notifications?.enabled && config.notifications.telegram?.bot_token) {
    try {
      await sendTelegramSummary(results, config.notifications.telegram, config.dry_run);
    } catch (err) {
      logger.warn({ err }, 'failed to send Telegram notification');
    }
  }

  return results;
}
