import { describe, it, expect } from 'vitest';
import { orderRecordKeys, detectKeyOrder, keyedFieldOrder } from '@/lib/key-order-mark';

// #8150 slice 7. A simulated scrape of 1,000 /api/books/library rows: the
// detector must find a copy that kept the served key order, and find nothing
// on a re-sorted copy, on unmarked rows, or under the wrong key.
const SECRET = 'test-secret-key-order';
const OTHER = 'a-different-secret';

// The keys a library row carries today (route.ts bookProject + computed fields).
const FIELDS = [
  'id', 'slug', 'tenantId', 'title', 'display_title', 'author', 'author_id', 'year',
  'work_id', 'edition_key', 'edition_key_quality', 'thumbnail', 'image_display',
  'thumbnail_frame', 'language', 'published', 'pages_count', 'pages_ocr',
  'pages_translated', 'pages_translatable', 'pages_blank', 'translation_state',
  'translation_percent', 'is_first_translation', 'last_processed',
  'last_translation_at', 'work_date', 'tenant_slug',
];

function row(i: number): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const f of FIELDS) r[f] = f === 'id' ? `book-${i.toString(36)}-${i * 7919}` : `${f}:${i}`;
  return r;
}

const unmarked = Array.from({ length: 1000 }, (_, i) => row(i));
const served = unmarked.map(r => orderRecordKeys(r, { secret: SECRET }));
// What a scraper stores: parsed and re-serialised, order kept.
const scraped = JSON.parse(JSON.stringify(served)) as Record<string, unknown>[];

function sortKeys(r: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]]));
}

describe('orderRecordKeys', () => {
  it('changes order only: same keys, same values, id and title first', () => {
    const r = unmarked[3];
    const m = served[3];
    expect(Object.keys(m).slice(0, 2)).toEqual(['id', 'title']);
    expect(Object.keys(m).sort()).toEqual(Object.keys(r).sort());
    for (const k of Object.keys(r)) expect(m[k]).toBe(r[k]);
    expect(Object.keys(m)).not.toEqual(Object.keys(r));
  });

  it('is deterministic per record, so cached bytes do not change', () => {
    expect(JSON.stringify(orderRecordKeys(unmarked[5], { secret: SECRET })))
      .toBe(JSON.stringify(orderRecordKeys(unmarked[5], { secret: SECRET })));
    // and differs from record to record
    expect(Object.keys(served[5]).slice(2)).not.toEqual(Object.keys(served[6]).slice(2));
  });

  it('is a no-op with no key configured or no id', () => {
    expect(orderRecordKeys(unmarked[1], { secret: '' })).toBe(unmarked[1]);
    const noId = { title: 'x', b: 1, a: 2 };
    expect(orderRecordKeys(noId, { secret: SECRET })).toBe(noId);
  });

  it('never touches array order inside a value', () => {
    const r = { id: 'b1', title: 't', collections: ['primary', 'second'], a: 1, z: 2 };
    expect(orderRecordKeys(r, { secret: SECRET }).collections).toEqual(['primary', 'second']);
  });

  it('keyedFieldOrder depends on the key', () => {
    const f = FIELDS.slice(2);
    expect(keyedFieldOrder(f, 'b1', SECRET)).not.toEqual(keyedFieldOrder(f, 'b1', OTHER));
  });
});

describe('detectKeyOrder over a simulated 1,000-record scrape', () => {
  it('finds a copy with its ordering preserved', () => {
    const v = detectKeyOrder(scraped, { secret: SECRET });
    expect(v.scored).toBe(1000);
    expect(v.marked).toBe(true);
    expect(v.meanConcordance).toBe(1);
    expect(v.z).toBeGreaterThan(50);
  });

  it('still finds a copy that dropped fields and added its own', () => {
    const edited = scraped.map(r => {
      const { thumbnail, image_display, pages_blank, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...rest, scraped_at: '2026-11-04' };
    });
    const v = detectKeyOrder(edited, { secret: SECRET });
    expect(v.marked).toBe(true);
    expect(v.meanConcordance).toBeGreaterThan(0.85);
  });

  it('finds a small sample too (50 records)', () => {
    expect(detectKeyOrder(scraped.slice(0, 50), { secret: SECRET }).marked).toBe(true);
  });

  it('finds nothing on a re-sorted copy', () => {
    const v = detectKeyOrder(scraped.map(sortKeys), { secret: SECRET });
    expect(v.marked).toBe(false);
    expect(Math.abs(v.z)).toBeLessThan(6);
    expect(v.strongRecords).toBe(0);
  });

  it('finds nothing on unmarked records (false-positive check)', () => {
    const v = detectKeyOrder(unmarked, { secret: SECRET });
    expect(v.marked).toBe(false);
    expect(Math.abs(v.z)).toBeLessThan(6);
  });

  it('finds nothing on records marked under another key', () => {
    const foreign = unmarked.map(r => orderRecordKeys(r, { secret: OTHER }));
    const v = detectKeyOrder(foreign, { secret: SECRET });
    expect(v.marked).toBe(false);
    expect(Math.abs(v.z)).toBeLessThan(6);
  });
});
