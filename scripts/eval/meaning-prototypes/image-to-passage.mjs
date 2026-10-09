/**
 * PRIOR ART: scripts/eval/embed-granularity/lib.mjs — the text embedding call
 * and vector helpers (reused here); it has no image input. src/lib/embeddings.ts
 * and scripts/backfill-clip-embeddings.mjs — CLIP image vectors, a separate
 * 512-d space that cannot be compared with page-text vectors. Nothing in the
 * repo embeds an image into the page-text space.
 *
 * Prototype for #6201: does a picture find the passages that describe it?
 *
 * gemini-embedding-2 accepts images and puts them in the same space as text.
 * Every page already has a text vector from that model in `page_translations`,
 * so an image vector can be ranked against them with no new index.
 *
 * The test case is Michael Maier's Atalanta fugiens (1618): 50 numbered
 * emblems. The target is a 17th-century English manuscript translation of the
 * same work, which has no pictures and gives each emblem three pages (motto and
 * epigram, then two pages of discourse). So the right answer for the picture
 * of emblem N is known: target pages 22+3(N-1) to 24+3(N-1). Chance is 3 in 194.
 *
 * Three ways to turn the picture into a query, all ranked exactly against the
 * stored page vectors of the target book:
 *   image     the cropped image, embedded as an image (768 dims);
 *   centred   the same, after subtracting the mean image vector from the
 *             queries and the mean page vector from the pages (image and text
 *             vectors sit in separate regions of the space);
 *   words     the one-line description a vision model wrote for the gallery,
 *             embedded as text.
 * `words` also goes to the live `match_semantic` RPC, to see which pages in
 * the rest of the library describe the same scene.
 *
 * Usage:
 *   node --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/eval/meaning-prototypes/image-to-passage.mjs \
 *     --out <dir> [--limit 50]
 *
 * Reads only. Cost: one image embedding per emblem (about $0.0001 each).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { arg, normalise, embedAll } from '../embed-granularity/lib.mjs';
import { logUsage } from '../../workers/lib/supabase-usage-logger.mjs';

const MODEL = 'gemini-embedding-2-preview';
const DIMS = 768;
const ENDPOINT = 'eval/meaning-prototypes';
// Google lists image input for this model at $0.45 per 1M tokens; an image is
// counted as 258 tokens. Estimated, not billed.
const IMAGE_TOKENS = 258;
const IMAGE_USD_PER_1M = 0.45;

const SOURCE = '69520c46ab34727b1f044141'; // Atalanta fugiens, Oppenheim 1618 (Latin and German)
const TARGET = '86fe639a-5f3d-4e9e-9d99-128742a10809'; // English manuscript translation, c. 1625
const OUT = arg('--out');
const LIMIT = Number(arg('--limit', '50'));
if (!OUT) { console.error('need --out'); process.exit(1); }
/** Emblem N is on source page 19 + 4(N-1). */
const emblemOf = (page) => ((page - 19) % 4 === 0 && page >= 19 && page <= 215 ? (page - 19) / 4 + 1 : null);
/** Target pages that belong to emblem N. */
const goldPages = (n) => [22 + 3 * (n - 1), 23 + 3 * (n - 1), 24 + 3 * (n - 1)];
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedImage(url) {
  const img = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!img.ok) throw new Error(`image ${img.status} ${url}`);
  const data = Buffer.from(await img.arrayBuffer()).toString('base64');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: `models/${MODEL}`, content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] }, outputDimensionality: DIMS }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (res.ok) return normalise((await res.json()).embedding.values);
    if (attempt >= 6) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await sleep(3000 * 2 ** attempt);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Every stored page vector of one book (paged: supabase-js caps a response at 1,000 rows). */
async function bookVectors(bookId) {
  const rows = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await supabase.from('page_translations')
      .select('page_id, book_id, page_number, translation, embedding')
      .eq('book_id', bookId).order('page_number').range(from, from + 199);
    if (error) throw new Error(error.message);
    for (const r of data) {
      const v = typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding;
      if (v) rows.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, text: r.translation || '', vec: normalise(v) });
    }
    if (data.length < 200) break;
  }
  return rows;
}

const cos = (a, b) => { let s = 0; for (let d = 0; d < DIMS; d++) s += a[d] * b[d]; return s; };

