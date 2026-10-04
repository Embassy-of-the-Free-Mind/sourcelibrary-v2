#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-note-facts-5624.mjs and fix-unclosed-note-tags.mjs — the
 * same guarded edit of stored translation text (scripts/lib/translation-text-repair.mjs), for
 * notes and tags; this one replaces one stray Korean token. scripts/maintenance/
 * tengyur-draft-repairs-5497.mjs — $0 repairs of the Tengyur draft English, other defects.
 * Looked in scripts/maintenance/, scripts/audit/ and `git grep -i hangul`.
 *
 * #5734: the Tibetan retranslation run (envelope tibetan-retranslation-4523,
 * gemini-3-flash-preview, 2026-10-01) wrote Korean 그 ("that") in place of the English word —
 * "At 그 time a rain of flowers fell", fused "그at place", "그hat time". This is the $0
 * mechanical repair, `repairStrayHangul` (scripts/lib/stray-script.mjs):
 *   그 + space → "that "; 그at / 그hat → "that" ("That" at a sentence start).
 * A page that still has any other Hangul after that (그때, 이렇게, "그that", …) is NOT written:
 * it goes on the review list. A page whose source or book language carries Hangul is never
 * touched.
 *
 * Guards (translation-text-repair.mjs): skip a human-edited page; the write is conditional on
 * the exact text read; the page_revisions row is written FIRST (source fix-stray-hangul-5734,
 * before/after content_hash); both Supabase mirrors are re-synced after an --apply.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/fix-stray-hangul-5734.mjs [--out=DIR]
 *        → dry run over the envelope: DIR/hangul-diff.jsonl, DIR/hangul-review.jsonl
 *   … --ids-file=FILE   (one page id per line: the corpus scan's same-pattern pages instead)
 *   … --apply           write; DIR/hangul-applied.jsonl
 *   … --correct-doubled --ids-file=FILE [--apply]
 *        The first --apply (2026-10-03, envelope) used the rule as the issue wrote it, 그 + space →
 *        "that ", and turned "at 그 that time" into "at that that time" on 44 pages. This mode
 *        recomputes every page this script wrote from its revision row (the text before the repair)
 *        with the corrected rule, and writes it only where the page still holds exactly what the
 *        first rule produced — so nothing anyone wrote since is touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { repairStrayHangul } from '../lib/stray-script.mjs';
import { repairTranslationText, resyncMirrors, isHumanEditedTranslation } from '../lib/translation-text-repair.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const APPLY = process.argv.includes('--apply');
const OUT = arg('out', '/tmp/stray-hangul-5734');
const IDS_FILE = arg('ids-file', null);
const SOURCE = 'fix-stray-hangul-5734';
const ISSUE = '#5734';
const ENVELOPE = 'tibetan-retranslation-4523';
const RUN_SINCE = new Date('2026-10-01T11:00:00Z');

fs.mkdirSync(OUT, { recursive: true });
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

if (process.argv.includes('--correct-doubled')) {
  // The first rule, verbatim, to prove a page still holds only what it produced.
  const firstRule = (t) => t.replace(/그(?: |h?at\b)/g, (m, offset) => {
    const word = /(?:^|[.!?]["'”’)\]]*\s+|\n\s*)$/.test(t.slice(Math.max(0, offset - 6), offset)) ? 'That' : 'that';
    return m.endsWith(' ') ? `${word} ` : word;
  });
  // page_revisions has no index on `source`: scope by the pages the first run wrote (--ids-file).
  if (!IDS_FILE) throw new Error('--correct-doubled needs --ids-file (the page ids the first --apply wrote)');
  const ids = fs.readFileSync(IDS_FILE, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, source: SOURCE }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
  const firstRev = new Map();
  for (const r of revs) if (!firstRev.has(r.page_id)) firstRev.set(r.page_id, r);
  const pages = await db.collection('pages').find({ id: { $in: [...firstRev.keys()] } }, { projection: { id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1 } }).toArray();
  const out = fs.createWriteStream(path.join(OUT, `hangul-correct-doubled-${APPLY ? 'applied' : 'diff'}.jsonl`));
  const counts = { pages_written_by_this_script: pages.length, correct: 0, written: 0, would_write: 0, skipped: {} };
  const skip = (why) => { counts.skipped[why] = (counts.skipped[why] || 0) + 1; };
  const fixedIds = [];
  for (const p of pages) {
    const before = firstRev.get(p.id).data;
    const now = p.translation?.data || '';
    if (now !== firstRule(before)) { skip('changed_since'); continue; }
    const next = repairStrayHangul(before, { ocr: p.ocr?.data });
    if (next.text === now) { counts.correct++; continue; }
    if (next.other.length) { skip('hangul_left_under_new_rule'); out.write(JSON.stringify({ page_id: p.id, url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, status: 'review', other: next.other }) + '\n'); continue; }
    const res = await repairTranslationText(db, p, next.text, {
      expectBefore: now, source: SOURCE, issue: ISSUE, jobId: `${SOURCE}-correct-doubled`, apply: APPLY,
      reason: 'corrects the first #5734 repair: "그 that" had become "that that"; 그 beside its own "that" is dropped instead (no other text changed)',
    });
    const i = now.search(/that that/i);
    out.write(JSON.stringify({ page_id: p.id, url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, ...res, now_ctx: now.slice(Math.max(0, i - 50), i + 50), next_ctx: next.text.slice(Math.max(0, i - 50), i + 45) }) + '\n');
    if (res.status === 'written') { counts.written++; fixedIds.push(p.id); } else if (res.status === 'dry_run') counts.would_write++; else skip(res.why);
  }
  await new Promise((r) => out.end(r));
  if (fixedIds.length) counts.mirrors = await resyncMirrors(db, fixedIds);
  fs.writeFileSync(path.join(OUT, `hangul-correct-doubled-summary-${APPLY ? 'applied' : 'diff'}.json`), JSON.stringify(counts, null, 1));
  console.log(JSON.stringify(counts, null, 1));
  await mongo.close();
  process.exit(0);
}

let filter;
if (IDS_FILE) {
  const ids = fs.readFileSync(IDS_FILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  filter = { id: { $in: ids } };
} else {
  const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const bookIds = ctl?.allow_scopes?.[ENVELOPE]?.book_ids;
  if (!bookIds?.length) throw new Error(`envelope ${ENVELOPE} has no book_ids`);
  filter = { book_id: { $in: bookIds }, 'translation.updated_at': { $gte: RUN_SINCE } };
}
filter['translation.data'] = { $regex: '그' };

const pages = await db.collection('pages').find(filter, { projection: { id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1 } }).toArray();
const langs = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } }, { projection: { id: 1, language: 1 } }).toArray()).map((b) => [b.id, b.language]));

