import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs worker module, no types
import { scanKeysExact, quantizeI8, DIM } from '../../scripts/workers/vector-search/lib.mjs';

// The vector service's book_ids path (#2049), `match_pages_in_books`' question. What must hold:
//   - the answer is the exact top-k by cosine over exactly the keys given, with the RPC's `> threshold`;
//   - keys spread across two shards and across gaps are all read (the runs are only an I/O shape);
//   - a key a delta replaced is scored from its override, never from the stale shard row;
//   - a key in no shard and no override makes the scan answer null: never a partial answer.

const rnd = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
let dir: string;
const shards: { base: number; n: number; fh: fs.promises.FileHandle }[] = [];
const vecs: Float32Array[] = [];
const N0 = 300, N1 = 200;

const cos = (a: Float32Array, b: ArrayLike<number>) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < DIM; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-book-'));
  const r = rnd(7);
  let base = 0;
  for (const [i, n] of [N0, N1].entries()) {
    const buf = new Float32Array(n * DIM);
    for (let k = 0; k < n; k++) { const v = new Float32Array(DIM); for (let j = 0; j < DIM; j++) v[j] = r(); vecs.push(v); buf.set(v, k * DIM); }
    const f = path.join(dir, `shard-${i}.f32`);
    fs.writeFileSync(f, Buffer.from(buf.buffer));
    shards.push({ base, n, fh: await fs.promises.open(f, 'r') });
    base += n;
  }
});
afterAll(async () => { for (const s of shards) await s.fh.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('scanKeysExact', () => {
  it('is the brute-force top-k over the given keys, across shards and gaps', async () => {
    const q = vecs[17].map((x, i) => x + 0.3 * vecs[400][i]);
    const keys = [3, 4, 5, 17, 90, 91, 250, 299, 300, 301, 400, 480, 499];
    const want = keys.map((k) => ({ key: k, sim: cos(q, vecs[k]) })).filter((x) => x.sim > -1).sort((a, b) => b.sim - a.sim).slice(0, 5);
    const got = await scanKeysExact(q, keys, { shards, overrides: new Map(), threshold: -1, k: 5 });
    expect(got.map((x: { key: number }) => x.key)).toEqual(want.map((x) => x.key));
    got.forEach((x: { sim: number }, i: number) => expect(x.sim).toBeCloseTo(want[i].sim, 6));
  });

  it('keeps only similarity > threshold', async () => {
    const q = vecs[17];
    const got = await scanKeysExact(q, [17, 18, 19, 20], { shards, overrides: new Map(), threshold: 0.99, k: 10 });
    expect(got.map((x: { key: number }) => x.key)).toEqual([17]);
  });

  it('scores a replaced key from its override, not the shard', async () => {
    const q = vecs[42];
    const overrides = new Map([[17, quantizeI8(vecs[42])]]); // key 17 now holds a copy of 42's vector
    const got = await scanKeysExact(q, [17, 18], { shards, overrides, threshold: 0.5, k: 10 });
    expect(got.map((x: { key: number }) => x.key)).toEqual([17]);
    expect(got[0].sim).toBeGreaterThan(0.99);
  });

  it('answers null for a key it cannot read, rather than a partial list', async () => {
    const got = await scanKeysExact(vecs[1], [1, N0 + N1 + 5], { shards, overrides: new Map(), threshold: 0, k: 10 });
    expect(got).toBeNull();
  });
});
