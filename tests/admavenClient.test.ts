import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { AdMavenClient, normalizeSourceId } from '../src/admavenClient';
import pino from 'pino';

vi.mock('axios');
vi.mock('axios-retry', () => ({ default: vi.fn() }));

const mockLogger = pino({ level: 'silent' });
const mockedAxios = vi.mocked(axios, true);

describe('normalizeSourceId', () => {
  it('strips the sub-source suffix after "_"', () => {
    expect(normalizeSourceId('1204959_-1')).toBe('1204959');
    expect(normalizeSourceId('1204959')).toBe('1204959');
  });
});

describe('AdMavenClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PUTs normalized, de-duped source ids with include=false and mode=add', async () => {
    const mockPut = vi.fn().mockResolvedValue({ data: {} });
    mockedAxios.create = vi.fn().mockReturnValue({ put: mockPut, defaults: { headers: {} } });

    const client = new AdMavenClient('https://advertisers.ad-maven.com', 'token', mockLogger);
    const ok = await client.eliminateZones(9999, ['1204959_-1', '1204959_-2', '1243414_-1']);

    expect(ok).toBe(true);
    const [url, body, opts] = mockPut.mock.calls[0];
    expect(url).toBe('/api/public/targeting/source_id');
    expect(opts.params).toEqual({ mode: 'add' });
    expect(body.id).toBe(9999);
    expect(body.include).toBe(false);
    expect(body.values).toEqual(['1204959', '1243414']);
  });

  it('skips the request when there are no valid source ids', async () => {
    const mockPut = vi.fn();
    mockedAxios.create = vi.fn().mockReturnValue({ put: mockPut, defaults: { headers: {} } });

    const client = new AdMavenClient('https://advertisers.ad-maven.com', 'token', mockLogger);
    const ok = await client.eliminateZones(9999, ['', '   ']);

    expect(ok).toBe(false);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('returns false on API error without throwing', async () => {
    const error = Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
      isAxiosError: true,
    });
    const mockPut = vi.fn().mockRejectedValue(error);
    mockedAxios.create = vi.fn().mockReturnValue({ put: mockPut, defaults: { headers: {} } });

    const client = new AdMavenClient('https://advertisers.ad-maven.com', 'bad', mockLogger);
    const ok = await client.eliminateZones(9999, ['1204959_-1']);

    expect(ok).toBe(false);
  });
});
