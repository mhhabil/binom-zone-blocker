import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import https from 'https';
import type { Logger } from './logger.js';

export interface ZoneStat {
  zone_id: string;   // Binom report `name` for token_1 (AdMaven placement, e.g. "1204959_-1")
  clicks: number;
  bot_count: number;
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
      timeout: 30_000,
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

  /**
   * Fetch per-source (zone) stats for a campaign, grouped by token_1 (the AdMaven
   * placement id). `dateFrom`/`dateTo` must be "YYYY-MM-DD HH:mm:ss" strings.
   */
  async getZoneStats(campaignId: string, dateFrom: string, dateTo: string): Promise<ZoneStat[]> {
    try {
      const response = await this.http.get('/api/v1/report/campaign', {
        params: {
          'ids[]': campaignId,
          'groupings[]': 'token_1',
          datePreset: 'custom_time',
          dateFrom,
          dateTo,
          timezone: 'UTC',
          sortColumn: 'clicks',
          sortType: 'desc',
        },
      });

      const rows: unknown[] = Array.isArray(response.data?.report)
        ? response.data.report
        : (response.data?.data ?? []);

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

  private parseZoneRow(row: unknown): ZoneStat {
    const r = row as Record<string, unknown>;
    return {
      zone_id: String(r['name'] ?? ''),
      clicks: Number(r['clicks'] ?? 0),
      bot_count: Number(r['bots'] ?? 0),
    };
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
