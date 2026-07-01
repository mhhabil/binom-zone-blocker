import type { Config } from './config.js';
import type { BinomClient, ZoneStat } from './binomClient.js';
import type { AdMavenClient } from './admavenClient.js';
import type { Logger } from './logger.js';
import type Redis from 'ioredis';
import { getCampaignMap } from './redis.js';
import { evaluateZone } from './rulesEngine.js';
import { sendTelegramSummary } from './notifier.js';

export interface EliminatedZoneInfo {
  zone_id: string;
  clicks: number;
  bot_count: number;
  bot_rate: number;
  rule: string;
}

export interface CampaignResult {
  binom_campaign_id: string;
  admaven_campaign_id: string;
  eliminated: EliminatedZoneInfo[];
  skipped: number;
  errors: string[];
}

function getDateRange(lookbackHours: number): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  // Binom expects "YYYY-MM-DD HH:mm:ss" (seconds required) with datePreset=custom_time.
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  return { dateFrom: fmt(from), dateTo: fmt(now) };
}

export async function runBlocker(
  config: Config,
  redis: Redis,
  binom: BinomClient,
  admaven: AdMavenClient,
  logger: Logger
): Promise<CampaignResult[]> {
  const mappings = await getCampaignMap(redis);

  if (mappings.length === 0) {
    logger.warn('No campaign mappings in Redis. Add Binom↔AdMaven mappings via the Web UI.');
    return [];
  }

  logger.info({ mappings, dry_run: config.dry_run }, 'validation run started');

  const { dateFrom, dateTo } = getDateRange(config.lookback_hours ?? 24);
  const results: CampaignResult[] = [];

  for (const { binom_id, admaven_id } of mappings) {
    const result: CampaignResult = {
      binom_campaign_id: binom_id,
      admaven_campaign_id: admaven_id,
      eliminated: [],
      skipped: 0,
      errors: [],
    };

    let zones: ZoneStat[];
    try {
      zones = await binom.getZoneStats(binom_id, dateFrom, dateTo);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
      logger.error({ binom_campaign_id: binom_id, err: msg }, 'failed to fetch zone stats');
      results.push(result);
      continue;
    }

    const toEliminate: string[] = [];

    for (const zone of zones) {
      const decision = evaluateZone(zone, config.thresholds, config.whitelist_zones ?? []);

      logger.info({
        timestamp: new Date().toISOString(),
        binom_campaign_id: binom_id,
        admaven_campaign_id: admaven_id,
        zone_id: zone.zone_id,
        clicks: zone.clicks,
        bot_count: zone.bot_count,
        bot_rate: parseFloat(decision.bot_rate.toFixed(4)),
        rule_matched: decision.rule,
        action: decision.shouldBlock ? (config.dry_run ? 'would_eliminate' : 'eliminated') : 'skipped',
        dry_run: config.dry_run,
      });

      if (decision.shouldBlock) {
        toEliminate.push(zone.zone_id);
        result.eliminated.push({
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

    if (toEliminate.length > 0 && !config.dry_run) {
      const admavenId = Number(admaven_id);
      if (!Number.isInteger(admavenId)) {
        const msg = `invalid admaven_campaign_id: ${admaven_id}`;
        result.errors.push(msg);
        logger.error({ binom_campaign_id: binom_id, admaven_campaign_id: admaven_id }, msg);
      } else {
        const ok = await admaven.eliminateZones(admavenId, toEliminate);
        if (!ok) result.errors.push('AdMaven elimination request failed');
      }
    }

    results.push(result);
  }

  logger.info(
    {
      total_campaigns: results.length,
      total_eliminated: results.reduce((s, r) => s + r.eliminated.length, 0),
      dry_run: config.dry_run,
    },
    'validation run completed'
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
