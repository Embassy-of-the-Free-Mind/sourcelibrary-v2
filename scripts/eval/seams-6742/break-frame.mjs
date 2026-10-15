#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundary.mjs (#3918) draws one PAGE per book with `$sample` and
// extrapolates from `sum(pages_translated)`; this job (#6742) needs the unit to be a BREAK (N, N+1 both
// translated) and the corpus count of breaks exactly, which no script computes. The book filter and the
// human-edit test are reused as written there and in translate-core.mjs (writePageTranslation's guard).
/**
 * break-frame — the exact frame of translated page breaks on LIVE books (#6742). $0, Mongo reads only.
 *
 * Frame: books `visible: true, pages_count > 0, pages_translated > 1`, not held (`pipeline_auto.hold`).
 * A page is ELIGIBLE when it has non-empty `translation.data`, is not a placeholder (`translation.source`
 * skip/system), not human-written or human-edited (`source` manual/corpus, `edited_by`, `edited_at`), and not
 * withheld (`translation_withheld`), and not a same-language copy (`source: same-language`). A BREAK is (N, N+1) with both pages eligible.
 *
 * Writes $OUT/frame.jsonl.gz: one row per book { id, lang, olang, breaks, pages: [[p, type]] } (eligible pages
 * only), plus $OUT/frame-summary.json (exact totals, and the excluded counts by reason).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/seams-6742/break-frame.mjs --out=DIR [--conc=6]
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
export const LIVE = { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 1 } };
export const PLACEHOLDER = new Set(['skip', 'system']);
// Not machine translation: typed or corrected by a person, or imported from a published corpus.
export const HUMAN = new Set(['manual', 'manual-backfill', 'volunteer-correction', 'corpus', 'human', 'import', 'imported']);
// The source is already English: the stored "translation" is the source, so its joins are not translation seams.
export const SAME_LANGUAGE = 'same-language';

export function eligibility(r) {
  if (!r.t) return 'no-translation';
  if (r.w) return 'withheld';
  const src = Array.isArray(r.s) ? r.s : r.s == null ? [] : [r.s];
  if (src.some(s => PLACEHOLDER.has(s))) return 'placeholder';
  if (r.e || src.some(s => HUMAN.has(s))) return 'human';
  if (src.includes(SAME_LANGUAGE)) return 'same-language';
  return 'ok';
}

async function main() {
  const out = arg('out');
  if (!out) { console.error('--out=DIR required'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const conc = Number(arg('conc', 6));
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const all = await db.collection('books').find(LIVE, { projection: { _id: 0, id: 1, language: 1, original_language: 1, 'pipeline_auto.hold': 1 } }).toArray();
  const books = all.filter(b => !b.pipeline_auto?.hold);
  const gz = zlib.createGzip(); gz.pipe(fs.createWriteStream(path.join(out, 'frame.jsonl.gz')));
  const tot = { liveBooks: all.length, heldBooks: all.length - books.length, books: 0, booksWithBreak: 0, eligiblePages: 0, breaks: 0, excluded: {}, sources: {} };
  let i = 0, done = 0;
  const t0 = Date.now();
  async function worker() {
    while (i < books.length) {
      const b = books[i++];
      const rows = await db.collection('pages').aggregate([
        { $match: { book_id: b.id } },
        { $project: { _id: 0, p: '$page_number', ty: '$page_type', s: '$translation.source', e: { $or: [{ $gt: ['$translation.edited_by', null] }, { $gt: ['$translation.edited_at', null] }] },
          w: { $gt: ['$translation_withheld', null] }, t: { $gt: [{ $strLenCP: { $ifNull: [{ $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] }, ''] } }, 0] } } },
      ], { maxTimeMS: 600000 }).toArray();
      const ok = [];
      for (const r of rows) {
        const why = eligibility(r);
        if (r.t) { const k = Array.isArray(r.s) ? r.s.join('+') : String(r.s); tot.sources[k] = (tot.sources[k] || 0) + 1; }
        if (why === 'ok') ok.push([r.p, r.ty || null]);
        else if (why !== 'no-translation') tot.excluded[why] = (tot.excluded[why] || 0) + 1;
      }
      ok.sort((x, y) => x[0] - y[0]);
      const have = new Set(ok.map(x => x[0]));
      const breaks = ok.filter(x => have.has(x[0] + 1)).length;
      tot.books++; tot.eligiblePages += ok.length; tot.breaks += breaks; if (breaks) tot.booksWithBreak++;
      gz.write(JSON.stringify({ id: b.id, lang: b.language || null, olang: b.original_language || null, breaks, pages: ok }) + '\n');
      if (++done % 500 === 0) process.stderr.write(`${done}/${books.length} ${((Date.now() - t0) / 1000).toFixed(0)}s breaks=${tot.breaks}\n`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  await new Promise(r => gz.end(r));
  tot.at = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'frame-summary.json'), JSON.stringify(tot, null, 1) + '\n');
  console.log(JSON.stringify({ ...tot, sources: Object.fromEntries(Object.entries(tot.sources).sort((a, b) => b[1] - a[1]).slice(0, 15)) }));
  await client.close();
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
