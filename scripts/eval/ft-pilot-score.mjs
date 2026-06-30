#!/usr/bin/env node
/**
 * #2880 Round-1 scorer — head-to-head (Tier-1 Gemini vs Tier-2 Claude oracle),
 * per-stratum precision/recall/fabrication, 4-class Cohen's kappa, and the
 * genuine-first rate per stratum with a Wilson 95% interval.
 *
 * Pure measurement. Reads:
 *   - scripts/eval/results/r1-oracle/<id>.json   (Tier-2 oracle, ground truth, UNPRIMED)
 *   - scripts/eval/results/ft-pilot-r1-gemini.json (Tier-1 Gemini arm)
 *   - scripts/eval/results/ft-pilot-r1-scoringkey.json (badge/stratum/tier0 — never shown to a model)
 * Writes nothing (prints a report). No DB writes, no badge flips.
 */
import { readFileSync, readdirSync } from 'fs';

const ROOT = 'scripts/eval/results';
const key = JSON.parse(readFileSync(`${ROOT}/ft-pilot-r1-scoringkey.json`, 'utf8'));
const gemArr = JSON.parse(readFileSync(`${ROOT}/ft-pilot-r1-gemini.json`, 'utf8'));
const gem = new Map(gemArr.map(r => [String(r.book_id), r]));

const oracle = new Map();
for (const f of readdirSync(`${ROOT}/r1-oracle`).filter(f => f.endsWith('.json'))) {
  try { const o = JSON.parse(readFileSync(`${ROOT}/r1-oracle/${f}`, 'utf8')); oracle.set(String(o.book_id), o); }
  catch (e) { console.error('bad oracle file', f, e.message); }
}

const FIRST = new Set(['first_no_prior', 'first_from_source', 'first_complete', 'first_modern']);
// STRICT rubric (original contract): not_applicable auto-disqualifies containers + scripture copies.
const cls = v => FIRST.has(v) ? 'FIRST' : v === 'not_first' ? 'NOT_FIRST' : v === 'not_applicable' ? 'NA'
  : (v === 'unverifiable' || v === 'needs_review') ? 'INDET' : 'OTHER';
const priorClaimed = o => Array.isArray(o.prior_translations_found) && o.prior_translations_found.length > 0;

// CORRECTED rubric (Derek, 2026-06-30): not_applicable means ONLY "our item is already English"
// or "wordless visual art". A multi-work container / single scripture-volume / compilation that we
// produced the FIRST English of (no prior English of that content) IS a first. A complete prior
// English of the content → not_first. Re-maps the SAME oracle evidence — no re-run.
// Items already in English (or wordless visual art) in this sample, manually verified:
const ALREADY_ENGLISH = new Set([
  '69aec4473b6ebce5e0ee5929', // The Federalist (English original)
  '69b52fab1a04ee0f3b4180e9', // Budge, Egyptian Hieroglyphic Dictionary (English reference work)
  '699246b3bc722ec0ee81144f', // Wycliffe Bible, Forshall & Madden (Middle English)
  '695581a157e3b773024f6989', // Munro, Poems & Translations (already-English publication)
  '69b3e686abb796bfd9de42ab', // Texts on magic & fortune telling (Middle English miscellany)
]);
const priorExists = o => o.verdict === 'not_first' || priorClaimed(o);
function clsCorrected(o) {
  if (FIRST.has(o.verdict)) return 'FIRST';
  if (o.verdict === 'not_first') return 'NOT_FIRST';
  if (o.verdict === 'unverifiable' || o.verdict === 'needs_review') return 'INDET';
  if (o.verdict === 'not_applicable') {
    if (ALREADY_ENGLISH.has(String(o.book_id))) return 'NA_ENGLISH'; // truly not a translation
    if (priorExists(o)) return 'NOT_FIRST';                          // complete prior of the content exists
    return 'FIRST';                                                  // untranslated content we Englished
  }
  return 'OTHER';
}

// ---- assemble joined rows ----
const rows = key.map(k => {
  const o = oracle.get(String(k.id)), g = gem.get(String(k.id));
  return {
    id: k.id, stratum: k.stratum, badged: k.badged, disposition: k.disposition,
    oVerdict: o?.verdict || 'MISSING', oCls: o ? cls(o.verdict) : 'MISSING', oCorr: o ? clsCorrected(o) : 'MISSING', oConf: o?.confidence,
    oPrior: o ? priorClaimed(o) : null, oStrength: o?.evidence_strength,
    gVerdict: g?.verdict || 'MISSING', gCls: g ? cls(g.verdict) : 'MISSING', gPrior: g ? priorClaimed(g) : null,
  };
});

