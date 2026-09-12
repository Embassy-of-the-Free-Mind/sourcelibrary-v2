/**
 * A spend instrument must read BOTH `gemini_usage` stores, and must date-scope
 * them by the field the rows actually carry.
 *
 * INCIDENT ONE (#3826, fixed #3835). `spend-guard.mjs` summed the Mongo store
 * while the logger wrote to Supabase. It read $9.00 on a day Supabase held
 * ~$830; the $15 dial never closed and the day billed ~$2.3K.
 *
 * INCIDENT TWO (this test, 2026-09-05). The same defect was living in
 * `spend-reconcile.mjs` — the audit written *because* of incident one, whose
 * entire job is catching a blind meter. Its metered side read Mongo alone, so
 * it reported August 2026 as 154,888 calls / $499.74 when the two stores hold
 * 305,800 / $2,316.68. Every downstream number inherited the error: meter
 * coverage read 37% (true: 72%), the billed-vs-metered gap read 11.1x (true:
 * 2.4x), and #4599 was filed against a 250K-call hole that is ~117K.
 *
 * The two stores are DISJOINT per row — the logger writes Supabase first and
 * falls back to Mongo only when the key is missing or the write errors — so the
 * instruction is always SUM, never pick.
 *
 * SECOND PROPERTY: the date field on these rows is `timestamp`, not
 * `created_at`. #4593 was filed the other way round; measured on the live
 * collection, 4,225,823 of 4,225,823 rows now carry `timestamp` and nothing
 * reads `created_at`. A date-scoped read keyed on `created_at` matches nothing
 * and reports a silent $0 — which is how that issue's audit concluded the store
 * had been dead since March.
 *
 * This asserts on source text because the property is structural — which stores
 * an instrument consults. Executing them needs Atlas, Supabase and a Google
 * token, and would prove less.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

/**
 * Every instrument that turns `gemini_usage` rows into a spend or call TOTAL.
 * Add to this list when you write another one — that is the point of the list.
 */
const SPEND_INSTRUMENTS = [
  'scripts/lib/spend-guard.mjs',
  'scripts/audit/spend-reconcile.mjs',
  'scripts/analysis/true-gemini-spend.mjs',
];

/** A Mongo read of the collection, in any of the spellings we use. */
const READS_MONGO = /collection\(['"]gemini_usage['"]\)/;
/** A Supabase read: PostgREST path or supabase-js table handle. */
const READS_SUPABASE = /rest\/v1\/gemini_usage|from\(['"]gemini_usage['"]\)/;

describe('spend instruments read both gemini_usage stores', () => {
  for (const rel of SPEND_INSTRUMENTS) {
    it(`${rel} sums Mongo AND Supabase`, () => {
      const src = read(rel);
      expect(READS_MONGO.test(src), `${rel} never reads the Mongo store`).toBe(true);
      expect(READS_SUPABASE.test(src), `${rel} never reads the Supabase store`).toBe(true);
    });
  }

  it('spend-reconcile suppresses its reconciliation when a store is unreadable', () => {
    // Fail loudly, per trap E: a partial meter reported as "the meter" is the
    // bug, not a smaller version of the answer.
    const src = read('scripts/audit/spend-reconcile.mjs');
    expect(src).toMatch(/METER UNREADABLE/);
    expect(src).toMatch(/mongo\.error \|\| supa\.error/);
  });
});

describe('gemini_usage rows are date-scoped by `timestamp`', () => {
  it('no spend instrument filters gemini_usage on created_at', () => {
    for (const rel of SPEND_INSTRUMENTS) {
      const src = read(rel);
      // `created_at` is legitimate on OTHER collections (batch_jobs carries it,
      // and true-gemini-spend reads that too), so only flag it where the query
      // is against gemini_usage itself.
      const offenders = src
        .split('\n')
        .map((line, i) => ({ line, no: i + 1 }))
        .filter(({ line }) => /gemini_usage/.test(line) && /created_at/.test(line));
      expect(offenders, `${rel} date-scopes gemini_usage by created_at, which matches nothing`).toEqual([]);
    }
  });
});
