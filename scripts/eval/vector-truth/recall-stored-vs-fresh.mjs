#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/embed-models/score.mjs (#6172) scored the Librarian golden set with stored
 * and fresh vectors over an eval POOL of 10,888 pages; it cannot say what one drift class costs in
 * the production index. scripts/audit/page-vector-truth.mjs --explain names the class of a drifted
 * row but measures cosine, not retrieval.
 *
 * recall-stored-vs-fresh — does a drifted page vector lose search results? (#6175 step 4)
 *
 * INPUT  a JSONL of { page_id, book_id, made_from, flags, query }: drifted rows from
 *        page-vector-truth --explain (one per book), each with a query written BY EYE from the
 *        page's current text.
 * PER ROW  embed the query and the page's current composed text (pageEmbeddingInput), read the
 *        stored vector, and take the production top-100 for the query (HNSW, ef_search 100).
 *        stored_rank  = 1 + rows in that list closer to the query than the STORED vector
 *        fresh_rank   = 1 + rows closer than the FRESH vector — the rank the page would have if
 *                       only its own row were re-embedded. 101 = outside the top 100.
 *        stored_rank_index = where the index actually returned the page (HNSW is approximate).
 * OUTPUT one JSON line per row appended to OUT; --score prints R@1 / R@10 / MRR per class and
 *        per model-free flag with a paired bootstrap interval on the R@10 difference.
 * BIAS   the query is written from today's text, which the fresh vector is made from. That is
 *        also what a reader searches for; read the difference as an upper bound.
 * COST   ~2 realtime embeds per row (136 rows ≈ $0.01). Read-only on Supabase and Mongo.
 *
 * Usage: node --env-file=.env.production.local scripts/eval/vector-truth/recall-stored-vs-fresh.mjs IN.jsonl OUT.jsonl
 *        node scripts/eval/vector-truth/recall-stored-vs-fresh.mjs --score scripts/eval/vector-truth/recall-6175.jsonl
 */
import fs from 'node:fs';
import { parseVector, cosine } from '../../lib/vector-truth.mjs';

const args = process.argv.slice(2);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

if (args[0] === '--score') { score(readJsonl(args[1]).filter((r) => r.stored_rank)); process.exit(0); }

const [IN, OUT] = args;
if (!IN || !OUT) { console.error('Usage: recall-stored-vs-fresh.mjs IN.jsonl OUT.jsonl | --score FILE'); process.exit(2); }
const { MongoClient } = await import('mongodb');
const { default: pg } = await import('pg');
const { embedTexts, pageEmbeddingInput } = await import('../../lib/page-embedding-text.mjs');
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const rowsIn = readJsonl(IN);
const done = new Set(fs.existsSync(OUT) ? readJsonl(OUT).map((r) => r.page_id) : []);
const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const pages = new Map((await mongo.db('bookstore').collection('pages').find({ id: { $in: rowsIn.map((r) => r.page_id) } }).toArray()).map((p) => [p.id, p]));
await mongo.close();
const todo = rowsIn.filter((r) => !done.has(r.page_id)).map((r) => ({ ...r, text: pageEmbeddingInput(pages.get(r.page_id))?.text })).filter((r) => r.text);
const embedAll = async (texts) => { const out = []; for (let i = 0; i < texts.length; i += 20) out.push(...await embedTexts(texts.slice(i, i + 20).map((t) => t.toWellFormed()), KEY)); return out; };
const fresh = await embedAll(todo.map((r) => r.text));
const qv = await embedAll(todo.map((r) => r.query));
let next = 0;
await Promise.all([0, 1].map(async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout = '170s'");
  await c.query('SET hnsw.ef_search = 100');
  while (next < todo.length) {
    const i = next++;
    const { text, ...p } = todo[i];
    try {
      const q = JSON.stringify(Array.from(qv[i]));
      const stored = parseVector((await c.query('SELECT embedding::text e FROM page_translations WHERE page_id = $1', [p.page_id])).rows[0]?.e);
      const top = (await c.query('SELECT page_id, book_id, embedding <=> $1::vector AS d FROM page_translations WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 100', [q])).rows;
      const dStored = 1 - cosine(stored, qv[i]), dFresh = 1 - cosine(Array.from(fresh[i]), qv[i]);
      const idx = top.findIndex((r) => r.page_id === p.page_id);
      const others = top.filter((r) => r.page_id !== p.page_id);
      const rankOf = (d) => { const n = others.filter((r) => r.d < d).length; return n >= others.length ? 101 : n + 1; };
      fs.appendFileSync(OUT, JSON.stringify({
        ...p, cos_stored_fresh: +cosine(stored, Array.from(fresh[i])).toFixed(4), d_stored: +dStored.toFixed(4), d_fresh: +dFresh.toFixed(4),
        d10: +top[9].d.toFixed(4), d100: +top.at(-1).d.toFixed(4), stored_rank_index: idx < 0 ? 101 : idx + 1, stored_rank: rankOf(dStored), fresh_rank: rankOf(dFresh),
        same_book_top10: top.slice(0, 10).filter((r) => r.book_id === p.book_id).length,
      }) + '\n');
    } catch (e) { console.error(p.page_id, 'ERR', e.message); }
  }
  await c.end();
}));
score(readJsonl(OUT));

