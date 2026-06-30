import type { ThresholdRule } from './config.js';
import type { ZoneStat } from './binomClient.js';

export type RuleMatch = 'rule_1' | 'rule_2' | null;

export interface BlockDecision {
  shouldBlock: boolean;
  rule: RuleMatch;
  bot_rate: number;
  reason: string;
}

export interface Thresholds {
  rule_1: ThresholdRule;
  rule_2: ThresholdRule;
}

export function evaluateZone(
  zone: ZoneStat,
  thresholds: Thresholds,
  whitelistZones: string[]
): BlockDecision {
  const skip = (reason: string): BlockDecision => ({
    shouldBlock: false,
    rule: null,
    bot_rate: 0,
    reason,
  });

  if (whitelistZones.includes(zone.zone_id)) {
    return skip('whitelisted');
  }

  if (zone.clicks <= 0) {
    return skip('no clicks');
  }

  const bot_rate = zone.bot_count / zone.clicks;

  // Rule 1: high volume, looser threshold
  if (
    zone.clicks > thresholds.rule_1.min_impressions &&
    bot_rate >= thresholds.rule_1.min_bot_rate
  ) {
    return {
      shouldBlock: true,
      rule: 'rule_1',
      bot_rate,
      reason: `clicks=${zone.clicks} > ${thresholds.rule_1.min_impressions} AND bot_rate=${(bot_rate * 100).toFixed(1)}% >= ${thresholds.rule_1.min_bot_rate * 100}%`,
    };
  }

  // Rule 2: low volume, stricter threshold
  if (
    zone.clicks > thresholds.rule_2.min_impressions &&
    bot_rate >= thresholds.rule_2.min_bot_rate
  ) {
    return {
      shouldBlock: true,
      rule: 'rule_2',
      bot_rate,
      reason: `clicks=${zone.clicks} > ${thresholds.rule_2.min_impressions} AND bot_rate=${(bot_rate * 100).toFixed(1)}% >= ${thresholds.rule_2.min_bot_rate * 100}%`,
    };
  }

  return {
    shouldBlock: false,
    rule: null,
    bot_rate,
    reason: 'below thresholds',
  };
}
