#!/usr/bin/env node
// PRIOR ART: scripts/eval/book-class-5768.mjs --write (sets books.book_class + one sweep_log row per book; this writes
// the same field, by eye, with the finer script it cannot see); scripts/maintenance/hold-pipeline-books.mjs (the hold
// CLI; this calls the same holdBook() so the hold, its book_events row and its release condition are identical, and
// keeps the tag and the hold in one dry-runnable step).
//
// store — write the #254 by-eye tags to books.book_class, hold the books whose script the stored read cannot be
// trusted on, and read both back (#254).
//
// book_class (book-docs.mjs) is "what the book's writing IS", derived from page images. This writes:
//   class         printed | handwritten   (print → printed; manuscript → handwritten); unchanged when the kind is
//                                          lithograph or unclear (Opus's lithograph call failed 5 of 17 key books)
//   script_family indic | tibetan | arabic | latin | other   (the #5768 vocabulary, unchanged in meaning)
//   script        devanagari | sharada | newar | … | mixed | none | unclear   (new sub-key: the family stops at indic)
//   kind          print | manuscript | lithograph | unclear                     (new sub-key: class has no lithograph)
//   evidence      { source: 'by-eye-254', family_source: 'by-eye', pages: [{ page_id, page, writing, answer }],
//                   agree, confidence, note }
//   model, version: 'script-tags-254-v1', tagger: 'sa-script-tags-254', at
// The value it replaces goes into the book's sweep_log row (detail.previous), so the write is reversible.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/sa-script-tags-254/store.mjs --dir $JOB_SCRATCH/w           # dry run
//   ... --apply            write tags and holds
//   ... --readback         counts from Mongo: tagged by script × kind, held, recorded reason
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../../lib/sweep-log.mjs';
import { holdBook } from '../../lib/pipeline-hold.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('--dir'); const APPLY = process.argv.includes('--apply'); const READBACK = process.argv.includes('--readback');
const ARM = arg('--arm', 'opus');
if (!DIR) throw new Error('--dir required');
export const VERSION = 'script-tags-254-v1';
export const SWEEP = 'script-tags-254';

/** Scripts the stored read (gemini-3.1-flash-lite) has been seen to read usably on these books: #95, 11 of 11 pages. */
export const TRUSTED_SCRIPTS = new Set(['devanagari']);
/** Not held: no text to translate, or a script the route reads everywhere else (a Latin-script edition). */
export const NOT_HELD_SCRIPTS = new Set(['none', 'latin']);
export const HOLD = {
  reason: 'sarada-unread-254',
  issue: 254,
  source: 'script-tags-254',
  release: 'Released when a reader has been shown to read this book\'s script on the #95 answer-key leaves (by eye, against the image) and the book has been re-read by it; or when a person looking at the leaves finds the tag wrong (v3#254 by-eye script tag; #95 found 0 of 36 Sharada pages usable).',
  release_when: { kind: 'decision', ref: 'release sarada-unread-254' },
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/^other:\s*/, 'other:').replace(/[āá]/g, 'a').replace(/ś/g, 's');
const FAMILY = (s) => (s === 'tibetan' ? 'tibetan' : s === 'arabic-persian' ? 'arabic' : s === 'latin' ? 'latin' : ['mixed', 'none', 'unclear'].includes(s) || s.startsWith('other:') ? null : 'indic');

export function bookClassOf(tag, leaves, prev, at) {
  const script = norm(tag.script); const kind = norm(tag.kind);
  // lithograph keeps the old class: on the 17 key books Opus called both keyed prints and 3 keyed manuscripts
  // "lithograph" (kind 12/17 against script 17/17), so it is not evidence for either class.
  const cls = kind === 'print' ? 'printed' : kind === 'manuscript' ? 'handwritten' : prev?.class ?? null;
  const pid = new Map(leaves.map((l) => [l.page, l.page_id]));
  return {
    class: cls,
    script_family: FAMILY(script) ?? prev?.script_family ?? null,
    script, kind,
    evidence: {
      source: 'by-eye-254', family_source: 'by-eye',
      pages: (tag.leaves || []).map((l) => ({ page_id: pid.get(l.page) ?? null, page: l.page, writing: l.writing !== false, answer: norm(l.script) })),
      agree: tag.agree === true, confidence: tag.confidence === 'sure' ? 'sure' : 'unsure', note: tag.note ?? null,
    },
    model: tag.model, version: VERSION, tagger: 'sa-script-tags-254', at,
  };
}
/**
 * Held: every script but Devanagari, Latin and none (no text on the leaves); a `mixed` book only when one of its
 * scripts is untrusted (a Śāradā or Perso-Arabic leaf, by leaf answer or note); and a Devanagari call the tagger was
 * unsure of AND whose note says it could not rule out Śāradā — on #95 the stored tag mixed the two up 3 times in 11.
 */
