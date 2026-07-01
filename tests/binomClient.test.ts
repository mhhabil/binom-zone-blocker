import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { BinomClient } from '../src/binomClient';
import pino from 'pino';

vi.mock('axios');
vi.mock('axios-retry', () => ({ default: vi.fn() }));

const mockLogger = pino({ level: 'silent' });
const mockedAxios = vi.mocked(axios, true);

describe('BinomClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses report rows into zone stats (name/clicks/bots)', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        report: [
          { name: '1204959_-1', clicks: '20256', bots: '516', unique_clicks: '1447' },
          { name: '1151269_-1', clicks: '18393', bots: '0' },
        ],
        totals: { clicks: '38649', bots: '516' },
      },
    });
    mockedAxios.create = vi.fn().mockReturnValue({ get: mockGet, defaults: { headers: {} } });

    const client = new BinomClient('https://example.com', 'key', mockLogger);
    const stats = await client.getZoneStats('326', '2026-06-30 00:00', '2026-06-30 23:59');

    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual({ zone_id: '1204959_-1', clicks: 20256, bot_count: 516 });
    expect(stats[1]).toEqual({ zone_id: '1151269_-1', clicks: 18393, bot_count: 0 });
  });

  it('requests report/campaign grouped by token_1', async () => {
    const mockGet = vi.fn().mockResolvedValue({ data: { report: [] } });
    mockedAxios.create = vi.fn().mockReturnValue({ get: mockGet, defaults: { headers: {} } });

    const client = new BinomClient('https://example.com', 'key', mockLogger);
    await client.getZoneStats('326', '2026-06-30 00:00', '2026-06-30 23:59');

    const [url, opts] = mockGet.mock.calls[0];
    expect(url).toBe('/api/v1/report/campaign');
    expect(opts.params['ids[]']).toBe('326');
    expect(opts.params['groupings[]']).toBe('token_1');
  });

  it('returns empty array on error and does not throw', async () => {
    const error = Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
      isAxiosError: true,
    });
    const mockGet = vi.fn().mockRejectedValue(error);
    mockedAxios.create = vi.fn().mockReturnValue({ get: mockGet, defaults: { headers: {} } });

    const client = new BinomClient('https://example.com', 'bad-key', mockLogger);
    const stats = await client.getZoneStats('326', '', '');

    expect(stats).toEqual([]);
  });
});
