import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import type { Logger } from './logger.js';

/**
 * Normalize a Binom token_1 `name` (e.g. "1204959_-1") into the AdMaven source id
 * ("1204959"). AdMaven's ##PLACEMENT_ID## encodes source_id + sub_source_id joined
 * by "_"; we blacklist at the source_id level.
 */
export function normalizeSourceId(name: string): string {
  return String(name).split('_')[0].trim();
}

export class AdMavenClient {
  private http: AxiosInstance;
  private logger: Logger;

  constructor(baseUrl: string, apiToken: string, logger: Logger) {
    this.logger = logger;

    this.http = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      timeout: 30_000,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    axiosRetry(this.http, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) => {
        const status = err.response?.status;
        return axiosRetry.isNetworkOrIdempotentRequestError(err) ||
          (status !== undefined && status >= 500);
      },
    });
  }

  /**
   * Add the given source ids to a campaign's blacklist (targeting with include=false).
   * `mode=add` appends to the existing list, so we don't need to fetch it first.
   * Source ids are normalized and de-duplicated before sending.
   */
  async eliminateZones(admavenCampaignId: number, sourceIds: string[]): Promise<boolean> {
    const values = Array.from(
      new Set(sourceIds.map(normalizeSourceId).filter((v) => v.length > 0))
    );

    if (values.length === 0) return false;

    try {
      await this.http.put(
        '/api/public/targeting/source_id',
        { id: admavenCampaignId, values, include: false },
        { params: { mode: 'add' } }
      );

      this.logger.info(
        { admaven_campaign_id: admavenCampaignId, count: values.length, source_ids: values },
        'admaven: source ids eliminated (blacklisted)'
      );
      return true;
    } catch (err) {
      this.handleApiError(err, `eliminateZones(campaign=${admavenCampaignId})`);
      return false;
    }
  }

  private handleApiError(err: unknown, context: string): void {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      if (status === 401) {
        this.logger.error({ context }, 'AdMaven API: unauthorized (401) — check ADMAVEN_API_TOKEN');
      } else if (status === 404) {
        this.logger.warn({ context }, 'AdMaven API: resource not found (404)');
      } else if (status === 429) {
        this.logger.warn({ context }, 'AdMaven API: rate limited (429)');
      } else {
        this.logger.error(
          { context, status, message: err.message, data: err.response?.data },
          'AdMaven API request failed'
        );
      }
    } else {
      this.logger.error({ context, err }, 'Unexpected error calling AdMaven API');
    }
  }
}
