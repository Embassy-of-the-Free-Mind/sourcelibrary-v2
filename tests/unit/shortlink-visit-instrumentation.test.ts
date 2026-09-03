import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// The last step of the share funnel was dark (#2047).
//
// `/q/<code>` answers 302 before anything renders, so no client-side pageview
// ever fires for a shortlink arrival: out of ~136K analytics events in the
// 30-day deep dive, shortlink visits contributed exactly zero. Nothing could
// say which books get shared, or whether a link pasted into Slack was ever
// opened — the destination pageview is byte-identical to a Google click.
//
// Two kinds of test, same split as the search-event instrumentation test:
//
//   1. BEHAVIOUR — drive `logShortlinkVisit` and assert on the document it
//      really writes (classification at write time, tenant, dedup, referrer).
//   2. ABSENCE — assert the route still calls the logger. A route that quietly
//      stops logging looks exactly like a shortlink nobody clicked, which is
//      the failure this whole issue was about.

const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: 'test' };
      },
    }),
  })),
}));

import { logShortlinkVisit } from '@/lib/shortlink-visit-log';

type Req = Parameters<typeof logShortlinkVisit>[0]['request'];

function req(headers: Record<string, string> = {}): Req {
  return {
    headers: new Headers({
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      host: 'sourcelibrary.org',
      'cf-connecting-ip': '203.0.113.45',
      'cf-ipcountry': 'NL',
      ...headers,
    }),
  } as unknown as Req;
}

/** The write is deferred; let its microtask chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

let ipCounter = 0;
/** A fresh /24 per test so the 60s ip+code dedup cache never crosses tests. */
function freshIp(): string {
  ipCounter += 1;
  return `198.51.${ipCounter}.7`;
}

beforeEach(() => {
  inserted.length = 0;
});

describe('logShortlinkVisit — the document it writes', () => {
  it('records the decoded target and classifies the request at write time', async () => {
    logShortlinkVisit({
      request: req({ 'cf-connecting-ip': freshIp(), referer: 'https://twitter.com/someone/status/1' }),
      code: 'aB3xQ',
      bookId: 'book-123',
      pageNumber: 42,
      targetPageId: 'page-abc',
    });
    await settle();

    expect(inserted).toHaveLength(1);
    const doc = inserted[0];
    expect(doc.event).toBe('shortlink_visit');
    expect(doc.code).toBe('aB3xQ');
    expect(doc.book_id).toBe('book-123');
    expect(doc.page_number).toBe(42);
    expect(doc.target_page_id).toBe('page-abc');
    expect(doc.referrer).toBe('twitter.com');
    expect(doc.country).toBe('NL');
    // Classified at ingest — the only moment the evidence exists (#3405).
    expect(doc.traffic_class).toBe('human');
    expect(doc.user_agent).toContain('Macintosh');
    expect(doc.host).toBe('sourcelibrary.org');
    // IP is anonymized to a /24 by the shared classifier.
    expect(String(doc.ip).endsWith('.0')).toBe(true);
  });

  it('carries the tenant when the link was opened in a partner reading room', async () => {
    logShortlinkVisit({
      request: req({
        'cf-connecting-ip': freshIp(),
        host: 'bph.sourcelibrary.org',
        'x-tenant-slug': 'bph',
        'x-tenant-id': 'bce03f71-c18d-4460-b8ad-224c817f9aa0',
      }),
      code: 'tenantCode',
      bookId: 'book-1',
      pageNumber: 3,
      targetPageId: 'page-3',
    });
    await settle();

    expect(inserted[0].tenant).toBe('bph');
    expect(inserted[0].tenantId).toBe('bce03f71-c18d-4460-b8ad-224c817f9aa0');
    expect(inserted[0].host).toBe('bph.sourcelibrary.org');
  });

  it('leaves tenant null on the canonical host', async () => {
    logShortlinkVisit({
      request: req({ 'cf-connecting-ip': freshIp() }),
      code: 'globalCode',
      bookId: 'book-1',
      pageNumber: 1,
      targetPageId: 'page-1',
    });
    await settle();
    expect(inserted[0].tenant).toBeNull();
  });

  it('collapses self-referrals (including tenant subdomains) to direct', async () => {
    logShortlinkVisit({
      request: req({ 'cf-connecting-ip': freshIp(), referer: 'https://bph.sourcelibrary.org/book/x' }),
      code: 'selfRef',
      bookId: 'book-1',
      pageNumber: 1,
      targetPageId: 'page-1',
    });
    await settle();
    expect(inserted[0].referrer).toBe('direct');
  });

  it('records a null target_page_id when the page is gone but the link was still clicked', async () => {
    logShortlinkVisit({
      request: req({ 'cf-connecting-ip': freshIp() }),
      code: 'missingPage',
      bookId: 'book-1',
      pageNumber: 999,
      targetPageId: null,
    });
    await settle();
    expect(inserted[0].target_page_id).toBeNull();
    expect(inserted[0].book_id).toBe('book-1');
  });

  it('stores bot traffic tagged rather than dropping it — an unfurl is not a reader', async () => {
    logShortlinkVisit({
      request: req({ 'cf-connecting-ip': freshIp(), 'user-agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' }),
      code: 'botCode',
      bookId: 'book-1',
      pageNumber: 1,
      targetPageId: 'page-1',
    });
    await settle();
    expect(inserted).toHaveLength(1);
    expect(inserted[0].traffic_class).not.toBe('human');
  });

  it('dedups the same ip+code inside the window but not a different code', async () => {
    const ip = freshIp();
    const base = { bookId: 'book-1', pageNumber: 1, targetPageId: 'page-1' };
    logShortlinkVisit({ request: req({ 'cf-connecting-ip': ip }), code: 'dupCode', ...base });
    logShortlinkVisit({ request: req({ 'cf-connecting-ip': ip }), code: 'dupCode', ...base });
    await settle();
    expect(inserted).toHaveLength(1);

    logShortlinkVisit({ request: req({ 'cf-connecting-ip': ip }), code: 'otherCode', ...base });
    await settle();
    expect(inserted).toHaveLength(2);
  });
});

describe('the /q/[code] route still logs', () => {
  const routeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/q/[code]/route.ts'),
    'utf8'
  );

  it('calls the shared logger', () => {
    expect(routeSrc).toContain("from '@/lib/shortlink-visit-log'");
    expect(routeSrc).toMatch(/logShortlinkVisit\(/);
  });

  it('logs only after the code has decoded, never from the invalid-shortlink catch', () => {
    const decodeAt = routeSrc.indexOf('decodeShortlink(code)');
    const logAt = routeSrc.indexOf('logShortlinkVisit({');
    const catchAt = routeSrc.indexOf('} catch');
    expect(decodeAt).toBeGreaterThan(-1);
    expect(logAt).toBeGreaterThan(decodeAt);
    expect(logAt).toBeLessThan(catchAt);
  });

  it('does not hand-roll its own analytics_events insert', () => {
    expect(routeSrc).not.toContain('analytics_events');
  });
});
