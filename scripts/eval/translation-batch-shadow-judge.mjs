#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-continuity-ab.mjs --judge-packet — the blinded
// junction packet this copies (seeded flips, key kept apart from the packet, LEFT/RIGHT/TIE
// question). It does not fit as-is because its arms share one block k-1 (only the seam page
// varies) and live in the harness's own result files; here the two lanes differ on EVERY page
// and live in `translate_batch_runs` (shadow) and `pages.translation` (production), so the
// junction has to be shown as a two-page excerpt from each lane. `readerText` and `similarity`
// are IMPORTED from it, not copied. Also checked: scripts/eval/translation-prompt-ab.mjs (single
// page, note-verification estimand) and scripts/eval/reverify-batch.mjs (OCR, not translation).
/**
 * translation-batch-shadow-judge — #4681 steps 3–4: does the Batch API lane with a seam repair
 * (PR #5000) read as production at the page break, on real books, with the judge's own noise
 * floor measured in the same packet?
 *
 * Three arms per book, all on the same untranslated pages:
 *   S1  first  shadow run of scripts/workers/translate-batch-worker.mjs --shadow  (drafts + repairs)
 *   S2  second shadow run, same lane, same day                                     (the A/A replicate)
 *   P   production: the realtime translate-worker's text on `pages.translation.data`
 *
 * Two pair types, interleaved and blinded in ONE packet so the judge cannot tell them apart:
 *   S1/P   the test — a production share near 50% means the lane ties production
 *   S1/S2  the noise floor — the same lane twice; its split and tie rate are what "50%" and
 *          "tie" mean for THIS judge on THESE texts (lesson_run_the_noise_floor_arm_first,
 *          lesson_a_judge_that_cannot_say_tie_reports_its_own_noise). Read this row first.
 *
 * A junction is shown as the END of the page before the seam and the START of the seam page, from
 * one lane, so the judge sees exactly what a reader turning the page sees. Seam pages of S1/S2
 * carry the repaired text when the run chose it (run.seam_outcomes), the draft otherwise.
 *
 *   --packet --books=id1,id2,id3   FREE  build the blinded packet + key, print body-page similarity
 *   --score                        FREE  read the verdicts, report per pair type
 *
 *   --midflow   (with --packet) keep only junctions where a sentence can actually cross the break:
 *               the seam passes `assessSeam` on the OCR (≥400 chars of prose both sides, no
 *               terminator, no heading) — decided from the SOURCE, so it is the same for every arm
 *               and the blinding holds. A seam is also dropped, for EVERY pair, when any lane's
 *               half is under 120 chars of prose (a degenerate junction the judge cannot read);
 *               those drops are counted per lane in the key's `skipped`, since that one IS arm-side.
 *   --tag=NAME  file-name stem for packet/key/verdicts/report (default translation-batch-shadow),
 *               so a second book set never overwrites a judged key.
 *
 * NOTHING here writes to `pages` or spends. Files land in scripts/eval/results/.
 *
 *   node --env-file=.env.production.local scripts/eval/translation-batch-shadow-judge.mjs --packet --books=...
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { readerText, similarity, assessSeam } from './translation-batch-continuity-ab.mjs';
import { resetSeed, seededRand, binomTwoSided } from './lib/paired-stats.mjs';
import { RUNS_COLLECTION, SEAM_SOURCE_REPAIR, chooseSeamText } from '../lib/translate-batch-seam.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? null;
const has = (n) => args.includes(`--${n}`);
/** --field=NAME: score this verdict field instead of `verdict` (the fidelity packet returns `fidelity` and `fluency`). */
const FIELD = arg('field') || 'verdict';

const RESULTS = new URL('./results/', import.meta.url).pathname;
const TAG = arg('tag') || 'translation-batch-shadow';
const PACKET_FILE = path.join(RESULTS, `${TAG}-judge-packet.jsonl`);
const KEY_FILE = path.join(RESULTS, `${TAG}-judge-key.json`);
const VERDICTS_FILE = path.join(RESULTS, `${TAG}-judge-verdicts.json`);
const BODY_FILE = path.join(RESULTS, `${TAG}-body-similarity.json`);
/** Characters of each page shown at the junction — enough for the sentence that crosses it. */
const EXCERPT = 1200;
/** The seed is fixed and the packet is built ONCE per book set; rebuilding after judging moves every flip. */
const SEED = 0x5eed ^ 0x4681;
/** --midflow: a junction half shorter than this (reader text) is degenerate — nothing to carry across. */
const MIN_HALF = 120;

