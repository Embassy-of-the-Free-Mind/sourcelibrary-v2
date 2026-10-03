#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/apply-greek-relabel.mjs, relabel-bilingual-edition.mjs —
 * both relabel LANGUAGE fields, not folio labels. scripts/eval/folio-markers-5678.mjs reads
 * folio markers out of OCR text, and these pages have no OCR. scripts/import/bdrc-scans-import.mjs
 * wrote the labels being measured here; it has no check against the printed folio. Nothing
 * reads a printed margin from the image.
 *
 * mongol-folio-labels-5664 — measure and correct BDRC's folio labels on the Mongolian Kanjur
 * (#5664, acquisition_campaign `mongol-5664`, 108 volumes).
 *
 * `page_label` on these pages is BDRC's canvas label ("f. 286a"). In vol 89 it runs two
 * leaves ahead of the printed leaf after some point (QA comment on #5664, 2026-10-03). The
 * printed folio is in the right-hand margin of every leaf, in vertical Chinese:
 * <section>經第<N>卷<上|下><folio in Chinese numerals>. 上 = recto (a), 下 = verso (b).
 *
 * Method: crop the right-hand margin of the R2 image twice (two different crops), ask
 * gemini-3.1-flash-lite to transcribe the margin line verbatim from each, and parse the numerals
 * HERE (the model never does arithmetic). A page is read only when both crops agree. Only
 * the side (上/下) and the folio number are used; the section name is recorded, never
 * trusted (Flash misread 般若 for 祕密 in the pilot).
 *
 *   delta = (BDRC label as a side index) − (printed folio as a side index),
 *   side index = folio × 2 + (b ? 1 : 0).
 *
 * Per volume, per residue class (page_number % 4 — see the note at "measure"): ~8 evenly spaced
 * reads, then bisection wherever two neighbouring reads of the class disagree on delta. A segment
 * is a run of reads of one class with one delta; it is APPLIED only when at least 2 reads support
 * it and, if its delta is non-zero, another class shows a non-zero segment over the same pages.
 * Every other page keeps BDRC's label and is listed as unmeasured. A read implying a drift of
 * more than MAX_DRIFT_LEAVES counts as unread.
 *
 * Writes: `page_label` ← the printed folio; `catalog_metadata.page_label_source` =
 * 'printed-margin-5664' (no new top-level page field); BDRC's own label stays in
 * `catalog_metadata.label`. One sweep_log row per book, written before its pages.
 *
 * Modes:
 *   --control                       read the hand-read margins from the #5664 QA comment; exit 1 on any miss
 *   --measure [--vols 1,89] [--max-probes 40] [--offsets-file f.json] [--cache-only]
 *                                   read + bisect; writes offsets.json. --cache-only spends nothing:
 *                                   it measures from reads already on disk (how the 2026-10-03 run
 *                                   finished, after the $3 envelope was spent)
 *   --apply [--write]               rewrite page_label from offsets.json (dry by default)
 *
 * Reads are cached in $OUT/reads/<book>-<page>.json, so a re-run spends nothing on pages
 * already read. Spend is metered against the allow_scopes envelope `mongol-labels-5664`
 * (open it with set-scope.mjs first) and a local hard cap.
 *
 *   node --env-file=.env.production.local scripts/maintenance/mongol-folio-labels-5664.mjs --control
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { priceFor } from '../lib/model-pricing.mjs';
import { getScopeSpendUsd, readScopeEnvelopes } from '../lib/spend-guard.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const OUT = val('out', '/root/mongol-labels-5664');
const CAMPAIGN = 'mongol-5664';
const SCOPE = 'mongol-labels-5664';
const ENDPOINT = 'mongol-labels-5664';
const MODEL = val('model', 'gemini-3.1-flash-lite');
const CAP_USD = Number(val('cap', '3'));
const SAMPLES = Number(val('samples', '8'));
const MAX_PROBES = Number(val('max-probes', '40'));
const MOD = 4;
const CACHE_ONLY = flag('cache-only');
const CONCURRENCY = Number(val('concurrency', '6'));
// Two crops of the margin, each read once. A page counts as READ only when both crops give the
// same folio and side. The control showed why: lite reads each crop 10/11 right, but the miss
// is a different page in each (二 read as 三, in the hundreds on one and the units on the other),
// so agreement accepted 9/11 with none wrong. Any disagreement is left unread and the bisection
// walks round it.
//   left/top: fraction of width/height cut away; height: px the crop is scaled to.
const CROPS = {
  A: { left: 0.75, top: 0, height: 2400 },
  B: { left: 0.78, top: 0.3, height: 2000 },
};
// Both crops can agree on a wrong HUNDREDS digit (一/二/三 — v89 p468 read 134b for 234b on
// both). A real drift is a few duplicated or skipped leaves, never ~100, so a read implying
// more than this many leaves is treated as unread. A volume that really drifted further would
// show as all-unread and stay unmeasured — never relabelled by a guess.
const MAX_DRIFT_LEAVES = 20;
const LABEL_SOURCE = 'printed-margin-5664';
const SWEEP = 'mongol-folio-labels-5664';

// Hand-read margins from the #5664 QA comment (2026-10-03), by vol / page → printed leaf.
const CONTROL = [
  { vol: 17, page: 413, printed: '207a' },
  { vol: 19, page: 368, printed: '184b' },
  { vol: 66, page: 258, printed: '129b' },
  { vol: 89, page: 41, printed: '21a' },
  { vol: 89, page: 201, printed: '101a' },
  { vol: 89, page: 401, printed: '201a' },
  { vol: 89, page: 571, printed: '284a' },
  { vol: 89, page: 581, printed: '289a' },
  { vol: 89, page: 586, printed: '291b' },
  { vol: 89, page: 588, printed: '292b' },
  { vol: 89, page: 701, printed: '349a' },
];

const PROMPT = `This image is the right-hand edge of a leaf from a Mongolian blockprint (the 1720 Beijing Kanjur).
Inside the printed frame, along the right margin, runs one vertical line of small Chinese characters:
a section title ending in 經, then 第…卷 (volume), then 上 or 下, then a folio number written in Chinese numerals.
Transcribe that one vertical line EXACTLY, character by character, top to bottom. Do not convert numerals to digits, do not correct anything, do not add punctuation.
Ignore the Mongolian script.
Reply with JSON only: {"margin": "<the characters>"} — or {"margin": null} if there is no such line in the image.`;

// ── Chinese numerals ─────────────────────────────────────────────────────────
const DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT = { 十: 10, 百: 100, 千: 1000 };

/** Parse a run of Chinese numeral characters; null if any character is not a numeral. */
export function parseChineseNumber(s) {
  if (!s) return null;
  // Positional form (e.g. 二〇七) — only digits, no units.
  if ([...s].every((ch) => ch in DIGIT) && s.length > 1) return Number([...s].map((ch) => DIGIT[ch]).join(''));
  let total = 0;
  let cur = null;
  for (const ch of s) {
    if (ch in DIGIT) cur = DIGIT[ch];
    else if (ch in UNIT) { total += (cur === null ? 1 : cur) * UNIT[ch]; cur = null; }
    else return null;
  }
  if (cur !== null) total += cur;
  return total || null;
}

/** Parse a margin line → { section, juan, side, folio } or null. */
export function parseMargin(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, '');
  const m = /^(.*?)第([〇零一二兩三四五六七八九十百千]+)卷([上下])([〇零一二兩三四五六七八九十百千]+)/.exec(t);
  if (!m) {
    // Fall back to the tail: <上|下><numerals> at the end, the only part used.
    const tail = /([上下])([〇零一二兩三四五六七八九十百千]+)$/.exec(t);
    if (!tail) return null;
    const folio = parseChineseNumber(tail[2]);
    return folio ? { section: null, juan: null, side: tail[1] === '上' ? 'a' : 'b', folio, partial: true } : null;
  }
  const folio = parseChineseNumber(m[4]);
  if (!folio) return null;
  return { section: m[1] || null, juan: parseChineseNumber(m[2]), side: m[3] === '上' ? 'a' : 'b', folio };
}

const sideIdx = (folio, side) => folio * 2 + (side === 'b' ? 1 : 0);
const leafLabel = (idx) => `${Math.floor(idx / 2)}${idx % 2 ? 'b' : 'a'}`;
function parseLabel(label) {
  const m = /^f\. (\d+)([ab])$/.exec(label || '');
  return m ? sideIdx(+m[1], m[2]) : null;
}

// ── spend ────────────────────────────────────────────────────────────────────
let localUsd = 0;
let envelope = null;
async function openEnvelope(db) {
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  envelope = readScopeEnvelopes(control).find((e) => e.tag === SCOPE);
  if (!envelope) throw new Error(`no allow_scopes.${SCOPE} envelope — open it with set-scope.mjs first`);
}
async function checkSpend(db) {
  if (CACHE_ONLY) return 0;
  const spend = await getScopeSpendUsd(db, { ids: envelope.book_ids, since: envelope.created_at });
  if (spend.meterError) throw new Error(`envelope meter error: ${spend.meterError}`);
  const cap = Math.min(CAP_USD, envelope.budget_usd);
  if (spend.usd >= cap || localUsd >= cap) throw new Error(`spend cap reached: envelope $${spend.usd.toFixed(4)}, local $${localUsd.toFixed(4)}, cap $${cap}`);
  return spend.usd;
}

// ── reading one margin ──────────────────────────────────────────────────────
async function cropMargin(buf, crop) {
  const meta = await sharp(buf).metadata();
  const left = Math.round(meta.width * crop.left);
  const top = Math.round(meta.height * crop.top);
  return sharp(buf).extract({ left, top, width: meta.width - left, height: meta.height - top })
    .resize({ height: crop.height }).jpeg({ quality: 90 }).toBuffer();
}

async function readCrop(page, name, getImage) {
  const file = join(OUT, 'reads', `${page.book_id}-${page.page_number}-${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const img = await cropMargin(await getImage(), CROPS[name]);
  let r;
  for (let attempt = 1; ; attempt++) {
    try {
      r = await callGemini({
        model: MODEL, prompt: PROMPT, endpoint: ENDPOINT, imageParts: img, maxOutputTokens: 200,
        type: 'other', bookId: page.book_id, pageIds: [page.id], triggeredBy: 'manual',
      });
      break;
    } catch (err) {
      // 503 "high demand" and 429 are transient; anything else, or a 6th failure, stops the run.
      if (attempt >= 6 || !/Gemini (429|500|503)|timeout|aborted/i.test(String(err.message))) throw err;
      await new Promise((res) => setTimeout(res, 5000 * attempt));
    }
  }
  const price = priceFor(MODEL);
  localUsd += (r.inputTokens * price.input + r.outputTokens * price.output) / 1e6;
  let margin = null;
  try { margin = JSON.parse(r.text.replace(/^```(json)?|```$/gm, '').trim()).margin ?? null; } catch { margin = null; }
  const rec = { crop: name, raw: r.text, margin, parsed: parseMargin(margin), model: MODEL, read_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(rec, null, 1));
  return rec;
}

async function readPage(db, page) {
  if (!page.archived_photo) return { page_number: page.page_number, error: 'no archived_photo', delta: null };
  let buf = null;
  const getImage = async () => {
    if (buf) return buf;
    const resp = await fetch(page.archived_photo, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`fetch ${resp.status} ${page.archived_photo}`);
    buf = Buffer.from(await resp.arrayBuffer());
    return buf;
  };
  const reads = {};
  for (const name of Object.keys(CROPS)) reads[name] = await readCrop(page, name, getImage);
  const vals = Object.values(reads).map((r) => (r.parsed ? `${r.parsed.folio}${r.parsed.side}` : null));
  const agreed = vals.every((v) => v && v === vals[0]) ? Object.values(reads)[0].parsed : null;
  const labelIdx = parseLabel(page.page_label);
  let delta = agreed && labelIdx !== null ? labelIdx - sideIdx(agreed.folio, agreed.side) : null;
  let error = agreed ? undefined : `crops disagree or unparsed: ${vals.join(' / ')}`;
  if (delta !== null && Math.abs(delta) > MAX_DRIFT_LEAVES * 2) { error = `implausible: ${vals[0]} vs label ${page.page_label}`; delta = null; }
  return {
    book_id: page.book_id, page_number: page.page_number, page_label: page.page_label,
    margins: Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, r.margin])),
    parsed: agreed, error, delta,
  };
}

async function pool(items, fn, n = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function loadVolumes() {
  return readFileSync('/root/mongol-5664/book-ids.tsv', 'utf8').trim().split('\n')
    .map((l) => l.split('\t')).map(([vol, ig, id, n]) => ({ vol: +vol, ig, id, n: +n }));
}

// ── control ─────────────────────────────────────────────────────────────────
async function runControl(db) {
  const vols = new Map(loadVolumes().map((v) => [v.vol, v]));
  let ok = 0;
  let wrong = 0;
  for (const c of CONTROL) {
    const page = await db.collection('pages').findOne({ book_id: vols.get(c.vol).id, page_number: c.page });
    const rec = await readPage(db, page);
    const got = rec.parsed ? `${rec.parsed.folio}${rec.parsed.side}` : null;
    // A refusal (crops disagree) is safe; an ACCEPTED wrong value is the failure that matters.
    const verdict = got === c.printed ? 'PASS' : got === null ? 'UNREAD' : 'WRONG';
    if (verdict === 'PASS') ok++;
    if (verdict === 'WRONG') wrong++;
    console.log(`${verdict} v${c.vol} p${c.page} label=${page.page_label} hand=${c.printed} read=${got} margins=${JSON.stringify(rec.margins)}`);
  }
  console.log(`control: ${ok}/${CONTROL.length} accepted and right, ${wrong} accepted and WRONG, ${CONTROL.length - ok - wrong} unread  local spend $${localUsd.toFixed(4)}`);
  // Pass: no wrong value accepted, and at least 3 in 4 read.
  return wrong === 0 && ok >= Math.ceil(CONTROL.length * 0.75);
}

// ── measure ─────────────────────────────────────────────────────────────────
// Pages are measured as MOD separate series, by page_number % MOD. BDRC's photo order is not
// always the leaf order: in v22 each recto comes before the verso that precedes it (349a, 348b,
// 350a, 349b, …), so the offset alternates by parity; in v34 it cycles over four pages (151a,
// 150a, 150b, 151b, …). A series that mixes those pages ALIASES — a run of reads that happen to
// share a residue looks like one constant offset (the parity-only run found "+1 leaf" on v34
// p278–562 from nine reads that were all ≡ 2 mod 4). Within one residue class the offset is
// constant between events, which is what the segment model assumes.
const isValid = (r) => r && r.delta !== null && r.delta !== undefined;

async function measureVolume(db, v) {
  const pages = await db.collection('pages').find({ book_id: v.id })
    .project({ id: 1, book_id: 1, page_number: 1, page_label: 1, archived_photo: 1 })
    .sort({ page_number: 1 }).toArray();
  const byPn = new Map(pages.map((p) => [p.page_number, p]));
  const labelled = pages.filter((p) => parseLabel(p.page_label) !== null);
  const first = labelled[0].page_number;
  const last = labelled.at(-1).page_number;
  const reads = new Map();
  let fresh = 0;
  const isCached = (pn) => Object.keys(CROPS).every((c) => existsSync(join(OUT, 'reads', `${v.id}-${pn}-${c}.json`)));
  const read = async (pn) => {
    if (reads.has(pn)) return reads.get(pn);
    const p = byPn.get(pn);
    if (!p || parseLabel(p.page_label) === null) { const r = { page_number: pn, error: 'no label', delta: null }; reads.set(pn, r); return r; }
    if (!isCached(pn)) {
      // --cache-only: measure from earlier reads alone, spending nothing (used once the cap is reached).
      if (CACHE_ONLY) { const r = { page_number: pn, error: 'not read (cache-only)', delta: null }; reads.set(pn, r); return r; }
      fresh++;
    }
    const rec = await readPage(db, p);
    reads.set(pn, rec);
    return rec;
  };
  // Every page already read (any earlier run) is reused at no cost.
  for (const p of labelled) if (isCached(p.page_number)) await read(p.page_number);

  const segments = [];
  let probes = 0;
  for (let parity = 0; parity < MOD; parity++) {
    const series = () => [...reads.values()].filter((r) => r.page_number % MOD === parity && isValid(r)).sort((x, y) => x.page_number - y.page_number);
    const span = (last - first) / (SAMPLES - 1);
    // Seeds: SAMPLES evenly spaced pages of this parity, skipped where a cached read is near.
    const targets = Array.from({ length: SAMPLES }, (_, k) => {
      let pn = Math.round(first + k * span);
      while (pn % MOD !== parity) pn += pn + MOD <= last ? 1 : -1;
      return pn;
    });
    await checkSpend(db);
    await pool(targets, async (pn, k) => {
      if (series().some((r) => Math.abs(r.page_number - pn) <= span / 3)) return;
      const dir = k === targets.length - 1 ? -MOD : MOD;
      // An unreadable seed (a cover, or the crops disagree) moves inward, same parity, 4 tries.
      for (let t = 0; t < 5; t++) if (isValid(await read(pn + dir * t))) return;
    });
    // Bisection within the parity, until every disagreement sits between neighbouring same-parity pages.
    for (;;) {
      const valid = series();
      const mids = [];
      for (let k = 1; k < valid.length; k++) {
        const x = valid[k - 1], y = valid[k];
        if (x.delta === y.delta || y.page_number - x.page_number <= MOD) continue;
        let mid = Math.floor((x.page_number + y.page_number) / 2);
        while (mid % MOD !== parity) mid++;
        while (reads.has(mid) && mid < y.page_number - MOD) mid += MOD;
        if (!reads.has(mid) && mid < y.page_number) mids.push(mid);
      }
      if (!mids.length || probes >= MAX_PROBES) break;
      probes += mids.length;
      await checkSpend(db);
      await pool(mids, read);
    }
    for (const r of series()) {
      const sg = segments.filter((x) => x.parity === parity).at(-1);
      if (sg && sg.delta === r.delta) { sg.to = r.page_number; sg.reads.push(r.page_number); }
      else segments.push({ parity, delta: r.delta, from: r.page_number, to: r.page_number, reads: [r.page_number] });
    }
  }
  for (const sg of segments) sg.supported = sg.reads.length >= 2;
  const unreadable = [...reads.values()].filter((r) => !isValid(r)).map((r) => ({ page_number: r.page_number, margins: r.margins ?? null, error: r.error }));
  return {
    vol: v.vol, book_id: v.id, mod: MOD, pages: pages.length, first_labelled: first, last_labelled: last,
    reads: reads.size, fresh_reads: fresh, probes, converged: probes < MAX_PROBES,
    segments, unreadable,
    drifts: segments.some((sg) => sg.supported && sg.delta !== 0),
  };
}

async function runMeasure(db) {
  await openEnvelope(db);
  const only = val('vols', null)?.split(',').map(Number);
  const vols = loadVolumes().filter((v) => !only || only.includes(v.vol));
  // --offsets-file lets several processes measure disjoint --vols in parallel; merge before --apply.
  const file = join(OUT, val('offsets-file', 'offsets.json'));
  const result = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const v of vols) {
    await checkSpend(db);
    const r = await measureVolume(db, v);
    result[v.vol] = r;
    writeFileSync(file, JSON.stringify(result, null, 1));
    const segTxt = (par) => r.segments.filter((s) => s.parity === par).map((s) => `[p${s.from}-${s.to} Δ${s.delta / 2}lv ×${s.reads.length}${s.supported ? '' : '?'}]`).join(' ');
    console.log(`v${v.vol} reads=${r.reads} fresh=${r.fresh_reads} probes=${r.probes} unreadable=${r.unreadable.length}  local $${localUsd.toFixed(4)}`);
    for (let par = 0; par < MOD; par++) console.log(`   ≡${par} ${segTxt(par)}`);
  }
}

// ── apply ───────────────────────────────────────────────────────────────────
async function runApply(db) {
  const write = flag('write');
  const offsets = JSON.parse(readFileSync(join(OUT, 'offsets.json'), 'utf8'));
  const report = { relabelled: 0, unchanged_measured: 0, unmeasured: [], books: [] };
  for (const r of Object.values(offsets)) {
    const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { acquisition_campaign: 1 } });
    if (book?.acquisition_campaign !== CAMPAIGN) throw new Error(`book ${r.book_id} is not in ${CAMPAIGN}`);
    const pages = await db.collection('pages').find({ book_id: r.book_id })
      .project({ _id: 1, page_number: 1, page_label: 1, catalog_metadata: 1 }).sort({ page_number: 1 }).toArray();
    // A page is measured iff it lies inside a supported segment of its own residue class
    // (between that segment's first and last read). A NON-ZERO segment must also be corroborated:
    // another residue class shows a supported non-zero segment overlapping it. A real event
    // (a duplicated, missing or reordered photo) moves every class; two agreeing misreads of a
    // tens digit (v12 p665–675, "Δ10 leaves") move one.
    if (r.mod !== MOD) throw new Error(`v${r.vol}: offsets measured with mod ${r.mod}, this script applies mod ${MOD} — re-measure`);
    const base = r.segments.filter((s) => s.supported);
    const corroborated = (s) => s.delta === 0 || base.some((t) => t.parity !== s.parity && t.delta !== 0 && t.from <= s.to && s.from <= t.to);
    const supported = base.filter(corroborated);
    report.uncorroborated = (report.uncorroborated || []).concat(base.filter((s) => !corroborated(s)).map((s) => ({ vol: r.vol, residue: s.parity, from: s.from, to: s.to, delta_leaves: s.delta / 2, reads: s.reads })));
    const ops = [];
    const unmeasured = [];
    let relabel = 0, same = 0;
    for (const p of pages) {
      const seg = supported.find((s) => s.parity === p.page_number % MOD && p.page_number >= s.from && p.page_number <= s.to);
      // Idempotent: a page already rewritten is never shifted a second time.
      if (p.catalog_metadata?.page_label_source === LABEL_SOURCE) { relabel++; continue; }
      const idx = parseLabel(p.page_label);
      if (!seg || idx === null) { unmeasured.push(p.page_number); continue; }
      const printed = `f. ${leafLabel(idx - seg.delta)}`;
      if (seg.delta === 0) { same++; continue; }
      relabel++;
      ops.push({ updateOne: {
        filter: { _id: p._id, page_label: p.page_label },
        update: { $set: { page_label: printed, 'catalog_metadata.page_label_source': LABEL_SOURCE, updated_at: new Date() } },
      } });
    }
    report.relabelled += relabel;
    report.unchanged_measured += same;
    report.unmeasured.push({ vol: r.vol, book_id: r.book_id, count: unmeasured.length, pages: compress(unmeasured) });
    if (relabel) report.books.push({ vol: r.vol, book_id: r.book_id, relabel });
    if (write && ops.length) {
      await recordSweepAction(db, {
        sweep: SWEEP, book_id: r.book_id, action: 'page-label-rewritten-to-printed-folio',
        detail: { vol: r.vol, pages: relabel, segments: supported.filter((s) => s.delta !== 0).map((s) => ({ residue_mod4: s.parity, from: s.from, to: s.to, delta_leaves: s.delta / 2, reads: s.reads })), source: LABEL_SOURCE, issue: 5664 },
      });
      const res = await db.collection('pages').bulkWrite(ops, { ordered: false });
      if (res.modifiedCount !== ops.length) console.warn(`v${r.vol}: modified ${res.modifiedCount} of ${ops.length}`);
    }
    console.log(`v${r.vol} relabel=${relabel} measured-unchanged=${same} unmeasured=${unmeasured.length}${write ? '' : ' (dry)'}`);
  }
  writeFileSync(join(OUT, `apply-report${write ? '' : '-dry'}.json`), JSON.stringify(report, null, 1));
  console.log(`total relabel=${report.relabelled} measured-unchanged=${report.unchanged_measured} unmeasured=${report.unmeasured.reduce((a, u) => a + u.count, 0)}${write ? '' : ' (dry — pass --write)'}`);
}

function compress(nums) {
  const out = [];
  for (const n of nums) {
    const last = out.at(-1);
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
}

// ── main ────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(join(OUT, 'reads'), { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    if (flag('control')) { await openEnvelope(db); await checkSpend(db); process.exitCode = (await runControl(db)) ? 0 : 1; }
    else if (flag('measure')) await runMeasure(db);
    else if (flag('apply')) await runApply(db);
    else console.log('usage: --control | --measure [--vols 1,89] | --apply [--write]');
  } finally {
    await client.close();
  }
}
