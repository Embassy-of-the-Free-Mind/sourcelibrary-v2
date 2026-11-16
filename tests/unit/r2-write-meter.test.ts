import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  R2_WRITE_FAMILIES,
  buildR2WriteMeterQuery,
  fetchR2WriteMeter,
  parseR2WriteMeter,
  previousUtcDay,
} from '@/lib/r2-write-meter';

// The response Cloudflare returned for 2026-11-12 (v3#94), trimmed to the groups.
const g = (requests: number, responseObjectSize: number) => [{ sum: { requests, responseObjectSize } }];
const LIVE = {
  data: {
    viewer: {
      accounts: [
        {
          total: g(1480411, 525084323452),
          pages: g(903667, 135783694967),
          pages_marked: g(59118, 29934560603),
          pages_thumb: g(451152, 2839236251),
          archived: g(574755, 388328380281),
          deepzoom: [],
        },
      ],
    },
  },
  errors: null,
};

describe('r2 write meter (v3#94)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('previousUtcDay is the last complete UTC day', () => {
    expect(previousUtcDay(new Date('2026-11-13T03:45:00Z'))).toBe('2026-11-12');
    expect(previousUtcDay(new Date('2026-11-01T00:00:01Z'))).toBe('2026-10-31');
  });

  it('asks for successful PutObject on one day, one group per family plus the total', () => {
    const q = buildR2WriteMeterQuery('acct123', '2026-11-12');
    expect(q).toContain('accountTag: "acct123"');
    expect(q.match(/r2OperationsAdaptiveGroups/g)).toHaveLength(Object.keys(R2_WRITE_FAMILIES).length + 1);
    expect(q.match(/actionType: "PutObject", actionStatus: "success"/g)).toHaveLength(6);
    expect(q.match(/date: "2026-11-12", bucketName: "sourcelibrary"/g)).toHaveLength(6);
    for (const [alias, like] of Object.entries(R2_WRITE_FAMILIES)) {
      expect(q).toContain(`${alias}: r2OperationsAdaptiveGroups`);
      expect(q).toContain(`objectName_like: "${like}"`);
    }
    // The total carries no name filter, or "other" could never be seen.
    expect(q.split('\n').find((l) => l.startsWith('total:'))).not.toContain('objectName_like');
  });

  it('refuses a day that is not YYYY-MM-DD', () => {
    expect(() => buildR2WriteMeterQuery('a', '2026-11-12" }')).toThrow(/bad day/);
  });

  it('parses the live shape; an empty group is zero; other = total minus top-level families', () => {
    const m = parseR2WriteMeter(LIVE, '2026-11-12');
    expect(m.day).toBe('2026-11-12');
    expect(m.families.archived).toEqual({ bytes: 388328380281, objects: 574755 });
    expect(m.families.deepzoom).toEqual({ bytes: 0, objects: 0 });
    expect(m.families.total.objects).toBe(1480411);
    // pages_marked / pages_thumb are subsets of pages and must not be subtracted twice.
    expect(m.families.other).toEqual({
      bytes: 525084323452 - 135783694967 - 388328380281,
      objects: 1480411 - 903667 - 574755,
    });
  });

  it('clamps "other" at zero when sampling puts the parts above the total', () => {
    const json = structuredClone(LIVE);
    json.data.viewer.accounts[0].total = g(10, 100);
    const m = parseR2WriteMeter(json, '2026-11-12');
    expect(m.families.other).toEqual({ bytes: 0, objects: 0 });
  });

  it('throws on a failed read instead of reporting zero writes', () => {
    expect(() => parseR2WriteMeter({ data: null, errors: [{ message: 'unknown field' }] }, '2026-11-12')).toThrow(
      /unknown field/,
    );
    expect(() => parseR2WriteMeter({ data: { viewer: { accounts: [] } } }, '2026-11-12')).toThrow(/failed/);
    const missing = structuredClone(LIVE) as { data: { viewer: { accounts: Record<string, unknown>[] } } };
    delete missing.data.viewer.accounts[0].archived;
    expect(() => parseR2WriteMeter(missing, '2026-11-12')).toThrow(/no "archived" group/);
  });

  it('fetch sends one request with trimmed credentials and returns the parsed meter', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123\n');
    vi.stubEnv('CF_ANALYTICS_TOKEN', 'tok\n');
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => LIVE })) as unknown as typeof fetch;
    const m = await fetchR2WriteMeter({ day: '2026-11-12', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string).query).toContain('accountTag: "acct123"');
    expect(m.families.pages.objects).toBe(903667);
  });

  it('fetch throws on an HTTP error instead of parsing the body', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'acct123');
    vi.stubEnv('CF_ANALYTICS_TOKEN', 'tok');
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => LIVE })) as unknown as typeof fetch;
    await expect(fetchR2WriteMeter({ day: '2026-11-12', fetchImpl })).rejects.toThrow(/HTTP 403/);
  });

  it('fetch throws when the credentials are missing', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', '');
    vi.stubEnv('CF_ANALYTICS_TOKEN', '');
    await expect(fetchR2WriteMeter({ day: '2026-11-12' })).rejects.toThrow(/not set/);
  });
});