const missingO = rows.filter(r => r.oCls === 'MISSING').map(r => r.id);
const missingG = rows.filter(r => r.gCls === 'MISSING').map(r => r.id);
if (missingO.length) console.error(`WARNING: ${missingO.length} oracle files missing:`, missingO.join(','));
if (missingG.length) console.error(`WARNING: ${missingG.length} gemini results missing:`, missingG.join(','));

const scored = rows.filter(r => r.oCls !== 'MISSING' && r.gCls !== 'MISSING');

// ---- Wilson 95% interval ----
function wilson(k, n) {
  if (n === 0) return [0, 0, 0];
  const z = 1.959963985, p = k / n;
  const d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [p, Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = x => (100 * x).toFixed(1) + '%';

// ---- 4-class Cohen's kappa (Gemini vs oracle) ----
function kappa(pairs) {
  const cats = ['FIRST', 'NOT_FIRST', 'NA', 'INDET'];
  const n = pairs.length;
  let agree = 0;
  const a = {}, b = {};
  cats.forEach(c => { a[c] = 0; b[c] = 0; });
  for (const [x, y] of pairs) { if (x === y) agree++; a[x] = (a[x] || 0) + 1; b[y] = (b[y] || 0) + 1; }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += (a[c] / n) * (b[c] / n);
  return { po, pe, kappa: (po - pe) / (1 - pe), n, agree };
}

// ---- exact 8-way agreement ----
const exact8 = scored.filter(r => r.oVerdict === r.gVerdict).length;
const class4 = scored.filter(r => r.oCls === r.gCls).length;
const k = kappa(scored.map(r => [r.gCls, r.oCls]));

console.log('\n================ #2880 ROUND 1 — HEAD-TO-HEAD (n=' + scored.length + '/' + rows.length + ') ================');
console.log(`Exact 8-way verdict agreement (Gemini↔oracle): ${exact8}/${scored.length} = ${pct(exact8 / scored.length)}`);
console.log(`4-class agreement (FIRST/NOT_FIRST/NA/INDET):  ${class4}/${scored.length} = ${pct(class4 / scored.length)}`);
console.log(`Cohen's kappa (4-class, Gemini↔oracle): ${k.kappa.toFixed(3)}  (po=${k.po.toFixed(3)}, pe=${k.pe.toFixed(3)})`);

// ---- per-stratum metrics, oracle = ground truth ----
const strata = [...new Set(key.map(k => k.stratum))];
function metrics(subset) {
  const n = subset.length;
  // FIRST detection
  const tp = subset.filter(r => r.gCls === 'FIRST' && r.oCls === 'FIRST').length;
  const fp = subset.filter(r => r.gCls === 'FIRST' && r.oCls !== 'FIRST').length;
  const fn = subset.filter(r => r.gCls !== 'FIRST' && r.oCls === 'FIRST').length;
  const prec = (tp + fp) ? tp / (tp + fp) : null;
  const rec = (tp + fn) ? tp / (tp + fn) : null;
  // fabrication: Gemini says not_first (prior claimed) but oracle is FIRST family (no real complete prior)
  const gNotFirst = subset.filter(r => r.gCls === 'NOT_FIRST');
  const fab = gNotFirst.filter(r => r.oCls === 'FIRST').length;
  const fabRate = gNotFirst.length ? fab / gNotFirst.length : null;
  // oracle genuine-first rate (for corpus count)
  const oFirst = subset.filter(r => r.oCls === 'FIRST').length;
  const [p, lo, hi] = wilson(oFirst, n);
  return { n, tp, fp, fn, prec, rec, gNotFirst: gNotFirst.length, fab, fabRate, oFirst, p, lo, hi };
}

console.log('\n================ PER-STRATUM (oracle = ground truth) ================');
console.log('stratum                  n | T1 prec(first) recall(first) fab | oracle-FIRST rate [Wilson95]');
for (const s of [...strata, '__ALL__']) {
  const sub = s === '__ALL__' ? scored : scored.filter(r => r.stratum === s);
  const m = metrics(sub);
  const fmt = x => x == null ? '  n/a' : pct(x).padStart(6);
  console.log(
    `${(s === '__ALL__' ? 'OVERALL' : s).padEnd(24)} ${String(m.n).padStart(2)} |` +
    ` ${fmt(m.prec)} (${m.tp}/${m.tp + m.fp})  ${fmt(m.rec)} (${m.tp}/${m.tp + m.fn})  ${fmt(m.fabRate)} (${m.fab}/${m.gNotFirst}) |` +
    ` ${m.oFirst}/${m.n} = ${pct(m.p)} [${pct(m.lo)}–${pct(m.hi)}]`
  );
}

// ---- corpus count framing: oracle genuine-first rate among BADGED (over-claim) ----
const badged = scored.filter(r => r.badged);
const unbadged = scored.filter(r => !r.badged);
const bm = metrics(badged), um = metrics(unbadged);
console.log('\n================ CORPUS-COUNT INPUTS (this round, unweighted) ================');
console.log(`BADGED genuine-first rate (oracle):   ${bm.oFirst}/${bm.n} = ${pct(bm.p)} [${pct(bm.lo)}–${pct(bm.hi)}]  (1 - this = over-claim)`);
console.log(`UNBADGED genuine-first rate (oracle): ${um.oFirst}/${um.n} = ${pct(um.p)} [${pct(um.lo)}–${pct(um.hi)}]  (recall: firsts not badged)`);
console.log('NOTE: a single headline corpus number needs corpus-level stratum weights (badged/unbadged × W/nonW totals) — deferred to Derek per #2880 guardrail.');

// ---- CORRECTED rubric: genuine-first rate per stratum (re-mapped oracle evidence, no re-run) ----
console.log('\n================ CORRECTED RUBRIC (NA = already-English / wordless art only) ================');
console.log('Genuine-first = oracle FIRST family OR (container/scripture/compilation with NO prior English of the content).');
console.log('stratum                  n | genuine-FIRST [Wilson95] | not_first | NA(English) | indet');
for (const s of [...strata, '__ALL__']) {
  const sub = s === '__ALL__' ? scored : scored.filter(r => r.stratum === s);
  const n = sub.length;
  const f = sub.filter(r => r.oCorr === 'FIRST').length;
  const nf = sub.filter(r => r.oCorr === 'NOT_FIRST').length;
  const na = sub.filter(r => r.oCorr === 'NA_ENGLISH').length;
  const ind = sub.filter(r => r.oCorr === 'INDET').length;
  const [p, lo, hi] = wilson(f, n);
  console.log(`${(s === '__ALL__' ? 'OVERALL' : s).padEnd(24)} ${String(n).padStart(2)} | ${String(f).padStart(2)}/${n} = ${pct(p)} [${pct(lo)}–${pct(hi)}] | ${nf} | ${na} | ${ind}`);
}
const bF = scored.filter(r => r.badged && r.oCorr === 'FIRST').length;
const bN = scored.filter(r => r.badged).length;
const [bp, blo, bhi] = wilson(bF, bN);
console.log(`\nBADGED genuine-first (corrected): ${bF}/${bN} = ${pct(bp)} [${pct(blo)}–${pct(bhi)}]  (was ${pct(13 / 26)} under strict NA rule)`);
console.log('GENUINE non-firsts among BADGED (the only demote/remove candidates):');
for (const r of scored.filter(r => r.badged && (r.oCorr === 'NOT_FIRST' || r.oCorr === 'NA_ENGLISH'))) {
  console.log(`  ${r.id}  ${r.oCorr === 'NA_ENGLISH' ? 'REMOVE (already English)' : 'DEMOTE (prior English exists)'}  — oracle:${r.oVerdict}`);
}

// ---- disagreement queue (read-all) ----
console.log('\n================ QUEUE A — DISAGREEMENTS (4-class) ================');
for (const r of scored.filter(r => r.oCls !== r.gCls)) {
  console.log(`${r.id} [${r.stratum}] badged=${r.badged}  GEM=${r.gVerdict}(${r.gCls})  ORACLE=${r.oVerdict}(${r.oCls}) conf=${r.oConf} strength=${r.oStrength}`);
}

// ---- low-confidence / indeterminate queue ----
console.log('\n================ QUEUE B — ORACLE LOW-CONF / INDETERMINATE ================');
for (const r of scored.filter(r => r.oConf === 'low' || r.oCls === 'INDET')) {
  console.log(`${r.id} [${r.stratum}]  ORACLE=${r.oVerdict} conf=${r.oConf} strength=${r.oStrength}`);
}

// ---- badge-impact summary (measure-only; NOT applied) ----
console.log('\n================ BADGE-IMPACT (measure-only, NOT applied) ================');
const badgedFirst = badged.filter(r => r.oCls === 'FIRST').length;
const badgedNot = badged.filter(r => r.oCls === 'NOT_FIRST').length;
const badgedNA = badged.filter(r => r.oCls === 'NA').length;
const badgedIndet = badged.filter(r => r.oCls === 'INDET').length;
console.log(`Of ${badged.length} BADGED books in sample, oracle says: FIRST=${badgedFirst}  NOT_FIRST=${badgedNot}(demote)  NA=${badgedNA}(remove)  INDET=${badgedIndet}`);
console.log('(These would be Derek-sign-off demote/remove candidates in a real flip round — pilot does NOT flip.)\n');
