import { describe, it, expect } from 'vitest';
import { evaluateZone } from '../src/rulesEngine';
import type { ZoneStat } from '../src/binomClient';

const thresholds = {
  rule_1: { min_impressions: 500, min_bot_rate: 0.30 },
  rule_2: { min_impressions: 50, min_bot_rate: 0.50 },
};

const zone = (clicks: number, bot_count: number, zone_id = 'z1'): ZoneStat => ({
  zone_id,
  clicks,
  bot_count,
});

describe('evaluateZone', () => {
  it('blocks via rule_1: high volume, 30%+ bot', () => {
    const result = evaluateZone(zone(600, 200), thresholds, []);
    expect(result.shouldBlock).toBe(true);
    expect(result.rule).toBe('rule_1');
  });

  it('blocks via rule_2: low volume, 50%+ bot', () => {
    const result = evaluateZone(zone(100, 55), thresholds, []);
    expect(result.shouldBlock).toBe(true);
    expect(result.rule).toBe('rule_2');
  });

  it('skips zone below both thresholds', () => {
    const result = evaluateZone(zone(600, 100), thresholds, []); // 16.7% bot
    expect(result.shouldBlock).toBe(false);
    expect(result.rule).toBe(null);
  });

  it('skips zone with too few clicks for rule_2', () => {
    const result = evaluateZone(zone(30, 20), thresholds, []); // 66% bot but < 50 clicks
    expect(result.shouldBlock).toBe(false);
  });

  it('skips zone with 0 clicks (no division by zero)', () => {
    const result = evaluateZone(zone(0, 0), thresholds, []);
    expect(result.shouldBlock).toBe(false);
    expect(result.reason).toBe('no clicks');
  });

  it('skips zone with negative clicks', () => {
    const result = evaluateZone(zone(-1, 0), thresholds, []);
    expect(result.shouldBlock).toBe(false);
  });

  it('blocks at exactly rule_1 threshold (>500 clicks, =30% bot)', () => {
    // 501 clicks, 150 bot → exactly 29.9% → should NOT block rule_1
    const r1 = evaluateZone(zone(501, 150), thresholds, []);
    expect(r1.shouldBlock).toBe(false);

    // 501 clicks, 151 bot → 30.1% → should block rule_1
    const r2 = evaluateZone(zone(501, 151), thresholds, []);
    expect(r2.shouldBlock).toBe(true);
    expect(r2.rule).toBe('rule_1');
  });

  it('does not block whitelisted zone', () => {
    const result = evaluateZone(zone(600, 400, 'safe-zone'), thresholds, ['safe-zone']);
    expect(result.shouldBlock).toBe(false);
    expect(result.reason).toBe('whitelisted');
  });

  it('rule_1 takes precedence over rule_2 when both match', () => {
    // 600 clicks, 360 bot → 60% bot → matches both rules
    const result = evaluateZone(zone(600, 360), thresholds, []);
    expect(result.rule).toBe('rule_1');
  });
});
