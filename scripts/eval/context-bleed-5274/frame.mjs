#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/wrong-leaf-fix-5021.mjs build5274 (the near-blank queue from sweep_log and the 11-03
// screen); this writes the --from= file its `enqueue` takes, so the runner's own makeRows keeps every left-out rule.
/**
 * The #5274 context-bleed fix frame, as an `enqueue --from=` file (no Mongo; classify.mjs did the reads).
 *
 *   node scripts/eval/context-bleed-5274/frame.mjs --classified=FILE --bands=NB-A[,NB-B] --out=FILE
 *        [--near-blank-queue=/data/scratch/sl/jobs/near-blank-fix-5274/fix/queue.jsonl]
 *        [--exclude=FILE.jsonl[.gz]:key ...]   (pages another job is about to change: listed, not queued)
 *
 * Groups: NB = source weight < 150 (a nearly empty leaf); TXT-alpha / TXT-dense = a text page in an alphabetic or a
 * dense script; then the classify band (A/B/C/D). Soft-hidden leaves
 * (page ≤ 0) are not served and the translate lane refuses them: left out. Pages the #5021 runner re-translated and
 * human-edited translations are left out. The near-blank-fix-5274 queue (its 547 withheld + 50 served ocr_dropped
 * pages) is added whole, every row flagged near_blank.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const lines = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString() : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const bands = new Set(String(arg('bands', 'NB-A')).split(','));
// Scripts whose English legitimately runs 2.5× the source (abjads, abugidas, Han): judged 1/10 positive on text pages
const DENSE = /hebrew|sanskrit|arabic|marathi|hindi|ge.ez|syriac|tibetan|persian|judeo|aramaic|bengali|telugu|tamil|pali|urdu|ottoman|coptic|armenian|chinese|japanese|korean|manchu|mongol|kannada|malayalam|gujarati|burmese|thai|sinhala|nepali|prakrit|avestan|samaritan|yiddish|ladino|ethiopic|amharic/i;
export const group = (r) => (r.src_w < 150 ? `NB-${r.band}` : `TXT-${DENSE.test(r.language || '') ? 'dense' : 'alpha'}-${r.band}`);

const excl = new Map();
for (const a of process.argv.filter((x) => x.startsWith('--exclude='))) {
  const [f, key = 'page_id', filt] = a.slice(10).split(':');
  for (const r of lines(f)) { if (filt && !String(r.state || '').includes(filt)) continue; excl.set(r[key], f.split('/').slice(-3).join('/')); }
}
const pages = [], left = { soft_hidden: 0, fixed_5021: 0, human: 0, other_job: 0 }, listed = [];
const seen = new Set();
for (const r of lines(arg('classified'))) {
  if (!bands.has(group(r))) continue;
  if (r.page <= 0) { left.soft_hidden++; continue; }
  if (r.fixed5021) { left.fixed_5021++; continue; }
  if (r.human) { left.human++; continue; }
  if (excl.has(r.page_id)) { left.other_job++; listed.push({ page_id: r.page_id, book_id: r.book_id, page: r.page, job: excl.get(r.page_id) }); continue; }
  seen.add(`${r.book_id}:${r.page}`);
  pages.push({ book_id: r.book_id, page: r.page, src: [`cb-${group(r)}`, `cb-${r.cls}`], near_blank: r.src_w < 150 });
}
let nbAdded = 0;
const nbq = arg('near-blank-queue', '/data/scratch/sl/jobs/near-blank-fix-5274/fix/queue.jsonl');
if (fs.existsSync(nbq)) for (const r of lines(nbq)) {
  const k = `${r.book_id}:${r.page}`;
  if (excl.has(r.page_id)) { left.other_job++; listed.push({ page_id: r.page_id, book_id: r.book_id, page: r.page, job: excl.get(r.page_id) }); continue; }
  if (seen.has(k)) { const p = pages.find((x) => `${x.book_id}:${x.page}` === k); p.src.push('near-blank-5274'); p.near_blank = true; continue; }
  seen.add(k); nbAdded++;
  pages.push({ book_id: r.book_id, page: r.page, src: ['near-blank-5274', ...r.src], near_blank: true });
}
fs.writeFileSync(arg('out'), JSON.stringify({ built_at: new Date().toISOString(), bands: [...bands], n: pages.length, near_blank_queue_added: nbAdded, left_out: left, listed_for_other_jobs: listed, pages }, null, 1));
console.log(JSON.stringify({ n: pages.length, near_blank_queue_added: nbAdded, left_out: left }));
