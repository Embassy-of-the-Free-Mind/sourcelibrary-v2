#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-continuity-ab.mjs — the arm runner this follows (raw
// Gemini caller `gemini` and `pool` imported from translation-prompt-ab.mjs, `readerText` imported
// from it, --approved-usd refusal, resumable jsonl rows). It does not fit as-is: its unit is an
// 8-page BLOCK under three seed shapes, its sample is its own draw, and its prompt is the worker's
// block prompt; here the unit is one SEAM (two single-page prompts, chained), the sample is the 63
// S1/P seams of the fidelity judge key, and the treatment is buildTranslationPrompt's pageBreak
// option. scripts/eval/translation-batch-shadow-judge.mjs — the blinded source-carrying packet
// this copies (seeded flips, key apart from the packet, `--with-source` junction); it reads lanes
// from translate_batch_runs and pages, not from arm rows on disk. Also checked: translation-model-ab
// (model arms), translation-prompt-ab (prompt-version arms, single page, note-verification estimand).
/**
 * translation-page-break-fix-ab — does the page-break fix (#5103) make the translation more
 * FAITHFUL across the break, measured against its own noise floor?
 *
 * Three arms, each translating BOTH pages of each seam with the realtime single-page prompt on the
 * production model, page N seeded with the stored translation of N-1, page N+1 seeded with the
 * arm's own fresh translation of N (the worker's chain):
 *
 *   B    the current production prompt, run now
 *   B2   B again — the A/A noise floor of the judge on these texts
 *   F    B + buildTranslationPrompt({ pageBreak: PAGE_BREAK_FIX }): split-word join, catchword mark,
 *        next-page lookahead, one rule line
 *
 * Seams: the 63 S1/P junctions of scripts/eval/results/translation-batch-seam-fidelity-judge-key.json
 * (9 books, de/la, mid-flow by the source), prevId from translate_batch_runs.seams. Nothing here
 * writes to `pages`; the only writes are files under scripts/eval/results/ and gemini_usage rows
 * (endpoint eval/translation-page-break-fix, book_id set) so the spend is attributable.
 *
 *   --draw                 FREE   fetch the seam pages, classify each break, estimate the cost
 *   --run --approved-usd X PAID   the arms (resumable; refuses without approval ≥ estimate, cap $3)
 *   --packet               FREE   blinded F/B and B/B2 junction pairs with the source, 8 judge chunks
 *   --score                FREE   verdicts → fidelity tallies, defects by type, the device subset
 *
 * Run --run on Hetzner (paid Gemini is geo-blocked on the laptop):
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/translation-page-break-fix-ab.mjs --run --approved-usd 3
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  loadTranslationPrompts, buildTranslationPrompt, sanitizeTranslationTags, getTranslateModelForBook, PAGE_BREAK_FIX,
} from '../lib/translate-core.mjs';
import { resolvePageBreak } from '../lib/page-break-devices.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { logUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { connect, disconnect } from './lib/sampling.mjs';
import { resetSeed, seededRand, binomTwoSided } from './lib/paired-stats.mjs';
import { gemini, pool } from './translation-prompt-ab.mjs';
import { readerText } from './translation-batch-continuity-ab.mjs';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const TAG = 'translation-page-break-fix';
const SOURCE_KEY = path.join(RESULTS, 'translation-batch-seam-fidelity-judge-key.json');
const SAMPLE_FILE = path.join(RESULTS, `${TAG}-sample.json`);
const ARMS_FILE = path.join(RESULTS, `${TAG}-arms.jsonl`);
const PACKET_FILE = path.join(RESULTS, `${TAG}-judge-packet.jsonl`);
const KEY_FILE = path.join(RESULTS, `${TAG}-judge-key.json`);
const VERDICTS_GLOB = `${TAG}-judge-verdicts`;
const ENDPOINT = 'eval/translation-page-break-fix';
const CEILING_USD = 3;                       // Derek, 2026-09-25: cap $3
const ARMS = String(arg('arms', 'B,B2,F')).split(',');
const CONCURRENCY = Number(arg('concurrency', 4));
const JUDGES = 8;
const EXCERPT = 1200;                        // as the fidelity judge saw it (shadow-judge EXCERPT)
const SEED = 0x5103;

const tail = (t) => (t.length > EXCERPT ? '…' + t.slice(-EXCERPT) : t);
const head = (t) => (t.length > EXCERPT ? t.slice(0, EXCERPT) + '…' : t);
const junction = (prev, seam) => `${tail(readerText(prev))}\n\n———— page break ————\n\n${head(readerText(seam))}`;
const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);

// ── --draw ──────────────────────────────────────────────────────────────────
async function phaseDraw() {
  const key = JSON.parse(fs.readFileSync(SOURCE_KEY, 'utf8'));
  const rows = key.key.filter((k) => k.pair === 'S1/P');
  const { db } = await connect();
  const sample = [];
  for (const bookId of key.books) {
    const runs = await db.collection('translate_batch_runs').find({ book_id: bookId, shadow: true, phase: 'shadow_complete' }).sort({ created_at: 1 }).toArray();
    const prevOf = new Map();
    for (const r of runs) for (const s of r.seams || []) if (!prevOf.has(s.seamId)) prevOf.set(s.seamId, s.prevId);
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, language: 1, 'image_source.provider': 1 } });
    for (const k of rows.filter((k) => k.book_id === bookId)) {
      const prevId = prevOf.get(k.seam_id);
      if (!prevId) throw new Error(`${k.id}: no prevId in translate_batch_runs.seams for ${k.seam_id}`);
      const [N, X] = await Promise.all([prevId, k.seam_id].map((id) => db.collection('pages').findOne({ id }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1 } })));
      if (!N?.ocr?.data || !X?.ocr?.data) throw new Error(`${k.id}: seam page without OCR`);
      const before = await db.collection('pages').findOne({ book_id: bookId, page_number: N.page_number - 1 }, { projection: { id: 1, 'translation.data': 1, 'ocr.data': 1 } });
      const after = await db.collection('pages').findOne({ book_id: bookId, page_number: X.page_number + 1 }, { projection: { id: 1, 'ocr.data': 1, page_type: 1 } });
      const brk = resolvePageBreak(N.ocr.data, X.ocr.data);
      sample.push({
        id: k.id, bookId, language: book.language, provider: book.image_source?.provider || null,
        book: { id: book.id, title: book.title, display_title: book.display_title, author: book.author, published: book.published, year: book.year, language: book.language, image_source: book.image_source },
        model: getTranslateModelForBook(book),
        seedTranslation: typeof before?.translation?.data === 'string' ? before.translation.data : null,
        N: { id: N.id, page_number: N.page_number, ocr: N.ocr.data },
        X: { id: X.id, page_number: X.page_number, ocr: X.ocr.data },
        after: after?.ocr?.data ? { id: after.id, ocr: after.ocr.data, page_type: after.page_type || null } : null,
        break: { kind: brk.kind, catchword: brk.catchword, joined: brk.joined, removedFromN: brk.removedFromN, removedFromNext: brk.removedFromNext },
        device: brk.kind != null || brk.catchword != null,
      });
    }
  }
  await disconnect();
  const est = estimate(sample);
  const kinds = {};
  for (const s of sample) kinds[String(s.break.kind)] = (kinds[String(s.break.kind)] || 0) + 1;
  fs.writeFileSync(SAMPLE_FILE, JSON.stringify({ drawn_at: new Date().toISOString(), arms: ARMS, n: sample.length, device_seams: sample.filter((s) => s.device).length, kinds, estimate: est, sample }, null, 1));
  console.log(`n = ${sample.length} seams; ${sample.filter((s) => s.device).length} carry a device (kinds ${JSON.stringify(kinds)}); ${sample.filter((s) => !s.seedTranslation).length} without a stored seed; ${sample.filter((s) => !s.after).length} without a page after the seam`);
  console.log(`ESTIMATE: ${est.calls} calls, in ~${est.inputTokens.toLocaleString()} tok, out ~${est.outputTokens.toLocaleString()} tok = $${est.usd.toFixed(2)} (cap $${CEILING_USD})`);
  console.log(`wrote ${SAMPLE_FILE}\nPAID STEP NOT RUN.`);
}

/** Two single-page calls per seam per arm; the header is ~7,300 chars, the seed ≤ 2,000, a lookahead ≤ 400. */
function estimate(sample, headerChars = 7600) {
  let inputTokens = 0, outputTokens = 0, usd = 0;
  for (const s of sample) {
    const price = priceFor(s.model);
    for (const arm of ARMS) {
      const extra = arm === 'F' ? 900 : 0;
      const inTok = Math.ceil((headerChars + s.N.ocr.length + 2000 + extra) / 4) + Math.ceil((headerChars + s.X.ocr.length + 2000 + extra) / 4);
      const outTok = Math.ceil((s.N.ocr.length + s.X.ocr.length) * 0.35);
      inputTokens += inTok; outputTokens += outTok;
      usd += (inTok / 1e6) * price.input + (outTok / 1e6) * price.output;
    }
  }
  return { calls: sample.length * ARMS.length * 2, inputTokens, outputTokens, usd };
}

