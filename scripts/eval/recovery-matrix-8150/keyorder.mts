/**
 * PRIOR ART: src/lib/key-order-mark.ts detectKeyOrder (the detector, reused as is) and
 * tests/unit/key-order-mark.test.ts (a simulated 1,000-record scrape, re-sorted copy and unmarked records:
 * synthetic rows). This puts LIVE /api/books/library rows through what a scraper's tooling does to them.
 *
 * Slice 9 of #8150, the key-order rows. Fetches 1,000 live rows from production and reports, per
 * treatment, the detector's z and verdict (z >= 6 says "came from us"). The layer names no edition or
 * channel: every record names its own book, and one key serves every caller.
 *
 * Usage: node --env-file=.env.production.local node_modules/.bin/tsx scripts/eval/recovery-matrix-8150/keyorder.mts --out=DIR
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { detectKeyOrder } from '../../../src/lib/key-order-mark';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', '/tmp/s9');
const KEY = (process.env.SL_INTERNAL_KEY || fs.readFileSync(process.env.SL_INTERNAL_KEY_FILE || '/root/.sl-internal-key', 'utf8')).trim();
const SECRET = process.env.PROVENANCE_SECRET_KEY!;
type Row = Record<string, unknown>;

async function liveRows(n: number): Promise<Row[]> {
  const f = path.join(OUT, 'library-rows.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const rows: Row[] = [];
  for (let skip = 0; rows.length < n; skip += 100) {
    const r = await fetch(`https://sourcelibrary.org/api/books/library?limit=100&skip=${skip}`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`library ${r.status}`);
    const j = await r.json();
    const books = j.books as Row[];
    if (!books?.length) break;
    rows.push(...books);
  }
  // Text, not objects: the key order is what is being measured, and JSON.parse keeps it.
  fs.writeFileSync(f, JSON.stringify(rows.slice(0, n)));
  return rows.slice(0, n);
}

function rng(seed: string) {
  let x = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const reorder = (r: Row, keys: string[]) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
function toCsvAndBack(rows: Row[]): Row[] {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return rows.map((r) => Object.fromEntries(cols.filter((c) => r[c] !== undefined).map((c) => [c, r[c]])));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = await liveRows(1000);
  const shuffleRows = (xs: Row[], s: string) => { const r = rng(s); return xs.map((x) => [r(), x] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]); };
  const treatments: [string, (xs: Row[]) => Row[], string][] = [
    ['as served (1,000 rows)', (xs) => xs, 'ours'],
    ['JSON round trip (parse, stringify)', (xs) => JSON.parse(JSON.stringify(xs)), 'ours'],
    ['rows shuffled', (xs) => shuffleRows(xs, 'rows'), 'ours'],
    ['fields dropped (keep id + 6 of the rest)', (xs) => xs.map((r) => { const ks = Object.keys(r); return reorder(r, ['id', ...ks.filter((k) => k !== 'id').slice(0, 6)]); }), 'ours'],
    ['excerpt: 100 rows', (xs) => xs.slice(0, 100), 'ours'],
    ['excerpt: 30 rows', (xs) => xs.slice(0, 30), 'ours'],
    ['excerpt: 10 rows', (xs) => xs.slice(0, 10), 'ours'],
    ['keys re-sorted (jq -S, Python sort_keys)', (xs) => xs.map((r) => reorder(r, Object.keys(r).sort())), 'ours'],
    ['loaded into a table, one column order (pandas, CSV)', (xs) => toCsvAndBack(xs), 'ours'],
    ['FP: same records, keys in a random order each', (xs) => { const r = rng('fp'); return xs.map((x) => reorder(x, Object.keys(x).map((k) => [r(), k] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]))); }, 'not ours'],
    ['FP: same records, wrong key', (xs) => xs, 'not ours (wrong key)'],
  ];
  const out: any[] = [];
  for (const [name, f, truth] of treatments) {
    const xs = f(rows);
    const v = detectKeyOrder(xs, { secret: truth.includes('wrong key') ? 'not-the-provenance-key' : SECRET });
    out.push({ name, truth, records: v.records, scored: v.scored, z: Math.round(v.z * 10) / 10, mean: Math.round(v.meanConcordance * 1000) / 1000, marked: v.marked });
  }
  fs.writeFileSync(path.join(OUT, 'keyorder.json'), JSON.stringify(out, null, 1));
  console.log('treatment | truth | records | z | says ours');
  for (const o of out) console.log(`${o.name} | ${o.truth} | ${o.records} | ${o.z} | ${o.marked ? 'yes' : 'no'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
