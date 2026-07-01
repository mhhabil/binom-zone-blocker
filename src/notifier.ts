import axios from 'axios';
import type { CampaignResult } from './blocker.js';

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

export async function sendTelegramSummary(
  results: CampaignResult[],
  telegramConfig: TelegramConfig,
  dryRun: boolean
): Promise<void> {
  const affected = results.filter((r) => r.eliminated.length > 0);
  if (affected.length === 0) return;

  const prefix = dryRun ? '[DRY RUN] ' : '';
  const lines: string[] = [`${prefix}🚫 *Binom Zone Blocker — Run Summary*\n`];

  for (const result of affected) {
    lines.push(`📋 Binom \`${result.binom_campaign_id}\` → AdMaven \`${result.admaven_campaign_id}\``);
    for (const z of result.eliminated) {
      lines.push(
        `  • Zone \`${z.zone_id}\` — ${(z.bot_rate * 100).toFixed(1)}% bot ` +
        `(${z.clicks} clicks) [${z.rule}]`
      );
    }
    lines.push('');
  }

  const total = affected.reduce((s, r) => s + r.eliminated.length, 0);
  lines.push(`_Total: ${total} zone(s) ${dryRun ? 'would be eliminated' : 'eliminated in AdMaven'}_`);

  const text = lines.join('\n');

  await axios.post(
    `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`,
    {
      chat_id: telegramConfig.chat_id,
      text,
      parse_mode: 'Markdown',
    },
    { timeout: 10_000 }
  );
}
