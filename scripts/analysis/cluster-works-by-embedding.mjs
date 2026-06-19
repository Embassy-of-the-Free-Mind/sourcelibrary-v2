/**
 * cluster-works-by-embedding.mjs — work_id clustering from EXISTING book embeddings.
 *
 * The free, language-agnostic complement to the title-matching resolvers
 * (resolve-work-ids*.mjs). Reuses the ~36K `book_embeddings` already in Supabase
 * (one 768-dim vector per book: title+author+summary+entities) instead of
 * re-embedding pages. Same-work editions cluster tightly in this space — so we
 * use embeddings as the RECALL layer and the author anchor as the PRECISION gate:
 *
 *   block by canonical author -> within each block, pairwise cosine ->
 *   pairs above threshold -> union-find clusters -> seed work_id from any member
 *   that already has one, else mint a local `wcluster:` id.
 *
 * Reaches the native-script Tibetan/Chinese mass that title-matching misses,
 * because cosine on the summary/entity embedding is language-agnostic.
 *
 *   node scripts/analysis/cluster-works-by-embedding.mjs                 # dry-run + calibration
 *   node scripts/analysis/cluster-works-by-embedding.mjs --threshold 0.9
 *   node scripts/analysis/cluster-works-by-embedding.mjs --apply         # write HIGH only (+backup)
 *
 * Issue #1634. Dry-run writes a proposal JSON to scripts/output/, never to Mongo.
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const APPLY = args.includes('--apply');
const THRESHOLD = parseFloat(getArg('threshold', '0.90'));   // within-author "same work" cutoff
const MAX_BLOCK = parseInt(getArg('max-block', '400'), 10);  // skip pathological author groups

// generic / non-discriminating author keys — blocking on these would create
// giant false blocks, so they're excluded from the author-anchored pass.
const GENERIC_AUTHOR = new Set(['', 'anonymous', 'anon', 'various', 'unknown',
  'various authors', 'collective', 'n a', 'na', 'no author', 'multiple']);

const deacc = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TSTOP = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'commentary', 'translation', 'translated', 'edition', 'ed', 'text', 'vol', 'volume', 'part', 'book', 'complete', 'selected', 'his', 'its', 'sogs', 'estampe', 'etat']);
function titleTokens(t) {
  let s = deacc(t).replace(/[\(\[].*?[\)\]]/g, ' ').split(/ [—–-] |:| with | trans| edited/)[0];
  return new Set(s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !TSTOP.has(w)));
}
// title agreement: token jaccard, OR one title's tokens contained in the other
// (an edition "X" of work "X: a critical edition"). Language-agnostic only when
// titles share a script; for native-script editions this gate abstains (returns 0).
function titleSim(t1, t2) {
  const A = titleTokens(t1), B = titleTokens(t2);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const jac = inter / (A.size + B.size - inter);
  const contain = inter / Math.min(A.size, B.size);   // how much of the smaller title is shared
  return Math.max(jac, contain >= 0.8 ? contain : 0);
}
function authorKey(b) {
  if (b.author_id) return `id:${b.author_id}`;
  const a = deacc(b.author).replace(/\(.*?\)|trans\.?|ed\.?|comm\.?/g, ' ')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a || GENERIC_AUTHOR.has(a)) return null;
  return `name:${a}`;
}
function cos(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── 1. book metadata from Mongo ──────────────────────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await mc.connect();
const books = mc.db('bookstore').collection('books');
const meta = await books.find(
  { visible: true },
  { projection: { id: 1, author_id: 1, author: 1, work_id: 1, language: 1, title: 1, display_title: 1, year: 1 } }
).toArray();
const byId = new Map();
for (const b of meta) byId.set(b.id, b);
console.log(`Loaded ${meta.length} visible books from Mongo`);

// ── 2. author blocks (size >= 2, non-generic) ────────────────────────────────
const blocks = new Map();
for (const b of meta) {
  const k = authorKey(b);
  if (!k) continue;
  if (!blocks.has(k)) blocks.set(k, []);
  blocks.get(k).push(b.id);
}
let candidateIds = new Set();
let bigSkipped = 0;
for (const [k, ids] of blocks) {
  if (ids.length < 2) continue;
  if (ids.length > MAX_BLOCK) { bigSkipped++; continue; }
  for (const id of ids) candidateIds.add(id);
}
candidateIds = [...candidateIds];
console.log(`${blocks.size} author blocks; ${candidateIds.length} books in multi-book blocks (skipped ${bigSkipped} blocks > ${MAX_BLOCK})`);

// ── 3. fetch embeddings for just those books ─────────────────────────────────
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const vec = new Map();
for (let i = 0; i < candidateIds.length; i += 200) {
  const chunk = candidateIds.slice(i, i + 200);
  const { data, error } = await sb.from('book_embeddings').select('book_id,embedding').in('book_id', chunk);
  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  for (const r of (data || [])) {
    let e = r.embedding; if (typeof e === 'string') e = JSON.parse(e);
    if (Array.isArray(e) && e.length) vec.set(r.book_id, Float32Array.from(e));
  }
  if (i % 2000 === 0) process.stdout.write(`\r  embeddings fetched: ${vec.size}/${candidateIds.length}`);
}
console.log(`\nRetrieved ${vec.size} book embeddings`);

// ── 4. within-block pairwise cosine -> pairs ─────────────────────────────────
// also collect calibration samples: within-author pairs where BOTH books carry
// an existing work_id (positives share it, negatives differ).
const TITLE_GATE = parseFloat(getArg('title-gate', '0.34'));   // min titleSim for a pair to pass the precision gate
const pairs = [];                 // {a,b,sim} above THRESHOLD AND title gate
const calPos = [], calNeg = [];   // {s, ts} for labeled pairs, for calibration
for (const [k, ids] of blocks) {
  const has = ids.filter(id => vec.has(id));
  if (has.length < 2 || has.length > MAX_BLOCK) continue;
  for (let i = 0; i < has.length; i++) {
    for (let j = i + 1; j < has.length; j++) {
      const A = byId.get(has[i]), B = byId.get(has[j]);
      const s = cos(vec.get(has[i]), vec.get(has[j]));
      const ts = titleSim(A.display_title || A.title, B.display_title || B.title);
      if (A.work_id && B.work_id) (A.work_id === B.work_id ? calPos : calNeg).push({ s, ts });
      if (s >= THRESHOLD && ts >= TITLE_GATE) pairs.push({ a: has[i], b: has[j], sim: s });
    }
  }
}
console.log(`\n${pairs.length} candidate same-work pairs at sim >= ${THRESHOLD}`);

// ── 5. union-find clusters ───────────────────────────────────────────────────
const parent = new Map();
const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
for (const { a, b } of pairs) { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); }
for (const { a, b } of pairs) parent.set(find(a), find(b));
const clusters = new Map();
for (const id of parent.keys()) { const r = find(id); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(id); }
const multi = [...clusters.values()].filter(c => c.length > 1).sort((a, b) => b.length - a.length);

// ── 6. seed work_id, classify, count ─────────────────────────────────────────
let newWorkClusters = 0, extendClusters = 0, conflictClusters = 0, newLinks = 0;
const proposals = [];
for (const c of multi) {
  const existing = [...new Set(c.map(id => byId.get(id).work_id).filter(Boolean))];
  let kind, seedWorkId;
  if (existing.length === 0) { kind = 'NEW'; newWorkClusters++; seedWorkId = `wcluster:${find(c[0]).slice(0, 12)}`; }
  else if (existing.length === 1) { kind = 'EXTEND'; extendClusters++; seedWorkId = existing[0]; }
  else { kind = 'CONFLICT'; conflictClusters++; seedWorkId = null; }   // multiple work_ids merged -> review, never auto-write
  const unlinked = c.filter(id => !byId.get(id).work_id);
  if (kind !== 'CONFLICT') newLinks += unlinked.length;
  proposals.push({
    kind, seedWorkId, size: c.length, existingWorkIds: existing,
    books: c.map(id => { const b = byId.get(id); return { id, title: b.display_title || b.title, author: b.author, language: b.language, year: b.year, work_id: b.work_id || null }; }),
  });
}

// ── 7. calibration report (precision proxy from existing work_ids) ───────────
const stat = a => { if (!a.length) return { n: 0 }; a = [...a].sort((x, y) => x - y); const m = a.reduce((s, v) => s + v, 0) / a.length; return { n: a.length, mean: +m.toFixed(3), p50: +a[a.length >> 1].toFixed(3), p90: +a[Math.floor(a.length * 0.9)].toFixed(3), p10: +a[Math.floor(a.length * 0.1)].toFixed(3) }; };
const sweep = (T, G) => { const tp = calPos.filter(p => p.s >= T && p.ts >= G).length, fp = calNeg.filter(p => p.s >= T && p.ts >= G).length; return { tp, fp, prec: (tp + fp) ? tp / (tp + fp) : 0, rec: calPos.length ? tp / calPos.length : 0 }; };
const at = sweep(THRESHOLD, TITLE_GATE);
const labeledPrecision = at.prec, recallProxy = at.rec;

console.log('\n── Calibration (within-author labeled pairs) ──');
console.log('same-work (positives) emb:', JSON.stringify(stat(calPos.map(p => p.s))), ' title:', JSON.stringify(stat(calPos.map(p => p.ts))));
console.log('diff-work (negatives) emb:', JSON.stringify(stat(calNeg.map(p => p.s))), ' title:', JSON.stringify(stat(calNeg.map(p => p.ts))));
console.log(`\nOPERATING POINT emb>=${THRESHOLD} AND title>=${TITLE_GATE}: precision ${(labeledPrecision * 100).toFixed(1)}% recall ${(recallProxy * 100).toFixed(1)}% (TP ${at.tp}/FP ${at.fp})`);
console.log('\n── emb-only sweep (no title gate) ──');
for (const T of [0.90, 0.92, 0.94, 0.96]) { const r = sweep(T, 0); console.log(`  emb>=${T}: precision ${(r.prec * 100).toFixed(1)}%  recall ${(r.rec * 100).toFixed(1)}%`); }
console.log('── emb + title-gate sweep ──');
for (const T of [0.90, 0.92]) for (const G of [0.30, 0.34, 0.45, 0.6]) { const r = sweep(T, G); console.log(`  emb>=${T} title>=${G}: precision ${(r.prec * 100).toFixed(1)}%  recall ${(r.rec * 100).toFixed(1)}%  (TP ${r.tp}/FP ${r.fp})`); }

console.log('\n── Clusters ──');
console.log(`total multi-book clusters: ${multi.length}`);
console.log(`  EXTEND  (1 existing work_id -> absorb unlinked editions): ${extendClusters}`);
console.log(`  NEW     (no existing work_id -> mint wcluster:):          ${newWorkClusters}`);
console.log(`  CONFLICT(>=2 existing work_ids merged -> REVIEW only):    ${conflictClusters}`);
console.log(`new work_id links available (EXTEND+NEW, excludes CONFLICT): ${newLinks}`);

console.log('\n── Sample clusters ──');
for (const p of proposals.filter(p => p.kind !== 'CONFLICT').slice(0, 8)) {
  console.log(`\n[${p.kind}] ${p.seedWorkId} (${p.size})`);
  for (const b of p.books.slice(0, 6)) console.log(`   ${b.work_id ? '*' : ' '} ${(b.title || '?').slice(0, 62)}  [${b.language || '?'}${b.year ? ' ' + b.year : ''}]`);
}
const conf = proposals.filter(p => p.kind === 'CONFLICT');
if (conf.length) {
  console.log(`\n── Sample CONFLICTs (manual review) ──`);
  for (const p of conf.slice(0, 4)) console.log(`   merges ${p.existingWorkIds.join(' + ')} across ${p.size} books`);
}

// ── 8. write proposal JSON (always; this is the dry-run artifact) ─────────────
const outDir = new URL('../output/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}work-cluster-proposals.json`;
fs.writeFileSync(outPath, JSON.stringify({
  generatedFromExistingEmbeddings: true, threshold: THRESHOLD,
  calibration: { positives: stat(calPos), negatives: stat(calNeg), labeledPrecision, recallProxy, labTP, labFP },
  counts: { multiClusters: multi.length, extendClusters, newWorkClusters, conflictClusters, newLinks },
  proposals,
}, null, 2));
console.log(`\nProposal written to ${outPath}`);

// ── 9. optional apply: EXTEND + NEW only, never CONFLICT ─────────────────────
if (APPLY) {
  const backup = `${outDir}work-cluster-apply-backup-${candidateIds.length}.json`;
  const writes = [];
  for (const p of proposals) {
    if (p.kind === 'CONFLICT') continue;
    for (const b of p.books) if (!b.work_id) writes.push({ id: b.id, work_id: p.seedWorkId, kind: p.kind });
  }
  fs.writeFileSync(backup, JSON.stringify({ when: 'apply', count: writes.length, writes }, null, 2));
  console.log(`\n--apply: writing work_id on ${writes.length} books (backup ${backup})`);
  let done = 0;
  for (const w of writes) {
    const r = await books.updateOne({ id: w.id, work_id: { $in: [null, undefined] } }, { $set: { work_id: w.work_id, work_id_source: 'embedding-cluster:1634', work_id_confidence: 'high' } });
    done += r.modifiedCount;
  }
  console.log(`applied: ${done} modified`);
}

await mc.close();
