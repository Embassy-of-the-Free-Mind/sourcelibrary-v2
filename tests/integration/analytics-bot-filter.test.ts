import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';

/**
 * Write-time bot classification on the analytics event sink (#3405).
 *
 * These assertions exercise the route handler against a real (in-memory) Mongo
 * rather than asserting the shape of the source: each one fails if the
 * classification is removed, if a crawler's event is stored, or if a crawler is
 * allowed to bump the read counters. `read_count` in particular is not
 * cosmetic — it orders "popular" surfaces and selects which books get paid OCR
 * batches, so crawler inflation there spends money.
 */

vi.mock('@/lib/mongodb', async () => {
  const { getTestDb } = await import('../setup');
  return {
    getDb: vi.fn().mockImplementation(async () => getTestDb()),
    getReadDb: vi.fn().mockImplementation(async () => getTestDb()),
    connectToDatabase: vi.fn(),
    isConnectionError: vi.fn().mockReturnValue(false),
  };
});

import { POST as trackPost } from '@/app/api/analytics/track/route';

const HUMAN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function makePost(body: object, headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/analytics/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as never;
}

async function track(ua: string, ip: string, body: object) {
  const res = await trackPost(
    makePost(body, { 'user-agent': ua, 'x-forwarded-for': ip }) as never
  );
  return res.json();
}

describe('analytics event sink — write-time bot classification', () => {
  beforeEach(async () => {
    await cleanDb();
    const db = getTestDb();
    await db.collection('books').insertOne({ id: 'book-1', read_count: 0 });
    await db.collection('pages').insertOne({ id: 'page-1', read_count: 0 });
  });

  it('stores a human page_read with its traffic class and user-agent', async () => {
    const db = getTestDb();
    await track(HUMAN_UA, '203.0.113.10', { event: 'page_read', book_id: 'book-1', page_id: 'page-1' });

    const rows = await db.collection('analytics_events').find({ event: 'page_read' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].traffic_class).toBe('human');
    // Without a stored user-agent, contamination cannot be diagnosed after the
    // fact — that absence is what made #3405 unfixable retroactively.
    expect(rows[0].user_agent).toContain('Chrome');

    const page = await db.collection('pages').findOne({ id: 'page-1' });
    expect(page?.read_count).toBe(1);
  });

  it.each([
    ['GPTBot/1.2 (+https://openai.com/gptbot)', 'ai_trainer'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'search_crawler'],
    ['python-requests/2.31.0', 'other_bot'],
    ['Mozilla/5.0 HeadlessChrome/126.0.0.0 Safari/537.36', 'other_bot'],
  ])('drops page_read from %s and counts it as %s', async (ua, expectedClass) => {
    const db = getTestDb();
    await track(ua, '198.51.100.7', { event: 'page_read', book_id: 'book-1', page_id: 'page-1' });

    expect(await db.collection('analytics_events').countDocuments({})).toBe(0);

    const counter = await db.collection('analytics_events_class').findOne({});
    expect(counter?.class).toBe(expectedClass);
    expect(counter?.event).toBe('page_read');
    expect(counter?.count).toBe(1);
  });

  it('does not let a crawler inflate read_count', async () => {
    const db = getTestDb();
    for (let i = 0; i < 5; i++) {
      await track('CCBot/2.0 (https://commoncrawl.org/faq/)', `198.51.100.${i}`, {
        event: 'book_read',
        book_id: 'book-1',
      });
    }

    const book = await db.collection('books').findOne({ id: 'book-1' });
    expect(book?.read_count).toBe(0);
  });

  it('demotes a human-looking UA that blows past the per-IP event cap', async () => {
    const db = getTestDb();
    // Its own /24: the IP is anonymized to the last octet before bucketing, so
    // addresses that differ only in that octet share one cap — deliberate (it
    // bites a scraper walking a subnet), and it means a test reusing another
    // test's /24 would inherit its consumed budget.
    const ip = '192.0.2.200';
    // The cap is 1,000 events/day per anonymized IP. Sending 1,001 identical
    // events from one address is not a reading pattern; the 1,001st must be
    // classified as a bot even though the UA is a real browser string.
    for (let i = 0; i < 1001; i++) {
      await track(HUMAN_UA, ip, { event: 'page_edit', book_id: 'book-1' });
    }

    const stored = await db.collection('analytics_events').countDocuments({ event: 'page_edit' });
    expect(stored).toBe(1000);
    const counter = await db.collection('analytics_events_class').findOne({});
    expect(counter?.class).toBe('other_bot');
  });
});
