import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import https from 'https';
import type { Logger } from './logger.js';

// Candidate field names for bot count — auto-detected from API response
const BOT_FIELD_CANDIDATES = ['bots', 'bot_clicks', 'lp_clicks_bot', 'bot', 'bot_count'] as const;

export interface ZoneStat {
  zone_id: string;
  clicks: number;    // "impressions" = clicks in Binom
  bot_count: number;
  _raw_bot_field?: string; // which field was used
}

export interface Campaign {
  id: string | number;
  filters?: {
    zone?: {
      type: string;
      values: string[];
    };
  };
  [key: string]: unknown;
}

export class BinomClient {
  private http: AxiosInstance;
  private logger: Logger;

  constructor(baseUrl: string, apiKey: string, logger: Logger) {
    this.logger = logger;

    const ignoreSSL = process.env.BINOM_IGNORE_SSL === 'true';
    if (ignoreSSL) {
      logger.warn('BINOM_IGNORE_SSL=true: skipping SSL certificate verification');
    }

    this.http = axios.create({
      baseURL: `${baseUrl.replace(/\/$/, '')}/public`,
      timeout: 15_000,
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: !ignoreSSL }),
    });

    axiosRetry(this.http, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) => {
        const status = err.response?.status;
        // Retry on network errors and 5xx, but not 401/404/429
        return axiosRetry.isNetworkOrIdempotentRequestError(err) ||
          (status !== undefined && status >= 500);
      },
    });
  }

  async getZoneStats(campaignId: string, dateFrom: string, dateTo: string): Promise<ZoneStat[]> {
    try {
      const response = await this.http.get('/api/v1/report/custom', {
        params: {
          campaign_id: campaignId,
          group_by: 'zone',
          date_from: dateFrom,
          date_to: dateTo,
          timezone: 0,
        },
      });

      const rows: unknown[] = Array.isArray(response.data)
        ? response.data
        : (response.data?.data ?? response.data?.rows ?? []);

      // Log raw first row at debug so we can identify field names
      if (rows.length > 0) {
        this.logger.debug(
          { campaign_id: campaignId, sample_row: rows[0] },
          'binom API raw zone row sample'
        );
      }

      return rows.map((row) => this.parseZoneRow(row));
    } catch (err) {
      this.handleApiError(err, `getZoneStats(campaign=${campaignId})`);
      return [];
    }
  }

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    try {
      const response = await this.http.get(`/api/v1/campaign/${campaignId}`);
      return response.data as Campaign;
    } catch (err) {
      this.handleApiError(err, `getCampaign(${campaignId})`);
      return null;
    }
  }

  async updateZoneBlacklist(campaignId: string, newZoneIds: string[]): Promise<void> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) return;

    const existing: string[] = campaign.filters?.zone?.values ?? [];
    const merged = Array.from(new Set([...existing, ...newZoneIds]));

    try {
      await this.http.put(`/api/v1/campaign/${campaignId}`, {
        ...campaign,
        filters: {
          ...(campaign.filters ?? {}),
          zone: {
            type: 'black',
            values: merged,
          },
        },
      });

      this.logger.info(
        { campaign_id: campaignId, total_blacklisted: merged.length, new_zones: newZoneIds },
        'blacklist updated'
      );
    } catch (err) {
      this.handleApiError(err, `updateZoneBlacklist(campaign=${campaignId})`);
    }
  }

  private parseZoneRow(row: unknown): ZoneStat {
    const r = row as Record<string, unknown>;

    const zoneId = String(r['zone_id'] ?? r['zone'] ?? r['id'] ?? '');
    const clicks = Number(r['clicks'] ?? r['impressions'] ?? 0);

    // Auto-detect bot field
    let botCount = 0;
    let rawBotField: string | undefined;
    for (const field of BOT_FIELD_CANDIDATES) {
      if (field in r && r[field] !== undefined && r[field] !== null) {
        botCount = Number(r[field]);
        rawBotField = field;
        break;
      }
    }

    return { zone_id: zoneId, clicks, bot_count: botCount, _raw_bot_field: rawBotField };
  }

  private handleApiError(err: unknown, context: string): void {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status === 401) {
        this.logger.error({ context }, 'Binom API: invalid API key (401)');
      } else if (status === 404) {
        this.logger.warn({ context }, 'Binom API: resource not found (404)');
      } else if (status === 429) {
        this.logger.warn({ context }, 'Binom API: rate limited (429)');
      } else {
        this.logger.error({ context, status, message: err.message }, 'Binom API request failed');
      }
    } else {
      this.logger.error({ context, err }, 'Unexpected error calling Binom API');
    }
  }
}
