import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
// @ts-expect-error — plain .mjs analytics lib, no types
import { computeReadingDepth, computeMemberReadingDepth } from '../../scripts/lib/reading-depth.mjs';

/**
 * Reading depth has been wrong twice in two different ways (#3405 and the
 * fleet-passes-as-human finding that followed the fix). These assertions pin
 * both behaviours against seeded data rather than asserting the source shape:
 * each one fails if the filter, the exclusion, or the honesty reporting is
 * removed.
 */

const HOUR = 3600_000;

function pageReads(opts: {
  ip: string; book: string; pages: number; traffic_class?: string | null;
}) {
  const now = Date.now();
  return Array.from({ length: opts.pages }, (_, i) => ({
    event: 'page_read',
    book_id: opts.book,
    page_id: `${opts.book}-p${i}`,
    ip: opts.ip,
    timestamp: new Date(now - HOUR),
    created_at: new Date(now - HOUR),
    ...(opts.traffic_class === null ? {} : { traffic_class: opts.traffic_class ?? 'human' }),
  }));
}

async function seed(docs: object[]) {
  await getTestDb().collection('analytics_events').insertMany(docs as never[]);
}

const since = () => new Date(Date.now() - 24 * HOUR);

describe('computeReadingDepth', () => {
  beforeEach(cleanDb);

  it('refuses to report when the window is mostly unclassifiable pre-#3405 events', async () => {
    await seed([
      ...pageReads({ ip: '10.0.0.0', book: 'b1', pages: 60, traffic_class: null }),
      ...pageReads({ ip: '10.0.1.0', book: 'b2', pages: 10 }),
    ]);

    const d = await computeReadingDepth(getTestDb(), since());

    expect(d.contaminated).toBe(true);
    expect(d.unclassified).toBe(60);
    // No histogram fields at all — a caller cannot accidentally render a number.
    expect(d.median).toBeUndefined();
    expect(d.pairs).toBeUndefined();
  });

  it('counts only human-classified events', async () => {
    await seed([
      ...pageReads({ ip: '10.0.0.0', book: 'b1', pages: 12 }),
      ...pageReads({ ip: '10.0.9.0', book: 'b2', pages: 40, traffic_class: 'ai_trainer' }),
      ...pageReads({ ip: '10.0.8.0', book: 'b3', pages: 40, traffic_class: 'search_crawler' }),
    ]);

    const d = await computeReadingDepth(getTestDb(), since());

    expect(d.contaminated).toBeUndefined();
    expect(d.pairs).toBe(1);        // only the human reader-book pair
    expect(d.median).toBe(12);
    expect(d.deep).toBe(1);
  });

  it('excludes a fleet that passes UA classification as human, and says so', async () => {
    // Ten addresses, each walking one page of many books — the observed fleet
    // signature, and the shape that produced "81% read a single page".
    const fleet = Array.from({ length: 10 }, (_, i) =>
      Array.from({ length: 200 }, (_, b) =>
        pageReads({ ip: `43.173.${i}.0`, book: `fleet-b${b}`, pages: 1 })
      ).flat()
    ).flat();
    // Two genuine readers who read deeply.
    const readers = [
      ...pageReads({ ip: '10.0.0.0', book: 'real-1', pages: 30 }),
      ...pageReads({ ip: '10.0.1.0', book: 'real-2', pages: 25 }),
    ];
    await seed([...fleet, ...readers]);

    const d = await computeReadingDepth(getTestDb(), since(), { threshold: 150 });

    expect(d.excludedIps).toBe(10);
    expect(d.excludedEvents).toBe(2000);
    expect(d.excludedTopIps[0].ip).toMatch(/^43\.173\./);

    // Without the exclusion the fleet buries the readers: 2,002 pairs, median 1.
    expect(d.unfiltered.pairs).toBe(2002);
    expect(d.unfiltered.median).toBe(1);
    expect(d.unfiltered.oneOnly).toBe(2000);

    // With it, the two real readers are the whole population.
    expect(d.pairs).toBe(2);
    expect(d.median).toBeGreaterThanOrEqual(25);
    expect(d.oneOnly).toBe(0);
  });

  it('reports the unexcluded figures even when nothing is excluded', async () => {
    await seed(pageReads({ ip: '10.0.0.0', book: 'b1', pages: 5 }));

    const d = await computeReadingDepth(getTestDb(), since());

    expect(d.excludedIps).toBe(0);
    // The caller always has both numbers to compare, so "no exclusion applied"
    // is visible rather than implied by a missing field.
    expect(d.unfiltered.pairs).toBe(d.pairs);
  });
});

