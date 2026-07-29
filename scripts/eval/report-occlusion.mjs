#!/usr/bin/env node
/**
 * Occlusion/degradation pilot report (#3235 — "Occlusion cloze pilot" in
 * .claude/docs/ocr-memorization-paper.md).
 *
 * Reads the observations dataset (scored at build time by build-observations.mjs)
 * and the raw outputs JSONL, and reports, per pilot page × model:
 *   - baseline (@w2000) vs occluded (@occ25@w2000) reference accuracy — a READING
 *     model loses the masked share of the passage; a RECITING model stays flat;
 *   - the blur ladder (@blur2@w2000, @blur4@w2000) — the degradation slope;
 *   - whether the model MENTIONED the mask (silent fill-in vs flagged gap), from
 *     the raw output text.
 *
 * The detector validates against known labels: every pilot page carries
 * page_class.canonical_text, and the four within-work pairs hold page style
 * constant, so Δocc(canon) vs Δocc(noncanon) within a pair is the signal.
 *
 * Usage: node scripts/eval/report-occlusion.mjs [observations.jsonl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const obsFile = process.argv[2] ||
  path.join(__dirname, 'observations', 'ocr-observations-2026-07-24.jsonl');

const PAIRS = [
  { book: 'Vulgate (1566 Louvain)', canon: 'latin-vulgate-genesis-1', noncanon: 'latin-vulgate-genesis-5-genealogy' },
  { book: 'Virgil (1580 Meyen)', canon: 'latin-aeneid-1', noncanon: 'latin-aeneid-10-pallas' },
  { book: 'Iliad (1555 MS Rouse 358)', canon: 'greek-iliad-1', noncanon: 'greek-iliad-13-idomeneus' },
  { book: 'Zohrab Bible (1805)', canon: 'armenian-zohrab-john-1', noncanon: 'armenian-zohrab-1chronicles-1' },
  { book: 'Hebrew (unpaired controls)', canon: 'hebrew-genesis-1', noncanon: 'hebrew-shaarei-orah-gate2-yovel' },
];
const SLUGS = new Set(PAIRS.flatMap(p => [p.canon, p.noncanon]));

// Arms of this pilot. Baseline is @w2000 (all arms share the 2000px base so blur
// sigma is comparable and sonnet stays under the 5MB input cap).
const ARMS = ['@w2000', '@occ25@w2000', '@blur2@w2000', '@blur4@w2000'];

// Visually audited share of the REFERENCE passage left visible by the fixed
// mid-page mask (2026-07-23 audit of the saved @occ25 images). The fixed-geometry
// mask is the pilot's main design flaw: on two canonical pages it missed the
// passage entirely (share 1.0 → Δocc trivially 0, page EXCLUDED as detector
// evidence). fill-in excess = occ_coverage − visible_share; a reader ≈ 0 or
// below (occlusion also scrambles reading order), a reciter is strongly positive.
// null = not yet audited (excess not computed).
const VISIBLE_SHARE = {
  'latin-vulgate-genesis-1': 1.0,          // mask hit the woodcut — EXCLUDED
  'hebrew-genesis-1': 1.0,                 // mask below vv.1-5 — EXCLUDED
  'latin-aeneid-1': 0.75,                  // ref line 4 masked (boundary-cut)
  'latin-aeneid-10-pallas': 0.60,          // ~9 of ~21 ref lines masked
  'greek-iliad-1': 0.30,                   // ref lines 3-7 of 7 masked
  'greek-iliad-13-idomeneus': 0.72,        // ~7 of ~25 ref lines masked
  'latin-vulgate-genesis-5-genealogy': 0.60, // vv.~5-12 of 3-18 masked
  'armenian-zohrab-1chronicles-1': 0.65,   // vv.~16-23 of 1-23 masked
  'armenian-zohrab-john-1': null,
  'hebrew-shaarei-orah-gate2-yovel': null,
};

const rows = fs.readFileSync(obsFile, 'utf8').trim().split('\n').map(JSON.parse)
  .filter(r => SLUGS.has(r.slug) && r.source !== 'interactive' && r.model);

const baseModel = m => m.split('@')[0].includes('lite') ? 'lite'
  : m.split('@')[0].includes('sonnet') ? 'sonnet5' : m.split('@')[0];
const armOf = m => { const i = m.indexOf('@'); return i === -1 ? null : m.slice(i); };

// slug → model → arm → accuracy stats over runs
const cell = new Map();
for (const r of rows) {
  const arm = armOf(r.model);
  if (!ARMS.includes(arm)) continue;
  const k = `${r.slug}|${baseModel(r.model)}|${arm}`;
  if (!cell.has(k)) cell.set(k, []);
  cell.get(k).push(r);
}
const stat = (slug, model, arm) => {
  const xs = cell.get(`${slug}|${model}|${arm}`);
  if (!xs || !xs.length) return null;
  const aligned = xs.filter(r => r.aligned);
  return {
    n: xs.length,
    alignedN: aligned.length,
    // Free-skip reference coverage of ALL runs (unconditional) — the right
    // outcome here: occlusion legitimately breaks alignment for readers, and
    // conditioning on alignment would hide exactly that.
    raw: xs.reduce((s, r) => s + (r.char_accuracy_raw ?? (r.aligned ? r.char_accuracy : 0)), 0) / xs.length,
  };
};

// Raw-output mask mentions (silent fill-in vs flagged gap).
const MENTION_RE = /gr[ae]y|obscur|occlud|redact|censor|blocked|covered|masked|missing section|cannot (?:read|see)|not visible|hidden|blank (?:band|bar|box|area)|rectangle|\[\.\.\.|\[illegible|\[unreadable/i;
const mentions = new Map(); // slug|model → { occRuns, mentioned }
for (const f of fs.readdirSync(path.join(__dirname, 'results'))) {
  if (!f.startsWith('scorecard-outputs-') || !f.endsWith('.jsonl')) continue;
  for (const line of fs.readFileSync(path.join(__dirname, 'results', f), 'utf8').trim().split('\n')) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o.model?.includes('@occ')) continue;
    const slug = [...SLUGS].find(s => o.work && workMatches(o.work, s));
    if (!slug) continue;
    const k = `${slug}|${baseModel(o.model)}`;
    if (!mentions.has(k)) mentions.set(k, { occRuns: 0, mentioned: 0 });
    const m = mentions.get(k);
    m.occRuns++;
    if (MENTION_RE.test(o.text || '')) m.mentioned++;
  }
}
function workMatches(work, slug) {
  // slug tokens must all appear in the work title, loosely (slug is derived from it)
  const w = work.toLowerCase();
  const tokens = { 'latin-vulgate-genesis-1': ['genesis 1:'], 'latin-vulgate-genesis-5-genealogy': ['genesis 5'],
    'latin-aeneid-1': ['aeneid i'], 'latin-aeneid-10-pallas': ['aeneid x.'],
    'greek-iliad-1': ['iliad i'], 'greek-iliad-13-idomeneus': ['iliad xiii'],
    'armenian-zohrab-john-1': ['john 1'], 'armenian-zohrab-1chronicles-1': ['1 chronicles'],
    'hebrew-genesis-1': ['בראשית', 'genesis (hebrew'], 'hebrew-shaarei-orah-gate2-yovel': ['orah'] }[slug] || [slug];
  return tokens.some(t => w.includes(t));
}

const pc = n => n == null ? '    —' : (n * 100).toFixed(1).padStart(5) + '%';
console.log(`Occlusion/degradation pilot — ${obsFile}`);
for (const pair of PAIRS) {
  console.log(`\n== ${pair.book}`);
  for (const model of ['lite', 'sonnet5']) {
    for (const [label, slug] of [['canon   ', pair.canon], ['noncanon', pair.noncanon]]) {
      const base = stat(slug, model, '@w2000');
      const occ = stat(slug, model, '@occ25@w2000');
      const b2 = stat(slug, model, '@blur2@w2000');
      const b4 = stat(slug, model, '@blur4@w2000');
      if (!base && !occ && !b2 && !b4) continue;
      const d = (a, b) => (a && b) ? ((b.raw - a.raw) * 100).toFixed(1).padStart(6) + 'pp' : '      —';
      const m = mentions.get(`${slug}|${model}`);
      const men = m ? `${m.mentioned}/${m.occRuns} mention mask` : '';
      const vs = VISIBLE_SHARE[slug];
      const excess = (occ && vs != null && vs < 1)
        ? ` fill-in ${((occ.raw - vs) * 100).toFixed(0).padStart(3)}pp`
        : (vs === 1 ? ' [mask missed ref — excluded]' : (vs == null ? ' [unaudited]' : ''));
      console.log(`  ${model.padEnd(8)} ${label} base ${pc(base?.raw)}  occ ${pc(occ?.raw)} (Δ${d(base, occ)})${excess}  blur2 ${pc(b2?.raw)}  blur4 ${pc(b4?.raw)} (Δ${d(base, b4)})  ${men}`);
    }
  }
}
console.log('\nReading: a READER drops under occlusion by ≈ the masked share of the passage');
console.log('and degrades under blur; a RECITER stays flat on both. Compare canon vs');
console.log('noncanon WITHIN a pair (page style constant). Mask mentions distinguish');
console.log('flagged gaps (honest) from silent fill-in (recitation).');

// ── v2 pilot correction (2026-07-24, PR follow-up to #3235 result 16) ──────
//
// v1's fixed mid-page band (a) missed the reference passage entirely on 2 of
// 5 canonical pages, and (b) conflated mask-passage overlap with fill-in
// because the visible share was only eyeballed. v2 replaces the fixed band
// with a PASSAGE-TARGETED rect per page (audited against the reference text
// itself — masked_ref_share below is computed from exact GT-substring char
// offsets where the passage text could be cleanly located, or from a
// verified print-line count where verse/line boundaries don't map 1:1 to the
// GT sentence split; see scripts/eval/results/occlusion-v2-masks-2026-07-24.json
// for the audit trail per page). The v2 arm tag is `@occR<areaPct>@w2000`
// (area = % of PAGE masked, not of the passage — distinct from v1's
// `@occ25@w2000` height-fraction tag, so old and new runs never collide).
const MASKS_V2 = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'results', 'occlusion-v2-masks-2026-07-24.json'), 'utf8')).masks;
const maskedShare = Object.fromEntries(MASKS_V2.map(m => [m.slug, m.masked_ref_share]));

const occ2ArmOf = m => { const mm = /@occR\d+@w2000$/.exec(m); return mm ? mm[0] : null; };
const cell2 = new Map();
for (const r of rows) {
  const arm = occ2ArmOf(r.model);
  if (!arm) continue;
  const k = `${r.slug}|${baseModel(r.model)}`;
  if (!cell2.has(k)) cell2.set(k, []);
  cell2.get(k).push(r);
}
const stat2 = (slug, model) => {
  const xs = cell2.get(`${slug}|${model}`);
  if (!xs || !xs.length) return null;
  return { n: xs.length, raw: xs.reduce((s, r) => s + (r.char_accuracy_raw ?? 0), 0) / xs.length };
};

console.log('\n\n=== v2 pilot: passage-targeted occlusion (audited masked_ref_share, no fixed-band miss) ===');
for (const pair of PAIRS) {
  console.log(`\n== ${pair.book}`);
  for (const model of ['lite', 'sonnet5']) {
    for (const [label, slug] of [['canon   ', pair.canon], ['noncanon', pair.noncanon]]) {
      const base = stat(slug, model, '@w2000');
      const occ2 = stat2(slug, model);
      if (!base && !occ2) continue;
      const d = (a, b) => (a && b) ? ((b.raw - a.raw) * 100).toFixed(1).padStart(6) + 'pp' : '      —';
      const share = maskedShare[slug];
      const visible = share == null ? null : 1 - share;
      const excess = (occ2 && visible != null)
        ? ` fill-in ${((occ2.raw - visible) * 100).toFixed(0).padStart(3)}pp (masked ${(share * 100).toFixed(0)}%)`
        : ' [no audited share]';
      console.log(`  ${model.padEnd(8)} ${label} base ${pc(base?.raw)}  occ2 ${pc(occ2?.raw)} (Δ${d(base, occ2)})${excess}`);
    }
  }
}
console.log('\nv2 reading: same logic as v1 (fill-in excess = occluded-run coverage minus');
console.log('the audited VISIBLE share, i.e. 1 − masked_ref_share) but every mask is now');
console.log('verified to actually cover its reference passage, at a consistent 30-50%');
console.log('interior share, never touching the first or last line — so no page is');
console.log('excluded and no excess figure is inflated by a mask that missed its target.');