const tail = (t) => (t.length > EXCERPT ? '…' + t.slice(-EXCERPT) : t);
const head = (t) => (t.length > EXCERPT ? t.slice(0, EXCERPT) + '…' : t);
const junction = (prev, seam) => `${tail(readerText(prev))}\n\n———— page break ————\n\n${head(readerText(seam))}`;

/**
 * The text a lane put on a page: for a shadow run, the repair when the run chose it, else the draft.
 * The worker records the choice as `source: 'repair'` (translate-batch-seam.mjs chooseSeamText). Until
 * 2026-09-25 this matched the literal 'repaired', which no outcome ever carries, so BOTH judged draws
 * (#5020 first shadow, #5053 decisive) showed the judges the plain DRAFT on every seam page while the key
 * labelled it "repaired". A matcher pinned to a literal passes vacuously — so this now asserts that a run
 * with repairs substituted at least one, instead of silently judging the wrong arm.
 */
function laneTexts(run) {
  const drafts = new Map((run.drafts || []).map((d) => [d.id, d.text]));
  const repairs = new Map((run.repairs || []).map((r) => [r.id, r.text]));
  const chosen = new Map((run.seam_outcomes || []).map((o) => [o.id, o.source]));
  const out = new Map(drafts);
  let substituted = 0;
  for (const [id, source] of chosen) if (source === SEAM_SOURCE_REPAIR && repairs.has(id)) { out.set(id, repairs.get(id)); substituted++; }
  if (repairs.size && !substituted) throw new Error(`${run.id}: run has ${repairs.size} repairs but no seam_outcome chose one — outcome vocabulary drifted from '${SEAM_SOURCE_REPAIR}'?`);
  return out;
}

/**
 * The two shadow runs that stand for the lane. The Batch API cancels whole repair jobs at random
 * (2026-09-24: 2 of 3), and a run with drafts but no repairs is PLAIN batch (arm B), not the
 * seam-repair design (arm E) — so runs with repairs are preferred, and the key records whether
 * S1 was repaired so --score can keep "repaired lane vs production" apart from "plain batch vs
 * production". A book with only one usable run gets no A/A pairs.
 */
async function loadBook(db, bookId) {
  const runs = (await db.collection(RUNS_COLLECTION)
    .find({ book_id: bookId, shadow: true, phase: 'shadow_complete' }).sort({ created_at: 1 }).toArray())
    .filter((r) => (r.drafts || []).length > 0);
  if (!runs.length) throw new Error(`${bookId}: no shadow_complete run with drafts`);
  const repaired = runs.filter((r) => (r.repairs || []).length > 0);
  const r1 = repaired[0] ?? runs[0];
  const r2 = repaired.find((r) => r !== r1) ?? null;
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, language: 1 } });
  const ids = r1.blocks.flatMap((b) => b.pages.map((p) => p.id));
  const pages = await db.collection('pages')
    .find({ id: { $in: ids } }, { projection: { id: 1, page_number: 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1 } }).toArray();
  const prod = new Map(pages.filter((p) => p.translation?.data).map((p) => [p.id, p.translation.data]));
  console.log(`${bookId}: S1 ${r1.id} (${r1.drafts.length} drafts, ${(r1.repairs || []).length} repairs)${r2 ? `, S2 ${r2.id} (${r2.drafts.length} drafts, ${(r2.repairs || []).length} repairs)` : ', no S2 — no A/A pairs for this book'}, production text on ${prod.size}/${ids.length} pages`);
  // --regate: re-choose repair vs draft with the CURRENT chooseSeamText (its gates, #5085) instead of
  // the seam_outcomes the run stored when it ran. The stored choice predates the gates.
  if (has('regate')) {
    for (const r of [r1, r2].filter(Boolean)) {
      const drafts = new Map((r.drafts || []).map((d) => [d.id, d.text]));
      const repIds = (r.repairs || []).map((x) => x.id);
      const ocrs = new Map((await db.collection('pages').find({ id: { $in: repIds } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p.ocr?.data]));
      r.seam_outcomes = (r.repairs || []).map((x) => { const ch = chooseSeamText({ ocr: ocrs.get(x.id), draft: drafts.get(x.id), repaired: x.text }); return { id: x.id, source: ch.source, reason: ch.reason }; });
      r.regated = r.seam_outcomes.filter((o) => o.source !== SEAM_SOURCE_REPAIR).map((o) => `${o.id}:${o.reason}`);
      if (r.regated.length) console.log(`  ${r.id}: regate kept the draft on ${r.regated.join(', ')}`);
    }
  }
  return { book, r1, r2, s1: laneTexts(r1), s2: r2 ? laneTexts(r2) : new Map(), prod, ids, s1Repaired: (r1.repairs || []).length > 0 };
}

