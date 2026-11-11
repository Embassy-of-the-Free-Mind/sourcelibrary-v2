/**
 * JCB pre-1600 dedupe (#8049): run checkHoldings() over every enumerated candidate.
 *
 * PRIOR ART: scripts/import/check-holdings.ts — the one-item CLI door to the same function; this is
 * the loop over a candidate file, with two title forms per item, because JCB catalogue titles carry
 * long subtitles ("Abrahami Ortelii ... Synonymia geographica, sive populorum ... : Opus non tantùm
 * geographis ...") that dilute the near-title ranking. scripts/import/enumerate-dedupe-source.ts
 * dedupes exact fingerprints only, which is the step before this one. Read-only: writes nothing to Mongo.
 *
 *   npx tsx --env-file=.env.production.local scripts/import/jcb-1600/dedupe.ts \
 *     --in $JOB_SCRATCH/s1/candidates.json --out $JOB_SCRATCH/s2/holdings.jsonl [--concurrency 3]
 *
 * candidates.json: [{ identifier, title, creator, year, imagecount }]. Output: one JSONL row per item
 * with both results (verdict + top candidates). Resumable: rows already in --out are skipped.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { checkHoldings } from '../../../src/lib/holdings-check';

const arg = (f: string, d: string | null = null) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('--in'); const OUT = arg('--out'); const CONC = parseInt(arg('--concurrency', '3')!, 10) || 3;
if (!IN || !OUT) { console.error('--in and --out required'); process.exit(2); }

/** "Ortelius, Abraham, 1527-1598" → "Ortelius, Abraham"; arrays take the first personal name. */
export function cleanAuthor(c: unknown): string | null {
  const s = Array.isArray(c) ? String(c[0] ?? '') : String(c ?? '');
  const t = s.replace(/,?\s*(approximately\s*)?\d{3,4}\??-(\d{3,4})?\??\.?/g, '').replace(/,?\s*(d|b|fl)\.\s*\d{3,4}.*$/i, '').replace(/[.,;\s]+$/, '').trim();
  return t || null;
}
/** The title before its subtitle: cut at " : ", " ; ", " / " if 3+ words remain, else the first 10 words. */
export function shortTitle(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim();
  const cut = s.split(/\s[:;]\s|\s\/\s/)[0];
  const words = cut.split(' ');
  return (words.length >= 3 ? cut : s).split(' ').slice(0, 10).join(' ');
}

async function main() {
  const cands = JSON.parse(fs.readFileSync(IN!, 'utf8')) as any[];
  const done = new Set<string>();
  if (fs.existsSync(OUT!)) for (const l of fs.readFileSync(OUT!, 'utf8').split('\n')) if (l.trim()) done.add(JSON.parse(l).identifier);
  const client = new MongoClient(process.env.MONGODB_URI!, { maxPoolSize: CONC + 2 });
  await client.connect();
  const db = client.db('bookstore');
  const slim = (r: any) => ({ verdict: r.verdict, summary: r.summary, edition_key: r.query?.edition_key,
    candidates: (r.candidates || []).slice(0, 6).map((c: any) => ({ book_id: c.book_id, reason: c.reason, title: c.title?.slice(0, 160), author: c.author, year: c.year,
      language: c.language, visible: c.visible, hidden_reason: c.hidden_reason, duplicate_of: c.duplicate_of, pages_count: c.pages_count, pages_ocr: c.pages_ocr, provider: c.provider })) });
  const queue = cands.filter(c => !done.has(c.identifier));
  console.log(`${cands.length} candidates, ${done.size} done, ${queue.length} to check`);
  let n = 0;
  async function worker() {
    for (;;) {
      const c = queue.shift(); if (!c) return;
      const author = cleanAuthor(c.creator); const year = parseInt(String(c.year ?? ''), 10) || null; const pages = parseInt(String(c.imagecount ?? ''), 10) || null;
      const title = String(c.title ?? '').slice(0, 400); const st = shortTitle(title);
      const row: any = { identifier: c.identifier, title, short_title: st, author, year, pages };
      try {
        row.full = slim(await checkHoldings(db, { title, author, year, pages }));
        row.short = st !== title ? slim(await checkHoldings(db, { title: st, author, year, pages })) : null;
        row.byid = slim(await checkHoldings(db, { identifier: c.identifier }));
      } catch (e: any) { row.error = e.message; }
      fs.appendFileSync(OUT!, JSON.stringify(row) + '\n');
      if (++n % 25 === 0) console.log(`${n}/${queue.length + n}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