export function needsHold(bc) {
  const note = String(bc.evidence?.note || '');
  if (bc.script === 'mixed') return bc.evidence.pages.some((p) => p.writing && !['devanagari', 'latin', 'none', 'mixed', 'unclear'].includes(p.answer)) || /sharada|śāradā|nastaliq|persian/i.test(note);
  if (bc.script === 'devanagari') return bc.evidence.confidence === 'unsure' && /sharada|śāradā/i.test(note);
  return !TRUSTED_SCRIPTS.has(bc.script) && !NOT_HELD_SCRIPTS.has(bc.script);
}

async function main() {
  const frame = JSON.parse(fs.readFileSync(path.join(DIR, 'frame.json'))).books;
  const tags = new Map(fs.readFileSync(path.join(DIR, `tags-${ARM}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((t) => [t.book, t]));
  const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore'); const B = db.collection('books');
  const ids = frame.map((b) => b.id);
  if (READBACK) {
    const rows = await B.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_class: 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.status': 1 } }).toArray();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const cells = {}; const held = {}; let tagged = 0, reason = 0, neither = [];
    for (const id of ids) {
      const r = byId.get(id); const bc = r?.book_class;
      if (bc?.version === VERSION) { tagged++; const k = `${bc.script} | ${bc.kind}${bc.evidence?.confidence === 'unsure' ? ' (unsure)' : ''}`; cells[k] = (cells[k] || 0) + 1; }
      else if (fs.existsSync(path.join(DIR, 'reasons.jsonl')) && fs.readFileSync(path.join(DIR, 'reasons.jsonl'), 'utf8').includes(id)) reason++;
      else neither.push(id);
      const h = r?.pipeline_auto?.hold?.reason ?? '(none)'; held[h] = (held[h] || 0) + 1;
    }
    console.log(JSON.stringify({ frame: ids.length, tagged, recorded_reason: reason, neither: neither.length, neither_ids: neither.slice(0, 20), cells, holds: held }, null, 1));
    await c.close(); return;
  }
  const prevRows = await B.find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_class: 1, pipeline_auto: 1 } }).toArray();
  const prev = new Map(prevRows.map((r) => [r.id, r]));
  const at = new Date();
  const writes = [], holds = [], missing = [];
  for (const b of frame) {
    const t = tags.get(b.id);
    if (!t) { missing.push(b.id); continue; }
    const p = prev.get(b.id);
    if (p?.book_class?.version === VERSION) continue; // already written
    const bc = bookClassOf(t, b.leaves, p?.book_class, at);
    writes.push({ id: b.id, bc, previous: p?.book_class ?? null });
    if (needsHold(bc)) holds.push({ id: b.id, script: bc.script, kind: bc.kind, existing: p?.pipeline_auto?.hold?.reason ?? null });
  }
  const tally = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  console.log(JSON.stringify({ apply: APPLY, writes: writes.length, untagged_in_file: missing.length, by_script_kind: tally(writes, (w) => `${w.bc.script}|${w.bc.kind}`), holds: holds.length, hold_by_script: tally(holds, (h) => h.script), already_held: tally(holds.filter((h) => h.existing), (h) => h.existing) }, null, 1));
  if (!APPLY) { await c.close(); return; }
  for (let i = 0; i < writes.length; i += 200) {
    const chunk = writes.slice(i, i + 200);
    await B.bulkWrite(chunk.map((w) => ({ updateOne: { filter: { id: w.id }, update: { $set: { book_class: w.bc } } } })), { ordered: false });
    await recordSweepActions(db, chunk.map((w) => ({ sweep: SWEEP, book_id: w.id, action: 'set book_class (by-eye script tag)', detail: { script: w.bc.script, kind: w.bc.kind, confidence: w.bc.evidence.confidence, model: w.bc.model, pages: w.bc.evidence.pages.map((p) => p.page), previous: w.previous } })));
  }
  const outcomes = {};
  for (const h of holds) {
    const r = await holdBook(db, h.id, { ...HOLD, detail: { script: h.script, kind: h.kind, tag_version: VERSION } });
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
    fs.appendFileSync(path.join(DIR, 'holds.jsonl'), JSON.stringify({ ...h, outcome: r.outcome, from: r.from ?? null, at: new Date().toISOString() }) + '\n');
  }
  console.log(JSON.stringify({ written: writes.length, hold_outcomes: outcomes }));
  await c.close();
}
await main();