function score(rows) {
  let s = 6175;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const line = (rs, label) => {
    const n = rs.length;
    if (!n) return;
    const at = (k, f) => rs.filter((r) => r[f] <= k).length;
    const diff = (at(10, 'fresh_rank') - at(10, 'stored_rank')) / n;
    const boots = [];
    for (let b = 0; b < 4000; b++) { let d = 0; for (let i = 0; i < n; i++) { const r = rs[Math.floor(rng() * n)]; d += (r.fresh_rank <= 10) - (r.stored_rank <= 10); } boots.push(d / n); }
    boots.sort((a, b) => a - b);
    const mrr = (f) => (rs.reduce((t, r) => t + (r[f] <= 100 ? 1 / r[f] : 0), 0) / n).toFixed(3);
    const gained = rs.filter((r) => r.fresh_rank <= 10 && r.stored_rank > 10).length, lost = rs.filter((r) => r.fresh_rank > 10 && r.stored_rank <= 10).length;
    console.log(`| ${label} | ${n} | ${(rs.reduce((t, r) => t + r.cos_stored_fresh, 0) / n).toFixed(3)} | ${at(1, 'stored_rank')}/${at(1, 'fresh_rank')} | ${at(10, 'stored_rank')} (${(at(10, 'stored_rank') / n).toFixed(2)}) | ${at(10, 'fresh_rank')} (${(at(10, 'fresh_rank') / n).toFixed(2)}) | ${diff >= 0 ? '+' : ''}${diff.toFixed(3)} [${boots[100].toFixed(2)}, ${boots[3899].toFixed(2)}] | +${gained} / −${lost} | ${mrr('stored_rank')} / ${mrr('fresh_rank')} | ${at(10, 'stored_rank_index')} |`);
  };
  console.log('| class | n | mean cos(stored,fresh) | R@1 stored/fresh | R@10 stored | R@10 fresh | Δ R@10 [95% bootstrap] | gained / lost | MRR stored / fresh | R@10 as the index served it |\n|---|---|---|---|---|---|---|---|---|---|');
  for (const c of [...new Set(rows.map((r) => r.made_from))]) line(rows.filter((r) => r.made_from === c), `made from: ${c}`);
  line(rows, 'all');
  const stale = (r) => r.flags.includes('stale');
  line(rows.filter(stale), 'flag: stale by timestamp');
  line(rows.filter((r) => !stale(r)), 'flag: not stale');
  line(rows.filter((r) => r.empty_snippet), 'row has no English snippet, page is translated');
  line(rows.filter((r) => stale(r) || r.empty_snippet), 'stale OR no snippet');
  line(rows.filter((r) => !stale(r) && !r.empty_snippet), 'neither');
}
