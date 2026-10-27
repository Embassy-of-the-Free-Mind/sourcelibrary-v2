#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-correct-6560/pass/leafcheck.mjs audit-req (draws pages from ONE read dir and takes the
// draft from the live `pages` row, which is the Flash text once a volume is written) and prep.py (the 30-folio set and
// its planted drafts, reused here as-is through `prep.py --reuse-plants`). This set is drawn across five earlier
// audits and needs the Yigdzin draft each was judged against, so it resolves the draft from `page_revisions`.
/**
 * The diagnostic page set for the corrector-profile / diff-QA experiment (#6560, #6740), with the Yigdzin draft and
 * the page image of each page. Nothing is written to the database.
 *
 *   node --env-file=.env.production.local build-set.mjs --root=$JOB_SCRATCH [--brgyad=reads-brgyad.jsonl]
 *
 * Groups (the brief, 2026-10-27):
 *   g7477   the 6 pages the #7477 production gate pooled WORSE (Thadrak rGyud 'bum Ka)
 *   g7479   the 10 pages the #7479 Neyphug rGyud Tsha gate judged WORSE
 *   g7483   the 4 router-30 pages with a confirmed severe error introduced (#7483)
 *   brgyad  every Flash read of Thadrak brGyad stong Ka whose text-line count differs from its draft (#6740 p.233)
 *   lines   Neyphug p.128 / p.131 / p.303 (a removed line: right on 128 and 131 by eye, 303 unverified)
 *   wave2   20 wave-2 pages (#7479 pass-gate-wave2-6740 reads), one per book, seeded
 * The 10 planted drafts are prep.py's (`req/corr-anchor.jsonl`), joined in by run-arms.mjs.
 *
 * Writes <root>/set/sample.json (ids, groups, provenance) and <root>/set/pages.jsonl ({uid, page_id, book_id,
 * page_number, group, image, draft, draft_hash, draft_lines, prior_read_lines}).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { getPageSource } from '../../../lib/page-image-url.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ROOT = arg('root') || process.env.JOB_SCRATCH;
const OUT = path.join(ROOT, 'set');
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
const R = 'scripts/eval/results/tibetan-correct-6560';
// The two audits still on open PRs are read from their branches, so the set does not depend on their merge order.
const fromRef = (ref, p) => execFileSync('git', ['show', `${ref}:${p}`], { maxBuffer: 1 << 28 });
const gz = (buf) => zlib.gunzipSync(buf).toString('utf8');
const jsonl = (s) => s.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const VOL1 = 'origin/job-tib-flash-correct-vol1-6740', DUP = 'origin/job-tib-dupline-flash-6740';

// Seeded PRNG (leafcheck.mjs's mulberry32), so the draw is rebuilt identically.
function rngFor(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
export const textLines = (t) => String(t || '').normalize('NFC').split('\n').filter((l) => l.trim() && !/^\s*<[^>]+>\s*$/.test(l)).length;

const want = new Map();   // page_id -> {group, source}
const add = (pid, group, source) => { if (!want.has(pid)) want.set(pid, { group, source }); };

// g7477: pooled WORSE in the production gate
const g77 = JSON.parse(gz(fs.readFileSync(`${R}/pass-prod-gate-69e7aab880b52390feb197a8/audit40-gate.json.gz`)));
for (const r of g77.rows.filter((x) => x.pooled === 'worse')) add(r.page_id, 'g7477', '#7477 audit40-gate pooled worse');
// g7479: the Neyphug gate's WORSE pages
const g79 = JSON.parse(gz(fromRef(VOL1, `${R}/pass-gate-neyphug-tsha-6740/audit-score.json.gz`)));
for (const r of g79.page_rows.filter((x) => x.verdict === 'worse')) add(r.page_id, 'g7479', '#7479 Neyphug audit-score worse');
// g7483: router-30, a severe error introduced (both judges)
const g83 = JSON.parse(gz(fromRef(DUP, `${R}/severity-6740/router30-gate.json.gz`)));
for (const r of g83.rows.filter((x) => x.severe_introduced)) add(r.page_id, 'g7483', '#7483 router30-gate severe introduced');
// lines: Neyphug p.128 / 131 / 303
const ney = jsonl(gz(fromRef(VOL1, `${R}/pass-gate-neyphug-tsha-6740/flash-low-reads.jsonl.gz`)));
for (const n of [128, 131, 303]) add(ney.find((r) => r.page_number === n).page_id, 'lines', `Neyphug p.${n} (#6740 line removal)`);
// brgyad: the volume's Flash reads (R2 candidate-reads, tib-flash-correct-vol1-6740) are compared with their drafts below
const brg = arg('brgyad') ? jsonl(fs.readFileSync(arg('brgyad'), 'utf8')) : [];
// wave2: one page per book of the 20-book wave-2 gate reads
const w2 = jsonl(gz(fromRef(VOL1, `${R}/pass-gate-wave2-6740/flash-low-reads.jsonl.gz`)));

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
// The Yigdzin draft of a page: the stored OCR while it is still Yigdzin's, else the newest Yigdzin row in page_revisions.
async function drafts(ids) {
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray();
  const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', model: 'bdrc-yigdzin-v1' }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: -1 }).toArray();
  const out = new Map();
  for (const p of pages) {
    let draft = null, from = null;
    if (p.ocr?.model === 'bdrc-yigdzin-v1' && p.ocr.data?.trim()) { draft = p.ocr.data; from = 'pages.ocr'; }
    else { const r = revs.find((x) => x.page_id === p.id && x.data?.trim()); if (r) { draft = r.data; from = 'page_revisions'; } }
    out.set(p.id, { page: p, draft, from });
  }
  return out;
}

// brGyad: every read whose text-line count differs from the draft it corrected
if (brg.length) {
  const D = await drafts([...new Set(brg.map((r) => r.page_id))]);
  let n = 0, other = 0;
  for (const r of brg.sort((a, b) => a.page_number - b.page_number)) {
    const d = D.get(r.page_id);
    if (!d?.draft || contentHash(d.draft) !== r.meta?.draft?.text_hash) { other++; continue; }   // the read corrected another draft
    if (textLines(d.draft) !== textLines(r.text)) { add(r.page_id, 'brgyad', `brGyad Flash read ${r.content_hash}: ${textLines(d.draft)} -> ${textLines(r.text)} lines`); n++; }
  }
  console.log(`brgyad: ${brg.length} reads, ${other} of another draft, ${n} change the line count`);
}
// wave2: seeded, one per book, not a page already in the set
{
  const rng = rngFor('6560|profiles|wave2');
  const byBook = new Map();
  for (const r of w2) if (!want.has(r.page_id)) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);
  for (const [, rows] of [...byBook].sort(([a], [b]) => a.localeCompare(b))) {
    const r = shuffle(rows.sort((a, b) => a.page_number - b.page_number), rng)[0];
    add(r.page_id, 'wave2', `#7479 wave-2 read, book ${r.book_id}`);
  }
}

const D = await drafts([...want.keys()]);
await c.close();
const priorRead = new Map([...ney, ...w2, ...brg].map((r) => [r.page_id, r.text]));
const rows = [];
for (const [pid, w] of want) {
  const d = D.get(pid);
  if (!d?.draft) { console.log(`no Yigdzin draft for ${pid} (${w.group}): left out`); continue; }
  const img = path.join(OUT, 'img', `${pid}.jpg`);
  if (!fs.existsSync(img)) {
    const res = await fetch(getPageSource(d.page));
    if (!res.ok) { console.log(`image HTTP ${res.status} for ${pid}: left out`); continue; }
    fs.writeFileSync(img, Buffer.from(await res.arrayBuffer()));
  }
  rows.push({ uid: pid, page_id: pid, book_id: d.page.book_id, page_number: d.page.page_number, group: w.group, source: w.source, draft_from: d.from,
    image: img, draft: d.draft, draft_hash: contentHash(d.draft), draft_lines: textLines(d.draft), prior_read_lines: priorRead.has(pid) ? textLines(priorRead.get(pid)) : null });
}
fs.writeFileSync(path.join(OUT, 'pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const sample = { built_at: new Date().toISOString(), note: 'DIAGNOSTIC set: pages earlier audits judged worse or severe, plus line-count changes; NOT a random sample of the lane',
  groups: Object.fromEntries([...new Set(rows.map((r) => r.group))].map((g) => [g, rows.filter((r) => r.group === g).map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, draft_hash: r.draft_hash, source: r.source }))])) };
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
console.log(Object.fromEntries(Object.entries(sample.groups).map(([g, v]) => [g, v.length])), rows.length, 'pages');
