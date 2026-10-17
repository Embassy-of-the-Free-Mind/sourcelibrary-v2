import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs worker module, no types
import { openTextStore, textFingerprint, fpMatches, encodeVec, decodeVec, DIM } from '../../scripts/workers/vector-search/lib.mjs';

// The vector service's text store (#6821, the #6859 review). What must hold:
//   - an in-place edit that leaves updated_at alone (resyncMirrors, backfill-clean-snippets) is
//     visible to the reconcile: the stored fingerprint stops matching Supabase's;
//   - the reconcile's repair (`replace`) lands even when updated_at did not move or moved backwards,
//     and its fingerprint follows; the delta's `upsert` keeps refusing an older row;
//   - the length check alone misses a same-length edit and the hash catches it — which is why the
//     nightly pass runs with --hash;
//   - a row the store lacks never "matches".
// textFingerprint must equal FP_LEN_SQL / FP_HASH_SQL byte for byte; that was checked live on 3,000
// store rows against Supabase (2,010 non-ASCII), 0 disagreements — not something a unit test can do.

let dir: string;
let store: any;
const row = (over: Record<string, unknown> = {}) => ({
  page_id: 'p1', u: 100, translation: 'Hermes saith: as above, so below.', book_title: 'Tabula', book_author: 'Hermes', ...over,
});
// What the reconcile's scan gives for a Supabase row (the SQL computes these; here, the same function).
const scanRow = (r: Record<string, unknown>, withHash = true) => {
  const f = textFingerprint(r);
  return withHash ? { page_id: r.page_id, tl: f.tl, ml: f.ml, h: f.h } : { page_id: r.page_id, tl: f.tl, ml: f.ml };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-text-'));
  store = openTextStore(path.join(dir, 'pages.sqlite'));
});
afterEach(() => { store.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('text store fingerprints', () => {
  it('upsert writes the fingerprint, and an unchanged row matches', () => {
    store.upsert(row());
    expect(fpMatches(scanRow(row()), store.fp('p1'))).toBe(true);
  });

  it('an in-place edit with the same updated_at is seen, and replace repairs it', () => {
    store.upsert(row());
    const edited = row({ translation: 'Hermes saith: as above, so below. <note>fixed</note>' });
    expect(fpMatches(scanRow(edited, false), store.fp('p1'))).toBe(false);
    store.replace(edited);
    expect(store.db.prepare('SELECT translation FROM pages WHERE page_id = ?').get('p1').translation).toBe(edited.translation);
    expect(fpMatches(scanRow(edited), store.fp('p1'))).toBe(true);
  });

  it('replace lands when updated_at moved backwards; upsert does not', () => {
    store.upsert(row({ u: 200 }));
    const older = row({ u: 100, translation: 'other text' });
    expect(store.upsert(older).changes).toBe(0);
    expect(fpMatches(scanRow(older), store.fp('p1'))).toBe(false);
    store.replace(older);
    expect(fpMatches(scanRow(older), store.fp('p1'))).toBe(true);
  });

  it('a same-length edit passes the length check and fails the hash', () => {
    store.upsert(row());
    const swapped = row({ translation: 'Hermes saith: as below, so above.' });
    expect(swapped.translation.length).toBe(row().translation.length);
    expect(fpMatches(scanRow(swapped, false), store.fp('p1'))).toBe(true);
    expect(fpMatches(scanRow(swapped, true), store.fp('p1'))).toBe(false);
  });

  it('title/author edits count, lengths are UTF-8 bytes, and null translation differs from empty', () => {
    store.upsert(row());
    expect(fpMatches(scanRow(row({ book_author: 'Hermes Trismegistus' }), false), store.fp('p1'))).toBe(false);
    expect(textFingerprint({ translation: 'ſ' }).tl).toBe(2);
    expect(textFingerprint({ translation: null }).tl).toBe(-1);
    expect(textFingerprint({ translation: '' }).tl).toBe(0);
  });

  it('fpMany returns the same fingerprints as fp, and leaves out rows the store lacks', () => {
    for (let i = 0; i < 2500; i++) store.upsert(row({ page_id: `p${String(i).padStart(5, '0')}`, translation: `t${i}` }));
    const ask = ['p02000', 'zz-absent', 'p00007', 'p01999'];
    const got = store.fpMany(ask);
    expect([...got.keys()].sort()).toEqual(['p00007', 'p01999', 'p02000']);
    for (const pid of got.keys()) expect(Buffer.compare(Buffer.from(got.get(pid).h), Buffer.from(store.fp(pid).h))).toBe(0);
  });

  it('a row the store lacks never matches; remove drops the fingerprint', () => {
    expect(fpMatches(scanRow(row()), store.fp('p1'))).toBe(false);
    store.upsert(row());
    store.remove('p1');
    expect(store.fp('p1')).toBeUndefined();
  });
});

describe('apply wire format', () => {
  it('base64 vectors round-trip exactly, and a wrong length is refused', () => {
    const v = Array.from({ length: DIM }, (_, i) => Math.sin(i) / 30);
    const out = new Float32Array(DIM);
    expect(decodeVec(encodeVec(v), out)).toBe(out);
    expect(Array.from(out)).toEqual(Array.from(Float32Array.from(v)));
    expect(decodeVec(Buffer.alloc(12).toString('base64'), out)).toBeNull();
  });
});