const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const db = mongo.db('bookstore');
const all = await db.collection('gallery_images').find({ book_id: SOURCE, detection_index: 0 }).sort({ page_number: 1 }).toArray();
await mongo.close();
const images = all.filter((g) => emblemOf(g.page_number)).slice(0, LIMIT);
console.log(`${images.length} emblem images`);

const pages = await bookVectors(TARGET);
console.log(`${pages.length} stored page vectors in the target`);

const cacheFile = path.join(OUT, 'image-vectors.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
let embedded = 0;
for (const g of images) {
  if (cache[g.id]) continue;
  cache[g.id] = Array.from(await embedImage(g.extracted_url));
  embedded++;
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}
const imgVecs = images.map((g) => Float32Array.from(cache[g.id]));
const { vecs: wordFlat } = await embedAll(images.map((g) => g.description || ''), { label: 'words' });
const wordVecs = images.map((_, i) => wordFlat.slice(i * DIMS, (i + 1) * DIMS));

const mean = (vs) => { const m = new Float32Array(DIMS); for (const v of vs) for (let d = 0; d < DIMS; d++) m[d] += v[d] / vs.length; return m; };
const minus = (v, m) => normalise(Array.from(v, (x, d) => x - m[d]));
const imgMean = mean(imgVecs);
const pageMean = mean(pages.map((p) => p.vec));
const pagesCentred = pages.map((p) => ({ ...p, vec: minus(p.vec, pageMean) }));

function rank(q, rows) {
  return rows.map((r) => ({ page_number: r.page_number, sim: cos(q, r.vec), text: r.text.slice(0, 300) })).sort((a, b) => b.sim - a.sim);
}

const arms = { image: { top1: 0, top3: 0, rr: 0 }, centred: { top1: 0, top3: 0, rr: 0 }, words: { top1: 0, top3: 0, rr: 0 } };
const results = [];
for (let i = 0; i < images.length; i++) {
  const g = images[i];
  const n = emblemOf(g.page_number);
  const gold = new Set(goldPages(n));
  const ranked = { image: rank(imgVecs[i], pages), centred: rank(minus(imgVecs[i], imgMean), pagesCentred), words: rank(wordVecs[i], pages) };
  const row = { emblem: n, image_id: g.id, source_page: g.page_number, extracted_url: g.extracted_url, description: g.description, gold: [...gold], arms: {} };
  for (const [arm, r] of Object.entries(ranked)) {
    const first = r.findIndex((x) => gold.has(x.page_number)) + 1;
    arms[arm].top1 += first === 1 ? 1 : 0; arms[arm].top3 += first >= 1 && first <= 3 ? 1 : 0; arms[arm].rr += first ? 1 / first : 0;
    row.arms[arm] = { first_gold_rank: first, top: r.slice(0, 5) };
  }
  const { data, error } = await supabase.rpc('match_semantic', {
    query_embedding: JSON.stringify(Array.from(wordVecs[i])), match_threshold: 0.3, match_count: 30,
    filter_tenant_id: null, filter_language: null, filter_year_min: null, filter_year_max: null,
    filter_languages: null, filter_exclude_languages: null,
  });
  row.library = error ? { error: error.message } : data.map((r) => ({ book_id: r.book_id, page_number: r.page_number, title: r.book_title, author: r.book_author, year: r.book_year, language: r.book_language, sim: r.similarity, text: (r.translation || '').slice(0, 500) }));
  results.push(row);
  console.log(`emblem ${n}: first right page at rank image ${row.arms.image.first_gold_rank}, centred ${row.arms.centred.first_gold_rank}, words ${row.arms.words.first_gold_rank} | ${g.description?.slice(0, 60)}`);
}
const n = images.length;
const summary = Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, { n, top1: v.top1, top3: v.top3, mrr: +(v.rr / n).toFixed(3) }]));
console.log(JSON.stringify(summary));
fs.writeFileSync(path.join(OUT, 'image-to-passage.json'), JSON.stringify({ source: SOURCE, target: TARGET, target_pages: pages.length, summary, results }, null, 1));

if (embedded) {
  const tokens = embedded * IMAGE_TOKENS;
  await logUsage({ type: 'embedding', mode: 'realtime', model: MODEL, endpoint: ENDPOINT, page_count: embedded, input_tokens: tokens, output_tokens: 0, cost_usd: (tokens / 1e6) * IMAGE_USD_PER_1M, status: 'success', triggered_by: 'manual' });
}
