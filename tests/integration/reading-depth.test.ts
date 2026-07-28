import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
// @ts-expect-error — plain .mjs analytics lib, no types
import { computeReadingDepth } from '../../scripts/lib/reading-depth.mjs';

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