// ── --run (PAID) ────────────────────────────────────────────────────────────
function readRows() {
  if (!fs.existsSync(ARMS_FILE)) return [];
  const rows = [];
  for (const line of fs.readFileSync(ARMS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn final line */ }
  }
  return rows;
}

const maxOutFor = (ocr) => Math.min(32768, Math.max(4096, Math.ceil(ocr.length) + 1200));

async function phaseRun() {
  const { sample } = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const est = estimate(sample);
  const approved = Number(arg('approved-usd', 0));
  if (!(approved >= est.usd) || approved > CEILING_USD || est.usd > CEILING_USD) {
    console.error(`REFUSING TO SPEND. Estimate $${est.usd.toFixed(2)}; --approved-usd is ${approved || 'absent'}; cap $${CEILING_USD}.`);
    process.exit(2);
  }
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  console.log(`prompt: ${prompts.translation.ref.name} v${prompts.translation.ref.version}; arms ${ARMS.join(',')}; ${sample.length} seams`);
  const done = new Map(readRows().map((r) => [`${r.id}:${r.arm}`, r]));
  let spent = [...done.values()].reduce((s, r) => s + (r.cost_usd || 0), 0);
  if (spent) console.log(`resuming: $${spent.toFixed(3)} already spent, ${done.size} seam-arms on disk`);
  const stream = fs.createWriteStream(ARMS_FILE, { flags: 'a' });

  /** One page call, with one retry when nothing came back. Logs usage; never touches `pages`. */
  const call = async (s, prompt, ocr) => {
    const price = priceFor(s.model);
    let res = await gemini(prompt, maxOutFor(ocr), s.model);
    let cost = res.error ? 0 : (res.inTok / 1e6) * price.input + (res.outTok / 1e6) * price.output;
    const t0 = Date.now();
    const log = (rr, c) => logUsage({
      type: 'translation', mode: 'realtime', model: s.model, book_id: s.bookId, page_count: 1,
      input_tokens: rr.inTok || 0, output_tokens: rr.outTok || 0, cost_usd: c,
      status: rr.error ? 'error' : 'success', error_message: rr.error || null, duration_ms: Date.now() - t0,
      prompt_version: `v${prompts.translation.ref.version}`, endpoint: ENDPOINT, triggered_by: 'manual',
    }, db).catch((e) => console.warn(`usage log failed: ${e.message}`));
    await log(res, cost);
    if ((!res.text || res.text.length < 20) && spent + cost < approved) {
      const res2 = await gemini(prompt, maxOutFor(ocr), s.model);
      const cost2 = res2.error ? 0 : (res2.inTok / 1e6) * price.input + (res2.outTok / 1e6) * price.output;
      await log(res2, cost2);
      cost += cost2;
      if ((res2.text || '').length > (res.text || '').length) res = res2;
    }
    spent += cost;
    return { text: sanitizeTranslationTags(res.text || ''), inTok: res.inTok || 0, outTok: res.outTok || 0, finish: res.finish || null, error: res.error || null, cost };
  };

  const jobs = [];
  for (const arm of ARMS) for (const s of sample) if (!done.has(`${s.id}:${arm}`)) jobs.push({ s, arm });
  console.log(`${jobs.length} seam-arms to run`);
  await pool(jobs, CONCURRENCY, async ({ s, arm }) => {
    if (spent >= approved) { console.log(`${s.id} ${arm}: skipped, spend reached $${approved}`); return; }
    const fix = arm === 'F' ? PAGE_BREAK_FIX : undefined;
    // Page N: seeded with the STORED translation of N-1 (the same for every arm); under F it gets the
    // devices at its foot and the next page's opening, but never a head edit — its seed was made
    // without the fix, so a fragment N-1 carried is not removed here.
    const pN = buildTranslationPrompt({ prompts, book: s.book, ocrText: s.N.ocr, previousTranslation: s.seedTranslation, nextOcrText: fix ? s.X.ocr : undefined, pageBreak: fix });
    const rN = await call(s, pN.prompt, s.N.ocr);
    // Page N+1: seeded with THIS arm's fresh translation of N; under F its head is edited against N's
    // OCR (the fragment N absorbed is gone) and its foot against the page after.
    const pX = buildTranslationPrompt({ prompts, book: s.book, ocrText: s.X.ocr, previousTranslation: rN.text || null, prevOcrText: fix ? s.N.ocr : undefined, nextOcrText: fix && s.after ? s.after.ocr : undefined, pageBreak: fix });
    const rX = rN.text ? await call(s, pX.prompt, s.X.ocr) : { text: '', error: 'page N failed', cost: 0, inTok: 0, outTok: 0, finish: null };
    const row = {
      id: s.id, arm, bookId: s.bookId, language: s.language, model: s.model, kind: s.break.kind, device: s.device,
      N: { id: s.N.id, text: rN.text, inTok: rN.inTok, outTok: rN.outTok, finish: rN.finish, error: rN.error, prompt_sha: sha(pN.prompt), pageBreak: pN.pageBreak },
      X: { id: s.X.id, text: rX.text, inTok: rX.inTok, outTok: rX.outTok, finish: rX.finish, error: rX.error, prompt_sha: sha(pX.prompt), pageBreak: pX.pageBreak },
      cost_usd: rN.cost + rX.cost, at: new Date().toISOString(),
    };
    stream.write(JSON.stringify(row) + '\n');
    console.log(`${s.id} ${arm.padEnd(2)} ${s.language.padEnd(6)} N ${String(rN.text.length).padStart(5)} X ${String(rX.text.length).padStart(5)} chars  $${row.cost_usd.toFixed(4)}  total $${spent.toFixed(3)}${rN.error || rX.error ? `  ERROR ${rN.error || rX.error}` : ''}`);
  });
  stream.end();
  await disconnect();
  const rows = readRows();
  console.log(`\n${rows.length} seam-arm rows on disk; spent $${spent.toFixed(3)} of $${approved} approved; ${rows.filter((r) => !r.N.text || !r.X.text).length} with a missing page`);
}

