#!/usr/bin/env node
/**
 * CLIP index recall at production scale (#3193). identify-bench.mjs ranks a
 * target against a pool of ~1K images with an exact cosine scan; production
 * ranks it against the whole `clip_embeddings` table (~333K rows) through the
 * pgvector index that `match_clip_images` hits. This script asks, for every
 * target of an earlier bench run: where does the true gallery image land in
 * the LIVE table, (a) the way production searches it and (b) exactly?
 *
 *   probes=1   what match_clip_images does today (ivfflat default)
 *   probes=N   the same index searching N of its lists (--probes=1,4,10)
 *   exact      sequential scan, no index — the model's true ranking at scale
 *
 * The gap between `exact` and `probes=1` is recall lost to the index, not to
 * the model; the gap between `exact` and the 1K-pool bench is what scale costs.
 *
 * Read-only: SELECTs inside a transaction with SET LOCAL, one query at a time,
 * 60 s statement timeout. Query images are the bench's cached wall photos and
 * crops (scripts/output/identify-bench/wall-photos/<key>-{wall,crop}.jpg),
 * embedded by the production CLIP server.
 *
 * Usage:
 *   secret-lover run -- node scripts/eval/clip-index-recall.mjs \
 *     scripts/eval/results/identify-matcher-bench-2026-09-28.json [--probes=1,4,10] [--kinds=crop,wall]
 *   (needs SUPABASE_DB_URL; writes <input>-index-recall.json next to the input)
 *   --column=embedding_v4 + CLIP_URL=<v4 server> ranks the #5099 shadow column
 *   (writes <input>-index-recall-embedding_v4.json). Before the v4 column has
 *   an index only `exact` is meaningful — pass --probes= to skip the ivfflat modes.
 *
 * PRIOR ART: scripts/eval/identify-bench.mjs — ranks against a sampled pool,
 * never the live index; scripts/audit/clip-index-integrity.mjs — checks row
 * integrity (drift, orphans, gaps), not retrieval recall.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { Client } = createRequire(import.meta.url)('pg');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMG = path.join(REPO, 'scripts', 'output', 'identify-bench', 'wall-photos');
const CLIP = process.env.CLIP_URL || 'http://46.224.122.120:3456/clip';
const input = process.argv[2];
if (!input || !process.env.SUPABASE_DB_URL) { console.error('usage: node clip-index-recall.mjs <bench results.json>  (needs SUPABASE_DB_URL)'); process.exit(1); }
const opt = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const PROBES = opt('probes', '1,4,10').split(',').filter(Boolean).map(Number);
const KINDS = opt('kinds', 'crop,wall').split(',');
const DEPTH = 200;
// --column=embedding_v4 ranks the #5099 shadow column instead of the live one.
// Point CLIP_URL at the server whose runtime wrote that column — a v4 query
// against v2 vectors measures neither space.
const COLUMN = opt('column', 'embedding');
if (!['embedding', 'embedding_v4', 'embedding_v2'].includes(COLUMN)) { console.error(`--column must be embedding, embedding_v4 or embedding_v2`); process.exit(1); }

const bench = JSON.parse(fs.readFileSync(input, 'utf8'));
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

async function topIds(embedding, settings) {
  await db.query('BEGIN');
  try {
    await db.query(`SET LOCAL statement_timeout = '60s'`);
    for (const s of settings) await db.query(s);
    const { rows } = await db.query(`SELECT id FROM clip_embeddings ORDER BY ${COLUMN} <=> $1::vector LIMIT ${DEPTH}`, [`[${embedding.join(',')}]`]);
    return rows.map(r => r.id);
  } finally { await db.query('COMMIT'); }
}
const MODES = [
  ...PROBES.map(p => [`probes=${p}`, [`SET LOCAL ivfflat.probes = ${p}`]]),
  ['exact', ['SET LOCAL enable_indexscan = off', 'SET LOCAL enable_bitmapscan = off']],
];

const rows = [];
for (const t of bench.perTarget) {
  const row = { key: t.key, stratum: t.stratum, id: t.id, bench: { Bcrop: t.Bcrop, B: t.B } };
  for (const kind of KINDS) {
    const file = path.join(IMG, `${t.key}-${kind}.jpg`);
    if (!fs.existsSync(file)) continue;
    const r = await fetch(`${CLIP}/embed-image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: fs.readFileSync(file).toString('base64'), mime_type: 'image/jpeg' }),
      signal: AbortSignal.timeout(60000),
    });
    const { embedding } = await r.json();
    row[kind] = {};
    for (const [name, settings] of MODES) {
      const ids = await topIds(embedding, settings);
      const i = ids.indexOf(`gallery-${t.id}`);
      row[kind][name] = i >= 0 ? i + 1 : null; // null = not in the top DEPTH
    }
  }
  rows.push(row);
  console.log(t.key.padEnd(4), t.stratum.padEnd(8), KINDS.map(k => `${k} ${JSON.stringify(row[k])}`).join(' '));
}
await db.end();

const summary = {};
for (const s of ['all', ...new Set(rows.map(r => r.stratum))]) {
  const rs = s === 'all' ? rows : rows.filter(r => r.stratum === s);
  summary[s] = { n: rs.length };
  for (const kind of KINDS) for (const [name] of MODES) {
    const ranks = rs.map(r => r[kind]?.[name]);
    const at = n => ranks.filter(x => x != null && x <= n).length;
    summary[s][`${kind}_${name}`] = { top1: at(1), top10: at(10), top20: at(20), notInTop200: ranks.filter(x => x == null).length };
  }
}
const out = input.replace(/\.json$/, COLUMN === 'embedding' ? '-index-recall.json' : `-index-recall-${COLUMN}.json`);
fs.writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), depth: DEPTH, probes: PROBES, column: COLUMN, clip_url: CLIP, summary, rows }, null, 1));
console.log(`\n-> ${out}`);
for (const [s, v] of Object.entries(summary)) {
  console.log(`${s} n=${v.n}: ` + Object.entries(v).filter(([k]) => k !== 'n').map(([k, x]) => `${k} ${x.top1}/${x.top10}/${x.top20} (miss ${x.notInTop200})`).join(' | '));
}
