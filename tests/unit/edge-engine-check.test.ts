/**
 * The daily check that says when a search engine's crawler is being turned away
 * (v3 #79). Four times a rule written for scrapers has turned away a crawler the
 * policy welcomes, the last unnoticed until 2026-11-12. These pin the three ways
 * the check must not mislead: forged names must not set it off, a handful of
 * requests must not, and a query that returns nothing must not read as a quiet day.
 *
 * The fixtures are the edge log for 2026-11-12, the day the rule was found.
 */
import { describe, expect, it } from 'vitest';
import {
  ENGINE_MIN_REQUESTS,
  SEARCH_ENGINES,
  alarmChange,
  alarmMessage,
  checkEngines,
  ownNetworkCounts,
  // @ts-expect-error — plain .mjs worker, no types
} from '../../scripts/workers/edge-stops-daily.mjs';

type Group = { count: number; dimensions: { clientAsn: string; edgeResponseStatus: number; securityAction: string } };
const group = (clientAsn: number, edgeResponseStatus: number, securityAction: string, count: number): Group =>
  ({ count, dimensions: { clientAsn: String(clientAsn), edgeResponseStatus, securityAction } });

const DAY = '2026-11-12';
const engine = (agent: string, requests: number, asns: number[] | null, groups: Group[] = []) => ({
  agent, role: 'engine', requests, own_network: asns ? { asns, ...ownNetworkCounts(groups, asns) } : null,
});

// YandexBot from Yandex's network: challenged at the edge, then refused by the proxy once the edge let it in.
const YANDEX = [group(13238, 403, 'managed_challenge', 170), group(13238, 403, 'skip', 32), group(13238, 200, 'skip', 32), group(13238, 308, 'skip', 2)];
// Googlebot from Google's network, and the name forged from home connections, which are rightly blocked.
const GOOGLE = [group(15169, 200, 'skip', 685), group(15169, 304, 'skip', 128), group(15169, 301, 'skip', 28), group(15169, 404, 'skip', 25)];
const FORGED = [group(45899, 403, 'block', 150), group(7922, 403, 'block', 100), group(8151, 403, 'managed_challenge', 120)];

describe('ownNetworkCounts', () => {
  it('counts a challenge and a refusal by the site as turned away, and keeps them apart', () => {
    expect(ownNetworkCounts(YANDEX, [13238])).toEqual({ requests: 236, turned_away: 202, at_edge: 170, by_status: { 200: 32, 308: 2, 403: 202 } });
  });

  it('ignores requests from any other network, even if Cloudflare returned them', () => {
    expect(ownNetworkCounts([...GOOGLE, ...FORGED], [15169])).toMatchObject({ requests: 866, turned_away: 0 });
  });

  it('counts a rate-limit 429 and a redirect or a not-found differently', () => {
    const own = ownNetworkCounts([group(8075, 429, 'skip', 10), group(8075, 404, 'skip', 40), group(8075, 301, 'skip', 50)], [8075]);
    expect(own).toMatchObject({ requests: 100, turned_away: 10, at_edge: 0 });
  });
});

describe('checkEngines', () => {
  it('names the crawler, the share and the layer in one line', () => {
    const firing = checkEngines(DAY, [engine('Googlebot', 866, [15169], GOOGLE), engine('YandexBot', 236, [13238], YANDEX)]);
    expect(firing).toEqual([{
      key: 'YandexBot',
      line: 'YandexBot: 202 of 236 requests from its own network were turned away on 2026-11-12 (86%), 170 at the Cloudflare edge, 32 by the site (proxy or app).',
    }]);
  });

  it('says so when the edge let the crawler through and the site refused it', () => {
    const [finding] = checkEngines(DAY, [engine('YandexBot', 100, [13238], [group(13238, 403, 'skip', 75), group(13238, 200, 'skip', 25)])]);
    expect(finding.line).toContain('(75%), all by the site (proxy or app), not the edge.');
  });

  it('is not set off by forged requests from other networks', () => {
    // 370 forged and blocked against 866 real and served: 30% of the name, 0% of Google.
    expect(checkEngines(DAY, [engine('Googlebot', 1236, [15169], [...GOOGLE, ...FORGED])])).toEqual([]);
  });

  it('is not set off below the minimum, however large the share', () => {
    const few = [group(199064, 403, 'managed_challenge', 22), group(199064, 200, 'skip', 2)];
    expect(ENGINE_MIN_REQUESTS).toBe(50);
    expect(checkEngines(DAY, [engine('Qwantbot', 24, [199064], few)])).toEqual([]);
    const enough = [group(199064, 403, 'managed_challenge', 48), group(199064, 200, 'skip', 2)];
    expect(checkEngines(DAY, [engine('Qwantbot', 50, [199064], enough)]).map((f: { key: string }) => f.key)).toEqual(['Qwantbot']);
  });

  it('needs more than a fifth: exactly 20% is quiet', () => {
    const at = (blocked: number) => [engine('bingbot', 1000, [8075], [group(8075, 403, 'managed_challenge', blocked), group(8075, 200, 'skip', 1000 - blocked)])];
    expect(checkEngines(DAY, at(200))).toEqual([]);
    expect(checkEngines(DAY, at(201))[0].line).toContain('201 of 1,000 requests from its own network were turned away on 2026-11-12 (20.1%), all at the Cloudflare edge.');
  });

  it('counts a crawler with no confirmed network and never alarms on it', () => {
    // ExaSearchBot on 2026-11-12: 34,571 requests, nearly all challenged, from rented hosting.
    expect(checkEngines(DAY, [engine('Googlebot', 866, [15169], GOOGLE), engine('ExaSearchBot', 34571, null)])).toEqual([]);
  });

  it('reports an all-zero result as the check failing, not as a quiet day', () => {
    const zeros = SEARCH_ENGINES.map((e: { agent: string; asns: number[] | null }) => engine(e.agent, 0, e.asns));
    const firing = checkEngines(DAY, zeros);
    expect(firing).toHaveLength(1);
    expect(firing[0].key).toBe('instrument');
    expect(firing[0].line).toMatch(/could not run for 2026-11-12: every search crawler read zero/);
    expect(checkEngines(DAY, [])[0].key).toBe('instrument');
    expect(checkEngines(DAY, undefined)[0].key).toBe('instrument');
  });

  it('reports a failed query as the check failing', () => {
    expect(checkEngines(DAY, undefined, 'Authentication error')).toEqual([{ key: 'instrument', line: 'The search-crawler check could not run for 2026-11-12: Authentication error' }]);
  });

  it('says so when a crawler stops arriving from the network listed for it', () => {
    // The list going stale would otherwise make the check blind to that crawler, silently.
    const [finding] = checkEngines(DAY, [engine('Googlebot', 866, [15169], GOOGLE), engine('Applebot', 60, [714, 6185], FORGED)]);
    expect(finding.key).toBe('network:Applebot');
    expect(finding.line).toContain('60 requests carried the name on 2026-11-12 and none came from AS714 or AS6185.');
  });
});