const tag = APPLY ? 'applied' : 'diff';
const diffOut = fs.createWriteStream(path.join(OUT, `hangul-${tag}.jsonl`));
const reviewOut = fs.createWriteStream(path.join(OUT, 'hangul-review.jsonl'));
const counts = { pages: pages.length, written: 0, would_write: 0, review: 0, skipped: {} };
const written = [];
const skip = (why) => { counts.skipped[why] = (counts.skipped[why] || 0) + 1; };
const url = (p) => `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`;
const around = (t, i) => t.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ');

for (const p of pages) {
  const before = p.translation?.data || '';
  const base = { page_id: p.id, book_id: p.book_id, page: p.page_number, url: url(p), model: p.translation?.model, language: langs.get(p.book_id) };
  if (isHumanEditedTranslation(p.translation)) { skip('human_edited'); continue; }
  const fix = repairStrayHangul(before, { ocr: p.ocr?.data, language: langs.get(p.book_id) });
  if (fix.expected) { skip('hangul_expected'); continue; }
  if (fix.other.length) {
    counts.review++;
    const i = before.search(/\p{Script=Hangul}/u);
    reviewOut.write(JSON.stringify({ ...base, other_hangul: fix.other, first: around(before, i) }) + '\n');
    continue;
  }
  if (!fix.count) { skip('no_pattern'); continue; }
  const res = await repairTranslationText(db, p, fix.text, {
    expectBefore: before, source: SOURCE, issue: ISSUE, jobId: SOURCE, apply: APPLY,
    reason: `stray Korean 그 ("that") replaced with the English word, ${fix.count}× (#5734 mechanical repair; no other text changed)`,
  });
  const examples = [];
  for (const m of before.matchAll(/그/g)) { if (examples.length < 3) examples.push(around(before, m.index)); }
  diffOut.write(JSON.stringify({ ...base, replaced: fix.count, ...res, before_ctx: examples, after_ctx: examples.map((e) => repairStrayHangul(e, {}).text) }) + '\n');
  if (res.status === 'written') { counts.written++; written.push(p.id); }
  else if (res.status === 'dry_run') counts.would_write++;
  else skip(res.why);
}
await new Promise((r) => diffOut.end(r));
await new Promise((r) => reviewOut.end(r));
if (written.length) counts.mirrors = await resyncMirrors(db, written);
fs.writeFileSync(path.join(OUT, `hangul-summary-${tag}.json`), JSON.stringify(counts, null, 1));
console.log(JSON.stringify(counts, null, 1));
await mongo.close();
