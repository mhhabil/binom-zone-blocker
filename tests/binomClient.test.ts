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
    const mockInstance = {
      get: vi.fn(),
      put: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      defaults: { headers: {} },
    };
    mockedAxios.create = vi.fn().mockReturnValue(mockInstance);
  });

  it('auto-detects "bots" bot field from response', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [{ zone_id: '1', clicks: 500, bots: 200 }],
    });
    mockedAxios.create = vi.fn().mockReturnValue({ get: mockGet, defaults: { headers: {} } });

    const client = new BinomClient('https://example.com', 'key', mockLogger);
    const stats = await client.getZoneStats('101', '2026-06-30 00:00', '2026-06-30 23:59');

    expect(stats[0].bot_count).toBe(200);
    expect(stats[0]._raw_bot_field).toBe('bots');
  });

  it('auto-detects "bot_clicks" bot field from response', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      data: [{ zone_id: '2', clicks: 300, bot_clicks: 100 }],
    });
    mockedAxios.create = vi.fn().mockReturnValue({ get: mockGet, defaults: { headers: {} } });

    const client = new BinomClient('https://example.com', 'key', mockLogger);
    const stats = await client.getZoneStats('101', '2026-06-30 00:00', '2026-06-30 23:59');

    expect(stats[0].bot_count).toBe(100);
    expect(stats[0]._raw_bot_field).toBe('bot_clicks');
  });

  it('returns empty array on 401 and does not throw', async () => {
    const error = Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
      isAxiosError: true,
    });
    const mockGet = vi.fn().mockRejectedValue(error);
    mockedAxios.create = vi.fn().mockReturnValue({ get: mockGet, defaults: { headers: {} } });

    const client = new BinomClient('https://example.com', 'bad-key', mockLogger);
    const stats = await client.getZoneStats('101', '', '');

    expect(stats).toEqual([]);
  });

  it('merges existing blacklist with new zones on updateZoneBlacklist', async () => {
    const existingCampaign = {
      id: '101',
      filters: { zone: { type: 'black', values: ['old-zone'] } },
    };
    const mockGet = vi.fn().mockResolvedValue({ data: existingCampaign });
    const mockPut = vi.fn().mockResolvedValue({ data: {} });
    mockedAxios.create = vi.fn().mockReturnValue({
      get: mockGet,
      put: mockPut,
      defaults: { headers: {} },
    });

    const client = new BinomClient('https://example.com', 'key', mockLogger);
    await client.updateZoneBlacklist('101', ['new-zone-1', 'new-zone-2']);

    const putBody = mockPut.mock.calls[0][1];
    expect(putBody.filters.zone.values).toContain('old-zone');
    expect(putBody.filters.zone.values).toContain('new-zone-1');
    expect(putBody.filters.zone.values).toContain('new-zone-2');
  });
});
