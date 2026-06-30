import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';

dotenv.config();

export interface ThresholdRule {
  min_impressions: number;
  min_bot_rate: number;
}

export interface Config {
  binom: {
    base_url: string;
    api_key: string;
  };
  thresholds: {
    rule_1: ThresholdRule;
    rule_2: ThresholdRule;
  };
  lookback_hours: number;
  dry_run: boolean;
  whitelist_zones: string[];
  notifications: {
    enabled: boolean;
    telegram: {
      bot_token: string;
      chat_id: string;
    };
  };
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
}

function resolveConfig(obj: unknown): unknown {
  if (typeof obj === 'string') return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(resolveConfig);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, resolveConfig(v)])
    );
  }
  return obj;
}

export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? path.resolve(process.cwd(), 'config/config.yaml');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw) as unknown;
  const config = resolveConfig(parsed) as Config;

  if (!config.binom?.base_url) throw new Error('config: binom.base_url is required');
  if (!config.binom?.api_key) throw new Error('config: binom.api_key (BINOM_API_KEY env var) is required');

  return config;
}
