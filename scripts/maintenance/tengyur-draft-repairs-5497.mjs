#!/usr/bin/env node
// PRIOR ART: scripts/lib/translation-text-repair.mjs (repairTranslationText / resyncMirrors) — the
// guarded door every stored-translation repair goes through; used as-is. scripts/maintenance/
// fix-unclosed-note-tags.mjs — the #5644 repair; this script only DERIVES its page list and runs it.
// scripts/eval/tengyur-pilot-qa/mechanical.mjs (PR #5676) — defines the three defects (hash_leak,
// note_unbalanced, D_dropped); the `#` rule below is its hashLeak rule. Nothing existing strips a
// leaked Esukhia `#` from English.
/**
 * The $0 repairs after the Derge Tengyur draft run (#5497, QA finding 3). Deterministic, no model,
 * no retranslation. Dry run by default.
 *
 *   1. `#` — Esukhia peydurma note points the model carried into the English as pseudo-emphasis
 *      ("the #dispositions of all realms#"). Every `#` (and `\#`) is removed except a Markdown
 *      heading marker (1–6 `#` at line start followed by a space). One page_revisions row per page
 *      (repairTranslationText: human-edited pages skipped, conditional write, before/after hash).
 *   2. Unclosed / malformed `<note>` — the page list (noteTagBalance not balanced) is handed to
 *      scripts/maintenance/fix-unclosed-note-tags.mjs, which writes its own revision rows. Run
 *      after step 1, so it reads the text step 1 left.
 *   3. `{D####}` Tohoku text openings lost in the English — NOT written. The reader renders no
 *      text-boundary marker (nothing under src/ reads one), and the opening of every text is already
 *      recorded per page in `ocr.text_edition.tohoku` by the import. Inventing markup in the English
 *      would show as literal braces. This step only verifies that field covers every page whose
 *      source carries a `{D…}` marker, and reports the pages whose English dropped it.
 *
 *   node --env-file=.env.production.local scripts/maintenance/tengyur-draft-repairs-5497.mjs [--apply] [--out=FILE]
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { repairTranslationText, resyncMirrors, noteTagBalance } from '../lib/translation-text-repair.mjs';

const APPLY = process.argv.includes('--apply');
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) || '/tmp/tengyur-draft-repairs-5497.json';
const HOLD = 'tengyur-import-5497';
const ISSUE = 5497;

/** Remove leaked Esukhia `#` marks; keep Markdown heading markers. */
export function stripHashMarks(text) {
  return String(text).split('\n').map((line) => {
    if (/https?:\/\//.test(line)) return line;
    const head = line.match(/^#{1,6} /)?.[0] || '';
    const rest = line.slice(head.length);
    if (!rest.includes('#')) return line;
    // A space survives only between two words: never at either end, never before punctuation or a tag.
    return head + rest.replace(/ ?\\?#+ ?/g, (m, at, s) => {
      const before = s[at - 1], after = s[at + m.length];
      return m.includes(' ') && before !== undefined && after !== undefined && !/[\s.,;:!?)\]<]/.test(after) && !/[\s(\[>]/.test(before) ? ' ' : '';
    });
  }).join('\n');
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const bookIds = (await db.collection('books').find({ $or: [{ 'pipeline_auto.hold.reason': HOLD }, { title: /Derge Tengyur, vol\./ }] }, { projection: { id: 1 } }).toArray()).map((b) => b.id);
  const report = { apply: APPLY, books: bookIds.length, pages_translated: 0, hash: { pages: 0, marks: 0, written: 0, skipped: {} }, notes: { pages: 0, ids: [] }, tohoku: { src_pages: 0, field_missing: [], en_dropped: 0 } };
  const touched = [];
  const cur = db.collection('pages').find({ book_id: { $in: bookIds }, 'translation.data': { $exists: true, $nin: [null, ''] } }, { projection: { id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1, 'ocr.text_edition.tohoku': 1 } });
  for await (const p of cur) {
    report.pages_translated++;
    const en = p.translation.data;
    // 3. Tohoku openings: recorded in the field? dropped from the English?
    const srcD = [...String(p.ocr?.data || '').matchAll(/\{(D\d+[a-z]?(?:-\d+)?)\}/g)].map((m) => m[1]);
    if (srcD.length) {
      report.tohoku.src_pages++;
      const field = p.ocr?.text_edition?.tohoku || [];
      if (!srcD.every((d) => field.includes(d))) report.tohoku.field_missing.push(p.id);
      if (!srcD.every((d) => en.includes(`{${d}}`))) report.tohoku.en_dropped++;
    }
    // 1. `#`
    const next = stripHashMarks(en);
    let text = en;
    if (next !== en) {
      report.hash.pages++;
      report.hash.marks += (en.match(/#/g) || []).length - (next.match(/#/g) || []).length;
      const r = await repairTranslationText(db, p, next, { expectBefore: en, source: 'tengyur-draft-repairs-5497', reason: 'strip Esukhia peydurma # marks leaked into the English (QA finding 3)', issue: ISSUE, jobId: 'tengyur-complete-5497', apply: APPLY });
      if (r.status === 'written') { report.hash.written++; touched.push(p.id); text = next; }
      else if (r.status === 'dry_run') text = next;
      else report.hash.skipped[r.why] = (report.hash.skipped[r.why] || 0) + 1;
    }
    // 2. note balance, on the text step 1 leaves
    if (!noteTagBalance(text).balanced) { report.notes.pages++; report.notes.ids.push(p.id); }
  }
  if (APPLY && touched.length) report.hash.resync = await resyncMirrors(db, touched);
  await c.close();
  if (report.notes.ids.length) {
    const idsFile = OUT.replace(/\.json$/, '') + '-note-ids.json';
    fs.writeFileSync(idsFile, JSON.stringify(report.notes.ids));
    const args = ['scripts/maintenance/fix-unclosed-note-tags.mjs', `--ids=${idsFile}`, `--out=${OUT.replace(/\.json$/, '')}-notes-diff.json`, ...(APPLY ? ['--apply'] : [])];
    report.notes.run = execFileSync(process.execPath, args, { encoding: 'utf8', env: process.env, timeout: 1800000 }).trim().split('\n').slice(-6);
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ ...report, notes: { ...report.notes, ids: report.notes.ids.length }, tohoku: { ...report.tohoku, field_missing: report.tohoku.field_missing.length } }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