describe('the alarm speaks on a change of state only', () => {
  const yandex = { key: 'YandexBot', line: 'YandexBot: 202 of 236 …' };
  const seznam = { key: 'SeznamBot', line: 'SeznamBot: 116 of 133 …' };
  const blind = { key: 'instrument', line: 'The search-crawler check could not run …' };

  it('pushes a new crawler once, with where to look', () => {
    const message = alarmMessage(alarmChange([], [yandex]));
    expect(message.title).toBe('Search crawler turned away: YandexBot');
    expect(message.priority).toBe('high');
    expect(message.body).toContain('• YandexBot: 202 of 236');
    expect(message.body).toContain('.claude/docs/invariants/crawler-access-gate.md');
    expect(message.body).toContain('src/proxy.ts');
    expect(alarmMessage(alarmChange(['YandexBot'], [yandex]))).toBeNull();
  });

  it('names only what is new, and mentions what is unchanged', () => {
    const change = alarmChange(['YandexBot'], [yandex, seznam]);
    expect(change.keys).toEqual(['SeznamBot', 'YandexBot']);
    const message = alarmMessage(change);
    expect(message.title).toBe('Search crawler turned away: SeznamBot');
    expect(message.body).toContain('Unchanged since the last report: YandexBot.');
  });

  it('says when everything has cleared, and stays quiet while one remains', () => {
    expect(alarmMessage(alarmChange(['SeznamBot', 'YandexBot'], []))).toMatchObject({ title: 'Search crawlers: cleared', priority: 'low' });
    expect(alarmMessage(alarmChange(['SeznamBot', 'YandexBot'], [yandex]))).toBeNull();
    expect(alarmMessage(alarmChange([], []))).toBeNull();
  });

  it('a blind check is its own message and points at the token and the query, not at the rules', () => {
    const message = alarmMessage(alarmChange(['YandexBot'], [blind]));
    expect(message.title).toBe('Search-crawler check is blind');
    expect(message.body).toContain('CLOUDFLARE_API_TOKEN_READ');
    expect(message.body).not.toContain('three layers');
  });
});

describe('SEARCH_ENGINES', () => {
  it('records the ten crawlers under one role', () => {
    expect(SEARCH_ENGINES.map((e: { agent: string }) => e.agent).sort()).toEqual(
      ['Amzn-SearchBot', 'Applebot', 'Baiduspider', 'DuckDuckBot', 'ExaSearchBot', 'Googlebot', 'Qwantbot', 'SeznamBot', 'YandexBot', 'bingbot'],
    );
    expect(new Set(SEARCH_ENGINES.map((e: { role: string }) => e.role))).toEqual(new Set(['engine']));
  });

  it('gives each crawler a network or an explicit null, never an empty list', () => {
    // An empty list would query no network and read as zero forever.
    for (const e of SEARCH_ENGINES as { agent: string; asns: number[] | null }[]) {
      if (e.asns !== null) expect(e.asns.length, e.agent).toBeGreaterThan(0);
      for (const asn of e.asns ?? []) expect(Number.isInteger(asn), e.agent).toBe(true);
    }
  });
});
