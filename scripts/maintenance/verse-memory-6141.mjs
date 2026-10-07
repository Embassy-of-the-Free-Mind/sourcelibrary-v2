#!/usr/bin/env node
// PRIOR ART: scripts/lib/translation-text-repair.mjs (repairTranslationText / resyncMirrors) — the guarded door,
// used as-is. scripts/maintenance/tengyur-draft-repairs-5497.mjs — the open-run check (openRunBooks) copied from it.
// No existing script replaces a span of English with a reviewed rendering.
/**
 * verse-memory-6141.mjs — steps 3–4 of #6141. Dry run by default.
 *
 * Replaces ONLY the verse lines of a quoted Tibetan root verse with its verse-memory reference rendering, on pages
 * where two readers (the drafter and a blind checker, Opus subagents) both graded the stored lines weak or wrong and
 * the blind checker graded the reference ok. The prose around the verse is never touched.
 *
 * Per page, at plan time AND re-read from Mongo just before the write:
 *   - the Tibetan run and the English verse block are re-found (verse-lib.mjs) and the block must have exactly one
 *     line per pāda of the run, and its lines for the span must still be the text the readers graded;
 *   - no <note> inside the replaced lines; each line keeps its own leading quote/markup prefix and trailing quote;
 *   - human-edited pages, pages whose text changed, and books with an open translate_batch_runs run are skipped;
 *   - repairTranslationText writes the page_revisions row first (before/after content_hash, reason, issue, job).
 *
 *   node --env-file=… scripts/maintenance/verse-memory-6141.mjs --work /root/timp [--apply] [--limit-pages=a,b,…]
 * Writes <work>/vm/proposals.json (dry run) or <work>/vm/applied.json.
 *   --round=2 [--exclude-draw <work>/vm/byeye-draw.json]: whole verse blocks only (splice2); writes <work>/vm2/.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { repairTranslationText, resyncMirrors, isHumanEditedTranslation } from '../lib/translation-text-repair.mjs';
import { verseRuns, verseBlocks, alignRunsToBlocks, normEn, dice } from '../eval/tengyur-improve/verse-lib.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); if (a) return a.slice(k.length + 3); const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const WORK = arg('work', '/root/timp'), APPLY = process.argv.includes('--apply');
const LIMIT = arg('limit-pages') ? new Set(arg('limit-pages').split(',')) : null;
const ROUND = Number(arg('round', '1')), EXCLUDE = arg('exclude-draw') ? new Set(JSON.parse(fs.readFileSync(arg('exclude-draw'), 'utf8')).map((x) => x.page_id)) : null;
const ISSUE = 6141, SOURCE = ROUND === 2 ? 'verse-memory-r2-6141' : 'verse-memory-6141', JOB = ROUND === 2 ? 'verse-r2-6141' : 'tengyur-improve-6141';
// Round 2's by-eye gate FAILED on 2026-10-07 (6 better / 1 same / 1 worse of the 8 fresh pages it can reach): dry run only.
if (ROUND === 2 && APPLY) throw new Error('--round=2 --apply refused: its gate failed (#6141, experiments/2026-10-07-verse-memory-r2-6141.md)');
const dir = path.join(WORK, 'vm'), outDir = path.join(WORK, ROUND === 2 ? 'vm2' : 'vm'); fs.mkdirSync(outDir, { recursive: true });
const readAll = (sub) => fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith('.json')).sort().flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, sub, f), 'utf8')));
const packets = readAll('packets'), drafts = readAll('drafts'), checks = readAll('checked');
const key = JSON.parse(fs.readFileSync(path.join(dir, 'check-key.json'), 'utf8'));

// ── which verses pass, which stored renderings both readers find wanting ──
const plan = [], verdicts = [];
for (const v of packets) {
  const d = drafts.find((x) => x.vid === v.vid), ch = checks.find((x) => x.vid === v.vid);
  if (!d || !ch) { verdicts.push({ vid: v.vid, pass: false, why: 'missing draft or check' }); continue; }
  const inv = Object.fromEntries(Object.entries(key[v.vid]).map(([c, src]) => [src, c]));
  const dg = ch.grades[inv.draft]?.grade;
  const pass = dg === 'ok' && d.confidence !== 'low' && d.reference.length === v.span_padas.length;
  const refHash = crypto.createHash('sha256').update(d.reference.join('\n')).digest('hex').slice(0, 16);
  verdicts.push({ vid: v.vid, pass, draft_grade_blind: dg, draft_is_best: ch.best === inv.draft, confidence: d.confidence, ref_hash: refHash });
  if (!pass) continue;
  for (const r of v.renderings) {
    if (d.misaligned.includes(r.r)) continue;
    const g1 = d.grades[String(r.r)], g2 = ch.grades[inv[`r${r.r}`]]?.grade;
    if (!['weak', 'wrong'].includes(g1) || !['weak', 'wrong'].includes(g2)) continue;
    const m = r.page_url.match(/book\/([0-9a-f]+)\?page=(\d+)/);
    plan.push({ vid: v.vid, ref_hash: refHash, reference: d.reference, span_padas: v.span_padas, book_id: m[1], page_number: Number(m[2]), page_url: r.page_url,
      graded: { drafter: g1, blind: g2, blind_error: ch.grades[inv[`r${r.r}`]]?.error || null }, stored_lines: r.rendering });
  }
}

// Kept from each stored line: indentation, a blockquote mark, the reader's ->centred<- arrows, emphasis, quote marks.
const PREFIX = /^(\s*(?:>\s*)?(?:->)?(?:[*_]+)?["“‘']?)/, SUFFIX = /(["”’']?(?:[*_]+)?(?:<-)?\s*)$/;
function splice(en, page, item) {
  const runs = verseRuns(page.ocr?.data || ''); const blocks = verseBlocks(en); const al = alignRunsToBlocks(runs, blocks);
  const want = item.span_padas.join(' / ');
  for (const [ri, bi] of al) {
    const run = runs[ri];
    for (let i0 = 0; i0 + item.span_padas.length <= run.padas.length; i0++) {
      if (run.padas.slice(i0, i0 + item.span_padas.length).join(' / ') !== want) continue;
      const bl = blocks[bi];
      if (bl.lines.length !== run.padas.length) return { skip: 'block_line_count' };
      const lines = bl.lines.slice(i0, i0 + item.span_padas.length);
      const a = lines[0].a, b = lines[lines.length - 1].b;
      if (en.slice(a, b) !== item.stored_lines) return { skip: 'lines_changed' };
      if (/<note\b/.test(en.slice(a, b))) return { skip: 'note_in_span' };
      const next = lines.map((ln, k) => (ln.text.match(PREFIX)[1] + item.reference[k] + (ln.text.match(SUFFIX)[1] || ''))).join('\n');
      return { text: en.slice(0, a) + next + en.slice(b), before: en.slice(a, b), after: next };
    }
  }
  return { skip: 'span_not_found' };
}

// ── Round 2 (--round=2): WHOLE verse blocks only. Round 1's gate failed 3 of 20 on slices of a block (a prose lead-in
// inside it, or a block that reorders the verse across lines). A page is refused unless all of these hold:
//   - the span occurs exactly once on the page, and its Tibetan run IS the span (no further pādas of the same metre);
//   - the run aligns to an English block of exactly one line per pāda, and that whole block is the text graded;
//   - the first line is verse, not prose (no lead-in colon, no "says/then/thus…" opener, no "said:" tail);
//   - the block's first and last lines each resemble the reference's first and last line better than any other
//     reference line, so the block starts and ends where the verse does (not reordered across lines).
const PROSE_LEAD = /:\s*["”’'*_]*\s*(?:<-)?\s*$|^\s*(?:>\s*)?(?:->)?["“‘'*_]*\s*(?:then|thus|therefore|as it is said|it is said|this is|that is|here|accordingly|the (?:teacher|master|text|sutra|tantra|verse)|in the)\b|\b(?:says|said|states|stated|declares|declared|explains|reads|recite|recites|as follows)\b/i;
function splice2(en, page, item) {
  const runs = verseRuns(page.ocr?.data || ''); const blocks = verseBlocks(en); const al = alignRunsToBlocks(runs, blocks);
  const want = item.span_padas.join(' / '), n = item.span_padas.length;
  const hits = [];
  runs.forEach((run, ri) => { for (let i0 = 0; i0 + n <= run.padas.length; i0++) if (run.padas.slice(i0, i0 + n).join(' / ') === want) hits.push({ ri, i0 }); });
  if (!hits.length) return { skip: 'span_not_found' };
  if (hits.length > 1) return { skip: 'span_twice_on_page' };
  const { ri } = hits[0];
  if (runs[ri].padas.length !== n) return { skip: 'run_longer_than_verse' };
  if (!al.has(ri)) return { skip: 'no_aligned_block' };
  const bl = blocks[al.get(ri)];
  if (bl.lines.length !== n) return { skip: 'block_line_count', block: en.slice(bl.a, bl.b), graded: item.stored_lines };
  const whole = en.slice(bl.a, bl.b);
  if (whole !== item.stored_lines) return { skip: 'block_is_not_graded_text' };
  if (/<note\b/.test(whole)) return { skip: 'note_in_block' };
  if (bl.lines.some((ln) => PROSE_LEAD.test(ln.text.replace(/<[^>]+>/g, '')))) return { skip: 'prose_line_in_block' };
  const best = (k) => { const s = item.reference.map((r) => dice(normEn(bl.lines[k].text), normEn(r))); return s.indexOf(Math.max(...s)); };
  if (best(0) !== 0 || best(n - 1) !== n - 1) return { skip: 'start_end_not_aligned' };
  const next = bl.lines.map((ln, k) => (ln.text.match(PREFIX)[1] + item.reference[k] + (ln.text.match(SUFFIX)[1] || ''))).join('\n');
  return { text: en.slice(0, bl.a) + next + en.slice(bl.b), before: whole, after: next };
}

const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const openRun = async (bookId) => !!(await db.collection('translate_batch_runs').findOne({ book_id: bookId, phase: { $nin: ['complete', 'parked', 'failed'] } }, { projection: { _id: 1 } }));
const out = { apply: APPLY, verses: verdicts.length, verses_pass: verdicts.filter((x) => x.pass).length, candidates: plan.length, written: 0, skipped: {}, items: [] };
const touched = [];
// Several verses can sit on one page: apply them in sequence on the page's current text.
const byPage = new Map(); for (const it of plan) { const k = `${it.book_id}:${it.page_number}`; (byPage.get(k) || byPage.set(k, []).get(k)).push(it); }
for (const [k, items] of byPage) {
  const [bookId, pn] = k.split(':');
  const page = await db.collection('pages').findOne({ book_id: bookId, page_number: Number(pn) }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, translation: 1, 'ocr.data': 1 } });
  if (LIMIT && !LIMIT.has(page.id)) continue;
  if (EXCLUDE?.has(page.id)) { out.skipped.round1_gate_page = (out.skipped.round1_gate_page || 0) + items.length; continue; }
  const skip = (why, it) => { out.skipped[why] = (out.skipped[why] || 0) + 1; out.items.push({ page_id: page.id, page_url: it.page_url, vid: it.vid, status: 'skipped', why }); };
  if (isHumanEditedTranslation(page.translation)) { items.forEach((it) => skip('human_edited', it)); continue; }
  if (await openRun(bookId)) { items.forEach((it) => skip('open_translate_run', it)); continue; }
  let text = page.translation.data; const done = [];
  for (const it of items) {
    const s = (ROUND === 2 ? splice2 : splice)(text, page, it);
    if (s.skip) { skip(s.skip, it); if (s.block) Object.assign(out.items[out.items.length - 1], { block: s.block, graded_text: s.graded }); continue; }
    text = s.text; done.push({ it, before: s.before, after: s.after });
  }
  if (!done.length) continue;
  const reason = `verse memory (#6141${ROUND === 2 ? ' round 2' : ''}): ${done.map(({ it }) => `${it.vid} ref ${it.ref_hash}`).join(', ')} — ${ROUND === 2 ? 'whole verse block only' : 'verse lines only'}, reference drafted and blind-checked by Claude Opus subagents; stored lines graded weak/wrong by both readers`;
  const r = await repairTranslationText(db, page, text, { expectBefore: page.translation.data, source: SOURCE, reason, issue: ISSUE, jobId: JOB, apply: APPLY });
  for (const { it, before, after } of done) out.items.push({ page_id: page.id, page_url: it.page_url, vid: it.vid, ref_hash: it.ref_hash, status: r.status, why: r.why, graded: it.graded, before, after, before_hash: r.before_hash, after_hash: r.after_hash });
  if (r.status === 'written') { out.written++; touched.push(page.id); }
}
if (APPLY && touched.length) out.resync = await resyncMirrors(db, touched);
await c.close();
out.verdicts = verdicts;
fs.writeFileSync(path.join(outDir, APPLY ? 'applied.json' : 'proposals.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ apply: APPLY, verses: out.verses, verses_pass: out.verses_pass, candidates: out.candidates, proposed: out.items.filter((x) => x.status !== 'skipped').length, written: out.written, skipped: out.skipped }));
