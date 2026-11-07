#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/paddle-zh-lane.mjs (the lane that wrote these pages; its convertPaddle() marks the 版心 margin
 * at READ time, so it cannot reach text already stored), scripts/maintenance/fix-histories-juan-labels-8053.mjs (a
 * catalogue field, not page text) and scripts/eval/results/spot-check/overview-2026-11-04-zh-held/model-free/garble-count.mjs
 * (counts the class, writes nothing). None of them relabels stored OCR.
 *
 * label-skqs-margin-garble-8053 — the 欽定四庫全書 margin column, misread past recognition (次定曰事全焉, 欠巳曰三二三),
 * sits in the stored Paddle OCR as a BODY line (#8053 hole F, #5142 O11). This wraps that line in <header>…</header>,
 * the tag the lane gives the margin, so the reader and the translator see furniture, not text. LABEL, NEVER DELETE:
 * the characters Paddle read are kept exactly; only the tag changes. The predicate is the lane's own
 * (isGarbledSkqsMargin in scripts/lib/paddle-zh-lane.mjs), on the first or last four body lines, as at read time.
 *
 * Every write goes through writePageText (page_revisions row with the whole prior field, compare-and-set on the prior
 * text, human-edit guard, one run id: scripts/maintenance/revert-run.mjs --run-id <run> undoes it) and a sweep_log row
 * per book. The English is NOT marked stale: the body text is unchanged. Pages whose English made the line into a
 * commentator ("Ci Ding") are repaired separately (#8053, translation side).
 *
 *   node --env-file=.env.production.local scripts/maintenance/label-skqs-margin-garble-8053.mjs [--hold zh-histories-7546] [--limit N]   dry run
 *   ... --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { isGarbledSkqsMargin } from '../lib/paddle-zh-lane.mjs';
import { writePageText, newRunId, textHash, isHumanEditedField } from '../lib/page-text-writer.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SCRIPT = 'scripts/maintenance/label-skqs-margin-garble-8053.mjs';
const SWEEP = 'label-skqs-margin-garble-8053';
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const HOLD = arg('--hold', 'zh-histories-7546');
const LIMIT = Number(arg('--limit', 0)) || Infinity;
const OUT = arg('--out', null);
const EDGE = 4;

/** The relabelled text, or null when nothing changes. Exported for the test. */
export function relabel(text) {
  const lines = String(text || '').split('\n');
  // body lines: everything after the <language>/<script> envelope that is not blank
  const body = lines.map((l, i) => ({ l: l.trim(), i })).filter(({ l }) => l && !/^<(language|script)>[\s\S]*<\/\1>$/.test(l));
  const edge = new Set([...body.slice(0, EDGE), ...body.slice(-EDGE)].map((b) => b.i));
  const hits = [];
  const out = lines.map((l, i) => {
    const t = l.trim();
    if (!edge.has(i) || /[<>]/.test(t) || !isGarbledSkqsMargin(t)) return l;
    hits.push(t);
    return `<header>${t.replace(/\s/g, '')}</header>`;
  });
  return hits.length ? { text: out.join('\n'), hits } : null;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = await db.collection('books').find({ 'pipeline_auto.hold.reason': HOLD }, { projection: { id: 1, title: 1, visible: 1 } }).toArray();
  const runId = newRunId(SWEEP);
  const tally = { books: books.length, pages_seen: 0, pages_hit: 0, written: 0, human_edited: 0, other: {} };
  const rows = [];
  let n = 0;
  for (const b of books) {
    const pages = await db.collection('pages').find({ book_id: b.id, 'ocr.data': { $type: 'string' } }, { projection: { id: 1, page_number: 1, ocr: 1 } }).toArray();
    let bookHits = 0;
    for (const p of pages) {
      tally.pages_seen++;
      const r = relabel(p.ocr.data);
      if (!r) continue;
      if (n++ >= LIMIT) break;
      tally.pages_hit++;
      if (isHumanEditedField(p.ocr)) { tally.human_edited++; continue; }
      rows.push({ book_id: b.id, page_id: p.id, pn: p.page_number, visible: !!b.visible, hits: r.hits });
      if (!APPLY) continue;
      const { content_hash, updated_at, ...keep } = p.ocr; // re-stamped by the writer from the new text
      const res = await writePageText(db, p.id, 'ocr', { ...keep, data: r.text }, {
        by: SCRIPT, reason: 'label the garbled 欽定四庫全書 margin line as <header> (#8053 F, #5142 O11)', run_id: runId,
        revision_source: SWEEP, expect_prior_hash: textHash(p.ocr),
      });
      if (res.status === 'written') { tally.written++; bookHits++; } else tally.other[res.status] = (tally.other[res.status] || 0) + 1;
    }
    if (APPLY && bookHits) await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'label-margin-header', detail: { issue: 8053, pages: bookHits, run_id: runId, script: SCRIPT } });
    if (n > LIMIT) break;
  }
  if (OUT) fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({ apply: APPLY, hold: HOLD, run_id: APPLY ? runId : null, ...tally, visible_pages: rows.filter((r) => r.visible).length }, null, 1));
  await client.close();
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === (await import('path')).resolve(process.argv[1]);
if (isMain) await main();
