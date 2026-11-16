#!/usr/bin/env node
// PRIOR ART: scripts/eval/error-zoo/detector-suite.mjs (the specimen frame and the book-parity halves, reused here:
// half B is the held-out half) and scripts/audit/convergent-audit-weekly.mjs `draw` (one page per book, seeded). Neither
// draws the pages a prompt change is regenerated on. This is suite 2 for T10 (v3#44, vision note Part 4): the page lists
// and the arm-B instruction file for scripts/batch/claude-translate.mjs.
/**
 * Draw the T10 note-rule test (v3#44, v2#8632; Derek 2026-11-12 "yes", spare Claude quota, no writes).
 *
 *   node scripts/eval/error-zoo/t10-note-test/draw.mjs --zoo /root/jobs/error-zoo-v2/union --run DIR [--t10 40] [--clean 12] [--shards 4]
 *
 * Frame, fixed before any read:
 *   - T10 specimens: pages with a SERIOUS T10 finding from any store, label fresh (text unchanged since judged), in the
 *     held-out half B of books (book id parity, detector-suite.mjs `half`). One page per book, seeded draw.
 *   - Clean pages with notes: the weekly audit's random served stratum, no serious finding of any class, label fresh,
 *     half B, the stored English carrying at least one <note>. They measure the counter-class (helpful notes lost)
 *     on pages the rule should leave alone.
 * Writes DIR/draw.json, DIR/shard-<k>.json (page ids) and DIR/instructions-B.json (the arm-B line for
 * every page). Reads files only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../../lib/paired-stats.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ZOO = arg('zoo', '/root/jobs/error-zoo-v2/union'), RUN = arg('run');
const N_T10 = Number(arg('t10', 40)), N_CLEAN = Number(arg('clean', 12)), SHARDS = Number(arg('shards', 4)), SEED = 8632;
if (!RUN) { console.error('--run DIR required'); process.exit(2); }

// The rule under test, worded before the run (v2#8632 DECISION 1) and not tuned afterwards.
export const NOTE_RULE = '**Notes (this replaces the note instructions above):** a <note> may gloss a word or phrase, give the original wording, or mark an interpolated clarification. It never explains a reading, and never adds a date, name or reference that this page lacks.';

const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const labels = jl(path.join(ZOO, 'labels.jsonl'));
const pages = new Map(jl(path.join(ZOO, 'pages.jsonl')).map((p) => [p.page_id, p]));
const half = (bookId) => (parseInt(String(bookId).slice(-2), 16) % 2 ? 'B' : 'A');
const serious = (e) => (e.severity || 'serious') === 'serious';
const rng = makeRng(SEED);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// English books are never translated (translate-core sameLanguageReason), so they cannot be regenerated.
const notEnglish = (p) => !/^\s*(english|en)\b/i.test(String(p?.book?.language ?? ''));
const fresh = labels.filter((r) => r.stale === false && half(r.book_id) === 'B' && pages.get(r.page_id)?.ocr_text && pages.get(r.page_id)?.translation && notEnglish(pages.get(r.page_id)));
const t10 = fresh.filter((r) => r.errors.some((e) => e.class === 'T10' && serious(e)));
const anySerious = new Set(fresh.filter((r) => r.serious || r.errors.some(serious)).map((r) => r.page_id));
const clean = fresh.filter((r) => r.source === 'spare_audit' && r.selection === 'random' && r.exposure === 'served' && !anySerious.has(r.page_id) && /<note>/.test(pages.get(r.page_id).translation));

function onePerBook(rows, n, taken) {
  const out = [];
  for (const r of shuffle([...new Map(rows.map((x) => [x.page_id, x])).values()].sort((a, b) => a.page_id.localeCompare(b.page_id)))) {
    if (out.length >= n) break;
    if (taken.has(r.book_id)) continue;
    taken.add(r.book_id); out.push(r);
  }
  return out;
}
const taken = new Set();
const drawT10 = onePerBook(t10, N_T10, taken);
const drawClean = onePerBook(clean, N_CLEAN, taken);
const rows = [...drawT10.map((r) => ({ r, stratum: 't10' })), ...drawClean.map((r) => ({ r, stratum: 'clean-with-notes' }))].map(({ r, stratum }) => {
  const p = pages.get(r.page_id);
  return { page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, stratum, language: p.book?.language ?? null,
    label: { source: r.source, method: r.method, run_id: r.run_id, judged_at: r.judged_at,
      t10: r.errors.filter((e) => e.class === 'T10' && serious(e)).map((e) => ({ problem: e.problem, bad: e.bad ?? null })) },
    stored_tr_model: p.tr_model ?? null };
});
fs.mkdirSync(RUN, { recursive: true });
// Shards: the translator runs one call at a time, so the page list is split across a few parallel readers.
const byShard = Array.from({ length: SHARDS }, () => []);
rows.forEach((x, i) => byShard[i % SHARDS].push(x.page_id));
byShard.forEach((ids, k) => fs.writeFileSync(path.join(RUN, `shard-${k}.json`), JSON.stringify(ids)));
fs.writeFileSync(path.join(RUN, 'instructions-B.json'), JSON.stringify(Object.fromEntries(rows.map((x) => [x.page_id, NOTE_RULE])), null, 1));
fs.writeFileSync(path.join(RUN, 'draw.json'), JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), zoo: ZOO, note_rule: NOTE_RULE,
  frame: { t10_fresh_half_b_pages: t10.length, t10_books: new Set(t10.map((r) => r.book_id)).size, clean_with_notes_half_b_pages: clean.length }, pages: rows }, null, 1));
const langs = {}; rows.forEach((x) => { langs[x.language] = (langs[x.language] || 0) + 1; });
console.log(`drew ${drawT10.length} T10 pages (frame ${t10.length} pages in ${new Set(t10.map((r) => r.book_id)).size} books) and ${drawClean.length} clean pages with notes (frame ${clean.length}); seed ${SEED}`);
console.log(JSON.stringify(langs));