// ── --packet ────────────────────────────────────────────────────────────────
function phasePacket() {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists — a rebuilt packet invalidates judged verdicts; move it aside deliberately`);
  const { sample } = JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  const rows = readRows();
  const byKey = new Map(rows.map((r) => [`${r.id}:${r.arm}`, r]));
  resetSeed(SEED);
  const entries = [], key = [], skipped = [];
  for (const s of sample) {
    const arms = Object.fromEntries(ARMS.map((a) => [a, byKey.get(`${s.id}:${a}`)]));
    const usable = (a) => arms[a]?.N?.text && arms[a]?.X?.text && readerText(arms[a].N.text).trim().length >= 120 && readerText(arms[a].X.text).trim().length >= 120;
    for (const pair of ['F/B', 'B/B2']) {
      const [x, y] = pair.split('/');
      if (!usable(x) || !usable(y)) { skipped.push({ seam: s.id, pair, reason: `missing or degenerate text in ${!usable(x) ? x : y}` }); continue; }
      const flip = seededRand() < 0.5;
      const jx = junction(arms[x].N.text, arms[x].X.text), jy = junction(arms[y].N.text, arms[y].X.text);
      const entry = {
        id: null, language: s.language,
        // The OCR of the same two pages, UNEDITED — arm-independent, so the blinding holds and the
        // judge reads every arm against the same source.
        source: `${tail(readerText(s.N.ocr))}\n\n———— page break ————\n\n${head(readerText(s.X.ocr))}`,
        left: flip ? jy : jx, right: flip ? jx : jy,
      };
      entries.push(entry);
      key.push({ id: null, entry, seam: s.id, book_id: s.bookId, pair, kind: s.break.kind, device: s.device, catchword: s.break.catchword, joined: s.break.joined, left: flip ? y : x, right: flip ? x : y,
        seam_len: Object.fromEntries([x, y].map((a) => [a, readerText(arms[a].X.text).length])) });
    }
  }
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
  entries.forEach((e, i) => { e.id = `j${String(i + 1).padStart(3, '0')}`; });
  for (const k of key) { k.id = k.entry.id; delete k.entry; }
  fs.writeFileSync(PACKET_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(KEY_FILE, JSON.stringify({ seed: SEED, arms: ARMS, skipped, key }, null, 1));
  // Eight chunks, interleaved so every judge sees both pair types and every book.
  const per = Math.ceil(entries.length / JUDGES);
  for (let c = 0; c < JUDGES; c++) {
    const slice = entries.slice(c * per, (c + 1) * per);
    fs.writeFileSync(path.join(RESULTS, `${TAG}-judge-chunk-${c + 1}.jsonl`), slice.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  console.log(`wrote ${entries.length} blinded junctions (${key.filter((k) => k.pair === 'F/B').length} F/B, ${key.filter((k) => k.pair === 'B/B2').length} B/B2; ${skipped.length} skipped) in ${JUDGES} chunks of ≤${per}`);
  console.log(`key (do NOT give this to the judge): ${KEY_FILE}`);
  for (const s of skipped) console.log('  skipped', JSON.stringify(s));
}

// ── --score ─────────────────────────────────────────────────────────────────
function loadVerdicts() {
  const files = fs.readdirSync(RESULTS).filter((f) => f.startsWith(VERDICTS_GLOB) && f.endsWith('.json'));
  const out = [];
  for (const f of files) out.push(...JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')));
  return { verdicts: out, files };
}

function phaseScore() {
  const { key } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const byId = new Map(key.map((k) => [k.id, k]));
  const { verdicts, files } = loadVerdicts();
  const seen = new Set();
  const dup = verdicts.filter((v) => { if (seen.has(v.id)) return true; seen.add(v.id); return false; });
  if (dup.length) console.log(`WARNING: ${dup.length} duplicate verdict ids (first kept): ${dup.map((d) => d.id).join(', ')}`);
  const uniq = verdicts.filter((v, i) => verdicts.findIndex((w) => w.id === v.id) === i && byId.has(v.id));
  console.log(`${uniq.length} verdicts from ${files.length} files; key has ${key.length}`);
  const DEFECTS = ['OMISSION', 'ADDITION', 'MISTRANSLATION', 'UNTRANSLATED', 'DUPLICATION'];
  const report = {};
  const tally = (label, sel, field) => {
    const rows = uniq.filter((v) => sel(byId.get(v.id)));
    if (!rows.length) return null;
    const pair = byId.get(rows[0].id).pair;
    const [x, y] = pair.split('/');
    const wins = { [x]: 0, [y]: 0 }; let ties = 0, left = 0;
    const defects = { [x]: Object.fromEntries(DEFECTS.map((d) => [d, 0])), [y]: Object.fromEntries(DEFECTS.map((d) => [d, 0])) };
    const withDefect = { [x]: 0, [y]: 0 };
    for (const v of rows) {
      const k = byId.get(v.id);
      const side = String(v[field] || '').trim().toUpperCase();
      if (side === 'LEFT' || side === 'RIGHT') { wins[k[side.toLowerCase()]]++; if (side === 'LEFT') left++; } else ties++;
      for (const s of ['left', 'right']) {
        const arm = k[s];
        const ds = v[`${s}_defects`] || [];
        if (ds.length) withDefect[arm]++;
        for (const d of ds) { const t = String(d.type || '').toUpperCase(); if (DEFECTS.includes(t)) defects[arm][t]++; }
      }
    }
    const decided = wins[x] + wins[y];
    return { pair, judged: rows.length, expected: key.filter(sel).length, wins, ties, tie_rate: +(ties / rows.length).toFixed(3), decided,
      [`${x}_share_of_decided`]: decided ? +(wins[x] / decided).toFixed(3) : null, split_p_two_sided: decided ? +binomTwoSided(Math.min(wins[x], wins[y]), decided).toFixed(3) : null,
      left_share_of_decided: decided ? +(left / decided).toFixed(3) : null, defects, breaks_with_defect: withDefect };
  };
  for (const field of ['fidelity', 'fluency']) {
    report[field] = {
      'B/B2 (A/A floor)': tally('B/B2', (k) => k.pair === 'B/B2', field),
      'F/B all': tally('F/B', (k) => k.pair === 'F/B', field),
      'F/B device breaks (catchword or split word)': tally('F/B', (k) => k.pair === 'F/B' && k.device, field),
      'F/B plain breaks': tally('F/B', (k) => k.pair === 'F/B' && !k.device, field),
      'B/B2 device breaks': tally('B/B2', (k) => k.pair === 'B/B2' && k.device, field),
    };
  }
  console.log(JSON.stringify(report, null, 1));
  const f = report.fidelity;
  const floor = f['B/B2 (A/A floor)'], test = f['F/B all'], dev = f['F/B device breaks (catchword or split word)'];
  console.log('\nRead the noise floor first:');
  if (floor) console.log(`  B/B2  (same prompt twice): fidelity ${floor.wins.B}–${floor.wins.B2}, ties ${floor.ties} (tie rate ${floor.tie_rate}); breaks with ≥1 defect B ${floor.breaks_with_defect.B}/${floor.judged}, B2 ${floor.breaks_with_defect.B2}/${floor.judged}`);
  if (test) console.log(`  F/B   (fix vs production): fidelity F ${test.wins.F}, B ${test.wins.B}, ties ${test.ties} (p=${test.split_p_two_sided}); F share of decided ${test.F_share_of_decided}; breaks with ≥1 defect F ${test.breaks_with_defect.F}/${test.judged}, B ${test.breaks_with_defect.B}/${test.judged}`);
  if (dev) console.log(`  F/B   device breaks only: F ${dev.wins.F}, B ${dev.wins.B}, ties ${dev.ties}; defective F ${dev.breaks_with_defect.F}/${dev.judged}, B ${dev.breaks_with_defect.B}/${dev.judged}`);
  const vById = new Map(uniq.map((v) => [v.id, v]));
  const suspects = key.filter((k) => k.pair === 'F/B' && k.seam_len && Math.min(k.seam_len.F, k.seam_len.B) < 0.85 * Math.max(k.seam_len.F, k.seam_len.B));
  if (suspects.length) {
    console.log(`\n  OMISSION-SUSPECT (one side's seam page ≥15% shorter — hand-read before trusting):`);
    for (const k of suspects) { const v = vById.get(k.id); const w = !v || !/^(LEFT|RIGHT)$/i.test(v.fidelity || '') ? 'TIE' : v.fidelity.toUpperCase() === 'LEFT' ? k.left : k.right; console.log(`    ${k.id} F ${k.seam_len.F} / B ${k.seam_len.B} chars → ${w}`); }
  }
  fs.writeFileSync(path.join(RESULTS, `${TAG}-report-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(report, null, 1));
}

// ── main ────────────────────────────────────────────────────────────────────
if (has('draw')) await phaseDraw();
else if (has('run')) await phaseRun();
else if (has('packet')) phasePacket();
else if (has('score')) phaseScore();
else console.log('one of --draw | --run --approved-usd N | --packet | --score (see the header)');