describe('computeMemberReadingDepth', () => {
  beforeEach(cleanDb);

  const session = (user: string, book: string, pages: number, viewed?: number) => ({
    user_id: user,
    book_id: book,
    pages_viewed: viewed ?? pages,
    pages_read: Array.from({ length: pages }, (_, i) => ({ page_id: `${book}-p${i}`, page_number: i + 1 })),
    updated_at: new Date(Date.now() - HOUR),
    started_at: new Date(Date.now() - HOUR),
  });

  it('returns null rather than a zeroed shape when there is nothing to report', async () => {
    expect(await computeMemberReadingDepth(getTestDb(), since())).toBeNull();
  });

  it('measures distinct pages, not page turns', async () => {
    // 40 turns across 4 distinct pages — someone flipping back and forth.
    // Depth must be 4; counting pages_viewed would claim a deep read.
    await getTestDb().collection('reading_history').insertOne(session('u1', 'b1', 4, 40) as never);

    const m = await computeMemberReadingDepth(getTestDb(), since());

    expect(m.median).toBe(4);
    expect(m.deep).toBe(0);
  });

  it('counts sessions, members and books separately', async () => {
    await getTestDb().collection('reading_history').insertMany([
      session('u1', 'b1', 30),
      session('u1', 'b2', 12),   // same member, second book, SAME sitting
      session('u2', 'b1', 1),    // same book, different member
      session('u3', 'b3', 60),
    ] as never[]);

    const m = await computeMemberReadingDepth(getTestDb(), since());

    expect(m.sessions).toBe(4);
    expect(m.users).toBe(3);
    expect(m.books).toBe(3);
    expect(m.deep).toBe(3);       // 30, 12, 60
    expect(m.veryDeep).toBe(1);   // 60
    expect(m.oneOnly).toBe(1);
    expect(m.totalPages).toBe(103);

    // u1 opened a second book an hour into the same sitting. That is breadth,
    // not retention — and it is exactly what the old `returningUsers` counted,
    // which is how "62% of members came back" got published when the day-based
    // figure was half that. The comment on the u1/b2 row above used to read
    // "-> returning"; the test asserted the bug and passed.
    expect(m.multiSessionUsers).toBe(1);  // for comparison only
    expect(m.multiBookUsers).toBe(1);
    expect(m.multiDayUsers).toBe(0);      // nobody came back
    expect(m.spanOver24hUsers).toBe(0);
  });

  it('counts a return only when a member reads on a later day', async () => {
    const db = getTestDb();
    await db.collection('reading_history').insertMany([
      session('sameday', 'b1', 5),
      session('sameday', 'b2', 5),
      session('returner', 'b1', 5),
      {
        ...session('returner', 'b1', 5),
        started_at: new Date(Date.now() - 72 * HOUR),
        updated_at: new Date(Date.now() - 72 * HOUR),
      },
    ] as never[]);

    // A 30-day window, not the 24h default the other cases use — a return has
    // to be able to land on a different calendar day to be observable at all.
    // 72h is a whole number of days, so the two dates always differ regardless
    // of what time the suite happens to run.
    const m = await computeMemberReadingDepth(db, new Date(Date.now() - 30 * 24 * HOUR));

    expect(m.users).toBe(2);
    expect(m.multiSessionUsers).toBe(2);  // both have >1 session
    expect(m.multiDayUsers).toBe(1);      // only one actually came back
    expect(m.spanOver24hUsers).toBe(1);
  });

  it('separates page mass from session counts', async () => {
    // Nine drive-by single pages and one long sitting. The shallow tail is 90%
    // of sessions and 10% of the reading; quoting sessions alone inverts it.
    const db = getTestDb();
    await db.collection('reading_history').insertMany([
      ...Array.from({ length: 9 }, (_, i) => session(`drive${i}`, 'b1', 1)),
      session('reader', 'b2', 90),
    ] as never[]);

    const m = await computeMemberReadingDepth(db, since());

    expect(m.oneOnly).toBe(9);
    expect(m.sessions).toBe(10);
    expect(m.totalPages).toBe(99);
    expect(m.pagesOneOnly).toBe(9);
    expect(m.pagesDeep).toBe(90);
  });

  it('ignores sessions outside the window', async () => {
    await getTestDb().collection('reading_history').insertMany([
      session('u1', 'b1', 20),
      { ...session('u2', 'b2', 99), updated_at: new Date(Date.now() - 90 * 24 * HOUR) },
    ] as never[]);

    const m = await computeMemberReadingDepth(getTestDb(), since());

    expect(m.sessions).toBe(1);
    expect(m.max).toBe(20);
  });
});
