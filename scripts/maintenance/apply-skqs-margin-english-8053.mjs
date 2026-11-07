#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/label-skqs-margin-garble-8053.mjs (the OCR half of the same defect: it tags the
 * garbled 欽定四庫全書 line <header>, and cannot reach English already made from it), scripts/maintenance/fix-translation-loops.mjs
 * (cuts a repeated span, a rule with no reader in the loop) and scripts/maintenance/mark-stale-translations.mjs (flags,
 * writes no text). None applies a checked, span-exact edit to a stored English page.
 *
 * apply-skqs-margin-english-8053 — the English half of #8053 hole F (#5142 O11). Where the OCR had the 欽定四庫全書
 * margin column garbled as a body line (次定…, 金定…), the translator made it into words: a commentator "Ci Ding"
 * who "says", or "<unclear>ci ding yue …</unclear>". An Opus editor with the leaf image open proposed, per page, the
 * exact span to replace and the replacement: the house convention for the margin title,
 *   <header>Imperially Commissioned Complete Library of the Four Treasuries <note>original: "欽定四庫全書" (Qinding Siku Quanshu)</note></header>
 * This writes those edits, and nothing else, so the furniture stays LABELLED, never deleted.
 *
 * Guards, per page: the stored English must still be the text the editor saw (sha256 of the packet's en.txt =
 * textHash prior, compare-and-set in the writer); every `old` occurs exactly once; the edit may not touch Chinese
 * characters outside the convention's own 欽定四庫全書, and may not shrink the page by more than 400 characters; the
 * result passes the write guard (write-text-guard.mjs: a tag left open, a cut) ; human-edited English is refused.
 * Writes go through writePageText (page_revisions with the whole prior field, one run id —
 * scripts/maintenance/revert-run.mjs --run-id <run> undoes it) plus a sweep_log row per book.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-skqs-margin-english-8053.mjs --packets DIR --edits a.json,b.json   dry run
 *   ... --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { writePageText, newRunId, textHash, isHumanEditedField } from '../lib/page-text-writer.mjs';
import { checkWrittenText } from '../lib/write-text-guard.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SCRIPT = 'scripts/maintenance/apply-skqs-margin-english-8053.mjs';
const SWEEP = 'apply-skqs-margin-english-8053';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const DIR = arg('--packets', null);
const EDITS = (arg('--edits', '') || '').split(',').filter(Boolean);
export const HEADER = '<header>Imperially Commissioned Complete Library of the Four Treasuries <note>original: "欽定四庫全書" (Qinding Siku Quanshu)</note></header>';

const han = (s) => (String(s).replace(/欽定四庫全書/g, '').match(/\p{Script=Han}/gu) || []).join('');

/** Apply span edits to a text; returns {text} or {refused: why}. Exported for the test. */
export function applyEdits(text, edits) {
  let out = text;
  for (const e of edits) {
    if (typeof e.old !== 'string' || typeof e.new !== 'string' || !e.old) return { refused: 'malformed edit' };
    const n = out.split(e.old).length - 1;
    if (n !== 1) return { refused: `an edit's old span occurs ${n} times` };
    // The garbled Chinese the old span quoted may go; Chinese the replacement adds, beyond the convention, may not.
    if (han(e.new).length && !han(e.old).includes(han(e.new))) return { refused: 'an edit adds Chinese text' };
    out = out.replace(e.old, () => e.new);
  }
  if (text.length - out.length > 400) return { refused: `the edits remove ${text.length - out.length} characters` };
  if (!out.includes('欽定四庫全書') && edits.length) return { refused: 'no margin header in the result' };
  return { text: out };
}

async function main() {
  if (!DIR || !EDITS.length) { console.error('--packets DIR and --edits a.json[,b.json] are required'); process.exit(2); }
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  const edits = Object.assign({}, ...EDITS.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const runId = newRunId(SWEEP);
  const tally = { packets: index.length, with_edits: 0, no_edit: 0, written: 0, refused: {}, other: {} };
  const perBook = {};
  for (const x of index) {
    const v = edits[x.k];
    if (!v) { tally.refused['no verdict'] = (tally.refused['no verdict'] || 0) + 1; continue; }
    if (!v.edits?.length) { tally.no_edit++; console.log(`  ${x.k} p.${x.pn}: no edit — ${v.note || ''}`); continue; }
    tally.with_edits++;
    const seen = fs.readFileSync(path.join(DIR, x.k, 'en.txt'), 'utf8');
    const page = await db.collection('pages').findOne({ id: x.page_id }, { projection: { id: 1, book_id: 1, translation: 1 } });
    const cur = page?.translation;
    const refuse = (why) => { tally.refused[why] = (tally.refused[why] || 0) + 1; console.log(`  ${x.k} p.${x.pn}: REFUSED ${why}`); };
    if (!cur?.data) { refuse('no stored English'); continue; }
    if (cur.data !== seen) { refuse('the English changed since the editor read it'); continue; }
    if (isHumanEditedField(cur)) { refuse('human-edited'); continue; }
    const r = applyEdits(cur.data, v.edits);
    if (r.refused) { refuse(r.refused); continue; }
    const g = checkWrittenText(r.text, { kind: 'translation' });
    if (g.verdict === 'truncated' || g.verdict === 'empty') { refuse(`write guard: ${g.verdict}`); continue; }
    console.log(`  ${x.k} p.${x.pn}: ${v.edits.length} edit(s), ${cur.data.length} → ${r.text.length} chars`);
    if (!APPLY) continue;
    const { content_hash, updated_at, ...keep } = cur;
    const res = await writePageText(db, x.page_id, 'translation', { ...keep, data: r.text }, {
      by: SCRIPT, reason: 'the 欽定四庫全書 margin column, rendered as words ("Ci Ding"…), relabelled as the margin header (#8053 F, #5142 O11); span edits checked against the leaf by an Opus editor',
      run_id: runId, revision_source: SWEEP, expect_prior_hash: textHash(cur),
    });
    if (res.status === 'written') { tally.written++; perBook[page.book_id] = (perBook[page.book_id] || 0) + 1; } else tally.other[res.status] = (tally.other[res.status] || 0) + 1;
  }
  if (APPLY) for (const [book_id, pages] of Object.entries(perBook)) await recordSweepAction(db, { sweep: SWEEP, book_id, action: 'relabel-margin-english', detail: { issue: 8053, pages, run_id: runId, script: SCRIPT } });
  console.log(JSON.stringify({ apply: APPLY, run_id: APPLY ? runId : null, ...tally }, null, 1));
  await client.close();
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1]);
if (isMain) await main();