// ── --packet ────────────────────────────────────────────────────────────────
async function buildPacket(db, bookIds, { midflow = false } = {}) {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists — a rebuilt packet invalidates judged verdicts; move it aside deliberately`);
  resetSeed(SEED);
  const entries = [], key = [], body = [], skipped = [];
  for (const bookId of bookIds) {
    const { book, r1, r2, s1, s2, prod, ids, s1Repaired } = await loadBook(db, bookId);
    const seamIds = new Set((r1.seams || []).map((s) => s.seamId));
    const ocr = midflow ? new Map((await db.collection('pages')
      .find({ id: { $in: (r1.seams || []).flatMap((s) => [s.prevId, s.seamId]) } }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } })
      .toArray()).map((p) => [p.id, p])) : null;
    for (const { prevId, seamId } of r1.seams || []) {
      const lanes = { S1: [s1.get(prevId), s1.get(seamId)], S2: [s2.get(prevId), s2.get(seamId)], P: [prod.get(prevId), prod.get(seamId)] };
      if (midflow) {
        const seam = assessSeam(ocr.get(prevId), ocr.get(seamId));
        if (!seam.ok) { skipped.push({ bookId, seamId, pair: '*', reason: `not mid-flow: ${seam.reason}` }); continue; }
        const short = Object.entries(lanes).filter(([lane, ts]) => (lane !== 'S2' || r2) && ts.some((t) => t && readerText(t).trim().length < MIN_HALF)).map(([lane]) => lane);
        if (short.length) { skipped.push({ bookId, seamId, pair: '*', reason: `degenerate half (<${MIN_HALF} chars) in ${short.join(',')}` }); continue; }
      }
      for (const pair of r2 ? ['S1/P', 'S1/S2'] : ['S1/P']) {
        const [x, y] = pair.split('/');
        if (!lanes[x].every(Boolean) || !lanes[y].every(Boolean)) { skipped.push({ bookId, seamId, pair, reason: `missing text in ${!lanes[x].every(Boolean) ? x : y}` }); continue; }
        const flip = seededRand() < 0.5;
        const jx = junction(...lanes[x]), jy = junction(...lanes[y]);
        // Ids are assigned AFTER the shuffle and carry nothing: a book, seam or pair-type in the
        // id would let a judge tell the A/A controls from the test pairs.
        const entry = { id: null, language: book.language, left: flip ? jy : jx, right: flip ? jx : jy };
        // --with-source: the OCR of the same two pages, arm-independent (blinding intact), so a judge can
        // check FIDELITY across the break — a junction judge without it sees only fluency and rewarded an
        // omission (j009) and two fabricated bridges (j040, j033).
        if (has('with-source') && ocr) entry.source = `${tail(readerText(ocr.get(prevId)?.ocr?.data || ''))}\n\n———— page break ————\n\n${head(readerText(ocr.get(seamId)?.ocr?.data || ''))}`;
        entries.push(entry);
        // Completeness, per side of the seam page: a junction judge sees fluency, not omission (2026-09-25,
        // j009 — the draft dropped p.65's first sentence and WON). Reader-text length of each lane's seam
        // page against the OCR; --score flags a side ≥15% shorter than the other for a hand read.
        const seamLen = Object.fromEntries([x, y].map((l) => [l, readerText(lanes[l][1]).length]));
        if (ocr) seamLen.ocr = String(ocr.get(seamId)?.ocr?.data || '').length;
        key.push({ id: null, entry, book_id: bookId, seam_id: seamId, pair, s1_repaired: s1Repaired, left: flip ? y : x, right: flip ? x : y, seam_len: seamLen });
      }
    }
    // Body pages (never repaired, never seeded): the lane should be indistinguishable from itself
    // and from production here. Wording similarity is a check on that, not a verdict.
    for (const id of ids) {
      if (seamIds.has(id)) continue;
      const a = s1.get(id), b = s2.get(id), p = prod.get(id);
      body.push({ book_id: bookId, page_id: id, s1_s2: a && b ? similarity(a, b) : null, s1_p: a && p ? similarity(a, p) : null, len_s1_over_p: a && p ? +(readerText(a).length / Math.max(1, readerText(p).length)).toFixed(3) : null });
    }
  }
  // Shuffle so pair types and books interleave, then number: the judge sees only `j001…`.
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
  entries.forEach((e, i) => { e.id = `j${String(i + 1).padStart(3, '0')}`; });
  for (const k of key) { k.id = k.entry.id; delete k.entry; }
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(PACKET_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(KEY_FILE, JSON.stringify({ seed: SEED, books: bookIds, midflow, skipped, key }, null, 1));
  fs.writeFileSync(BODY_FILE, JSON.stringify(body, null, 1));
  const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  console.log(`wrote ${entries.length} blinded junctions to ${PACKET_FILE} (${key.filter((k) => k.pair === 'S1/P').length} S1/P, ${key.filter((k) => k.pair === 'S1/S2').length} S1/S2; ${skipped.length} skipped)`);
  console.log(`key (do NOT give this to the judge): ${KEY_FILE}`);
  console.log(`body pages: ${body.length}; median similarity S1~S2 ${med(body.map((b) => b.s1_s2))?.toFixed(3)}, S1~P ${med(body.map((b) => b.s1_p))?.toFixed(3)}, median length ratio S1/P ${med(body.map((b) => b.len_s1_over_p))}`);
  for (const s of skipped) console.log('  skipped', JSON.stringify(s));
  console.log('\nJudge question, per junction:');
  console.log('  "LEFT and RIGHT each show the end of one page and the start of the next, from two translations');
  console.log('   of the same original. Which reads as ONE translator continuing across the page break — a');
  console.log('   sentence carried across picked up correctly, same names, same terms, same register?');
  console.log('   Answer LEFT, RIGHT or TIE, then one sentence of why. TIE is a real answer."');
  console.log(`Verdicts go to ${VERDICTS_FILE} as [{ id, verdict, why }].`);
}

// ── --score ─────────────────────────────────────────────────────────────────
function score() {
  const { key } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const byId = new Map(key.map((k) => [k.id, k]));
  const verdicts = JSON.parse(fs.readFileSync(VERDICTS_FILE, 'utf8'));
  const unknown = verdicts.filter((v) => !byId.has(v.id));
  if (unknown.length) console.log(`WARNING: ${unknown.length} verdict ids not in the key (ignored): ${unknown.map((u) => u.id).join(', ')}`);
  const report = {};
  // Three rows: the A/A floor, the design (repaired lane vs production), and the control that
  // #4912 already measured (plain batch vs production, expected to lose at the seam).
  const ROWS = { 'S1/S2': (k) => k.pair === 'S1/S2', 'S1/P': (k) => k.pair === 'S1/P' && k.s1_repaired !== false, 'S1/P (unrepaired, plain batch)': (k) => k.pair === 'S1/P' && k.s1_repaired === false };
  for (const [label, sel] of Object.entries(ROWS)) {
    const pair = label.split(' ')[0];
    const [x, y] = pair.split('/');
    const rows = verdicts.filter((v) => byId.has(v.id) && sel(byId.get(v.id)));
    if (!rows.length && !key.some(sel)) continue;
    const wins = { [x]: 0, [y]: 0 }; let ties = 0, left = 0;
    for (const v of rows) {
      const side = String(v[FIELD]).trim().toUpperCase();
      if (side !== 'LEFT' && side !== 'RIGHT') { ties++; continue; }
      if (side === 'LEFT') left++;
      wins[byId.get(v.id)[side.toLowerCase()]]++;
    }
    const decided = wins[x] + wins[y];
    report[label] = {
      judged: rows.length, expected: key.filter(sel).length, ties, tie_rate: rows.length ? +(ties / rows.length).toFixed(3) : null,
      wins, decided, [`${y}_share_of_decided`]: decided ? +(wins[y] / decided).toFixed(3) : null,
      split_p_two_sided: decided ? +binomTwoSided(Math.min(wins[x], wins[y]), decided).toFixed(3) : null,
      left_share_of_decided: decided ? +(left / decided).toFixed(3) : null,
    };
  }
  const floor = report['S1/S2'], test = report['S1/P'], control = report['S1/P (unrepaired, plain batch)'];
  console.log(JSON.stringify(report, null, 1));
  console.log('\nRead the noise floor first:');
  if (floor) console.log(`  S1/S2 (same lane twice): tie rate ${floor.tie_rate}, split ${floor.wins.S1}–${floor.wins.S2} (p=${floor.split_p_two_sided}), LEFT picked ${floor.left_share_of_decided} of decided`);
  else console.log('  S1/S2: no A/A pairs judged — no noise floor; do not quote a non-inferiority number');
  if (test) console.log(`  S1/P  (repaired lane vs production): tie rate ${test.tie_rate}, production preferred ${test.wins.P}, lane ${test.wins.S1} (p=${test.split_p_two_sided}); production share of decided ${test.P_share_of_decided} (the #4912 limit was 60%)`);
  if (control) console.log(`  S1/P  (UNREPAIRED lane = plain batch, control): production preferred ${control.wins.P}, lane ${control.wins.S1}, ties ${control.ties}; production share ${control.P_share_of_decided} (#4912 measured 41–11 for this pair)`);
  const vById = new Map(verdicts.map((v) => [v.id, v]));
  const suspects = key.filter((k) => k.pair === 'S1/P' && k.seam_len && Math.min(k.seam_len.S1, k.seam_len.P) < 0.85 * Math.max(k.seam_len.S1, k.seam_len.P));
  if (suspects.length) {
    console.log(`\n  OMISSION-SUSPECT (one side's seam page ≥15% shorter — hand-read against the source before trusting the verdict):`);
    for (const k of suspects) { const v = vById.get(k.id); const w = !v || v[FIELD] === 'TIE' ? 'TIE' : v[FIELD] === 'LEFT' ? k.left : k.right; console.log(`    ${k.id} S1 ${k.seam_len.S1} / P ${k.seam_len.P} chars (ocr ${k.seam_len.ocr ?? '?'}) → judged ${w}${w !== 'TIE' && k.seam_len[w] < k.seam_len[w === 'S1' ? 'P' : 'S1'] ? '  ← SHORTER SIDE WON' : ''}`); }
  }
  const verdict = !test || test.P_share_of_decided == null ? 'no decided verdicts for the repaired lane'
    : !floor ? 'repaired lane judged, but no A/A floor — result is unquotable until an S2 exists'
      : test.P_share_of_decided <= 0.6 ? 'lane holds against production at the seam (production share ≤ 60%), read against the A/A row above'
        : 'production preferred beyond the 60% limit — do not flip';
  console.log(`\n${verdict}`);
  fs.writeFileSync(path.join(RESULTS, `${TAG}-report-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ report, verdict }, null, 1));
}

// ── main ────────────────────────────────────────────────────────────────────
if (has('score')) {
  score();
} else if (has('packet')) {
  const books = String(arg('books') || '').split(',').filter(Boolean);
  if (!books.length) { console.error('--packet needs --books=id1,id2,...'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  try { await client.connect(); await buildPacket(client.db('bookstore'), books, { midflow: has('midflow') }); } finally { await client.close(); }
} else {
  console.log('one of --packet --books=... | --score (see the header)');
}
