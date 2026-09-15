#!/usr/bin/env node
// PRIOR ART: score-transcripts.mjs scores an ENGINE against a reference, and lib/metrics.mjs
// supplies the metric — both are reused here unchanged so the number lands on the same scale
// as the bench's accuracy figures. harvest-wikisource-gt.mjs BUILDS the references and
// lib/wikisource-text.mjs cleans them (also reused). Nothing in scripts/eval, scripts/audit or
// .claude/docs measures the REFERENCE itself: searched for "reference error", "pagequality",
// "ground truth error", "validated by two", read INDEX.md's lib table and EXPERIMENTS.md.
/**
 * reference-error-rate.mjs — how wrong is the ground truth?
 *
 * Every engine accuracy we quote is `1 − CER(reference, output)`. That number is only
 * meaningful if the reference is right. At 98–99% accuracy the residual is a few characters
 * per page, so a reference carrying errors of the same size means we are ranking engines
 * inside our own noise. This measures the reference.
 *
 * THE INSTRUMENT. Wikisource proofread pages carry their own second opinion. A page at
 * `<pagequality level="3">` was transcribed by ONE human; level 4 means a SECOND, different
 * human re-read it against the scan and corrected it. That second pass is a free, already-paid-
 * for independent re-transcription of the same image — the thing item 1 of the measurement
 * program asks for, without hand-transcribing anything and without asking a VLM to referee a
 * bench whose subject is VLMs.
 *
 *   A — VALIDATION DELTA.  text before the validator touched the page  vs  text at level 4.
 *       Estimates the error rate of a LEVEL-3 reference. Lower bound: the validator misses
 *       things too, and errors both humans share are invisible to this and to any other
 *       two-reader instrument.
 *   B — POST-VALIDATION DELTA.  first level-4 text  vs  today's text.
 *       Any later correction is proof that level 4 was not error-free. Lower bound on the
 *       level-4 residual, and a loose one: it only counts errors somebody happened to find.
 *
 * Both are computed after `normalizeForScript`, the SAME folding the bench scores through
 * (long-s→s, æ→ae, v/u, j/i, diacritics stripped, Greek accents folded, punctuation and case
 * discarded). So Wikisource house-style modernisation — the loudest difference between a
 * transcription and the printed page — is already neutralised on both sides, and what this
 * measures is what the scorer would actually have charged an engine for: wrong, missing and
 * extra letters.
 *
 * WHAT IT CANNOT SEE. Errors both readers make (a shared misreading, a shared house-style
 * convention), and pages nobody validated. It also inherits the harvest's selection: pages
 * volunteers chose to transcribe AND chose to validate are the well-loved ones, so if
 * anything this UNDERSTATES the error rate of the level-3 pages that make up most of the set.
 *
 *   node scripts/eval/reference-error-rate.mjs                        # the pinned GT set
 *   node scripts/eval/reference-error-rate.mjs --gt-dir=ground-truth-ws --lang=Greek
 *   node scripts/eval/reference-error-rate.mjs --harvest=scripts/eval/ground-truth-wikisource/la-1450-1900.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { cleanPageText, pageQuality } from './lib/wikisource-text.mjs';
import { levenshtein, normalizeForScript } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };

const GT_DIR = argOf('gt-dir', 'ground-truth-ws');
const HARVEST = argOf('harvest', null);                     // comma-separated harvest files
const WITH_GT = process.argv.includes('--with-gt');         // ...plus the pinned set
const LANG = argOf('lang', null);
const LIMIT = parseInt(argOf('limit', '0'), 10);
const OUT = argOf('out', path.join(__dirname, 'results', `reference-error-${new Date().toISOString().slice(0, 10)}.json`));
const SLEEP_MS = parseInt(argOf('sleep', '120'), 10);

const UA = 'SourceLibrary-GT-Audit/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) node-fetch';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SCRIPT_BY_WIKI = { la: 'latin', de: 'latin', en: 'latin', fr: 'latin', it: 'latin', el: 'greek' };
const LANG_BY_WIKI = { la: 'Latin', de: 'German', el: 'Greek', en: 'English', fr: 'French', it: 'Italian' };
// Bots retitle, reformat and touch pages long after validation. Their edits are not human
// corrections; they survive into instrument B only if they changed LETTERS, which is itself
// worth seeing, so they are flagged rather than dropped.
const BOT_RE = /bot\b|bot$/i;

// ── page list ──────────────────────────────────────────────────────

/** `https://de.wikisource.org/wiki/Seite%3A95%20Thesen.pdf%2F3` → {wiki, title} */
function parseSourceUrl(url) {
  const m = (url || '').match(/^https:\/\/([a-z-]+)\.wikisource\.org\/wiki\/(.+)$/);
  if (!m) return null;
  return { wiki: m[1], title: decodeURIComponent(m[2]).replace(/_/g, ' ') };
}

function loadPages() {
  const out = [];
  if (HARVEST) {
    for (const f of HARVEST.split(',').map(s => s.trim()).filter(Boolean)) {
      const d = JSON.parse(fs.readFileSync(path.isAbsolute(f) ? f : path.join(process.cwd(), f), 'utf8'));
      for (const p of d.pages || []) {
        const src = parseSourceUrl(p.source_url);
        if (!src) continue;
        out.push({ slug: p.slug, ...src, script: SCRIPT_BY_WIKI[p.wiki] || 'latin',
          language: LANG_BY_WIKI[p.wiki] || p.wiki, year: p.year, harvestedLevel: p.quality_level, fidelity: p.fidelity });
      }
    }
  }
  if (!HARVEST || WITH_GT) {
    const dir = path.join(__dirname, GT_DIR);
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_manifest.json').sort()) {
      const gt = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const src = parseSourceUrl(gt.source_url);
      if (!src) continue;                                   // non-Wikisource tiers have no revision history to read
      out.push({ slug: f.replace(/\.json$/, ''), ...src, script: gt.script || 'latin',
        language: gt.language, year: gt.year, harvestedLevel: gt.quality_level, fidelity: gt.fidelity,
        referenceChars: (gt.ocr_ground_truth || '').length });
    }
  }
  // The harvest wrote one file per slug but a slug can repeat across harvest files.
  const seen = new Set();
  return out.filter(p => (seen.has(p.slug) ? false : seen.add(p.slug)));
}

// ── API ────────────────────────────────────────────────────────────

async function api(wiki, params) {
  const base = `https://${wiki}.wikisource.org/w/api.php`;
  const qs = new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
  for (let attempt = 0; attempt < 6; attempt++) {
    // POST always: revision-content queries with non-Latin titles overrun the GET URL limit
    // on el.wikisource (observed 414 in the harvester), and the read query is POST-safe.
    const r = await fetch(base, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs });
    if (r.status === 429 || r.status >= 500) {
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      await sleep(Math.max(ra * 1000, 2000 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${wiki} ${params.titles || ''}`);
    return r.json();
  }
  throw new Error(`giving up after retries: ${wiki}`);
}

/** Full revision history, oldest first, with content. Anonymous content queries cap at 50/page. */
async function fetchRevisions(wiki, title) {
  const revs = [];
  let cont;
  for (let page = 0; page < 6; page++) {
    const j = await api(wiki, {
      action: 'query', prop: 'revisions', titles: title,
      rvprop: 'ids|timestamp|user|comment|content', rvslots: 'main',
      rvlimit: '50', rvdir: 'newer', ...(cont ? { rvcontinue: cont } : {}),
    });
    const p = j.query?.pages?.[0];
    if (!p || p.missing) return null;
    for (const r of p.revisions || []) {
      const wikitext = r.slots?.main?.content || '';
      revs.push({
        revid: r.revid, ts: r.timestamp, user: r.user, comment: r.comment || '',
        level: pageQuality(wikitext),
        // `<pagequality … user="X">` names who set the CURRENT level, which is how a
        // revision that merely re-saves the page is told from one that graded it.
        levelUser: (wikitext.match(/<pagequality[^>]*user="([^"]*)"/) || [])[1] || null,
        text: cleanPageText(wikitext),
        // The pre-2026-09-05 cleaner, kept only to price what it deleted. Measuring the
        // human deltas with it would have charged validators for template churn: swapping
        // {{SperrSchrift|…}} for ''…'' looked like a whole line being added.
        textLegacy: cleanPageText(wikitext, { legacyTemplates: true }),
      });
    }
    cont = j.continue?.rvcontinue;
    if (!cont) break;
  }
  return revs;
}

// ── metrics ────────────────────────────────────────────────────────

const letters = (s, script) => normalizeForScript(s || '', script).replace(/ /g, '');
const words = (s, script) => normalizeForScript(s || '', script).split(' ').filter(Boolean);

/** Symmetric CER on the bench's own normalization. Neither side is "truth" — both are humans. */
function charDelta(a, b, script) {
  const A = letters(a, script), B = letters(b, script);
  const n = Math.max(A.length, B.length);
  if (!n) return { cer: 0, dist: 0, units: 0 };
  const dist = levenshtein(A, B);
  return { cer: dist / n, dist, units: n };
}

function wordDelta(a, b, script) {
  const A = words(a, script), B = words(b, script);
  const n = Math.max(A.length, B.length);
  if (!n) return { wer: 0, dist: 0, units: 0 };
  return { wer: levenshtein(A, B) / n, dist: levenshtein(A, B), units: n };
}

/**
 * Word-level change hunks, so the number can be READ and not just quoted. A validator
 * fixing three letters and a validator restoring an omitted line produce the same CER at
 * different page lengths; only the hunks tell you which happened.
 */
function hunks(a, b, script, maxHunks = 6) {
  const A = words(a, script), B = words(b, script);
  if (A.length > 1200 || B.length > 1200) return [{ note: 'page too long to diff' }];
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0, del = [], ins = [];
  const flush = () => {
    if (del.length || ins.length) out.push({ before: del.join(' '), after: ins.join(' ') });
    del = []; ins = [];
  };
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { flush(); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) del.push(A[i++]);
    else ins.push(B[j++]);
  }
  while (i < A.length) del.push(A[i++]);
  while (j < B.length) ins.push(B[j++]);
  flush();
  return out.sort((x, y) => (y.before.length + y.after.length) - (x.before.length + x.after.length)).slice(0, maxHunks);
}

// ── per-page analysis ──────────────────────────────────────────────

function analyse(page, revs) {
  const r = { ...page, revisions: revs.length, currentLevel: revs.length ? revs[revs.length - 1].level : null };
  const firstL4 = revs.findIndex(v => (v.level ?? 0) >= 4);
  r.reachedLevel4 = firstL4>= 0;

  if (firstL4 > 0) {
    const validator = revs[firstL4].levelUser || revs[firstL4].user;
    // Everything the validator did, not just the edit that flipped the flag: validators
    // routinely correct in one save and grade in the next, and anchoring on the flag alone
    // credits their own corrections to the proofreader and reports a near-zero delta.
    let start = firstL4;
    while (start > 0 && revs[start - 1].user === validator) start--;
    const before = revs[start - 1];
    const proofreader = before.levelUser || before.user;
    const c = charDelta(before.text, revs[firstL4].text, page.script);
    const w = wordDelta(before.text, revs[firstL4].text, page.script);
    r.validation = {
      measurable: true,
      independent: proofreader !== validator,
      proofreader, validator,
      priorLevel: before.level,
      days: Math.round((Date.parse(revs[firstL4].ts) - Date.parse(before.ts)) / 86400000),
      charUnits: c.units, charDist: c.dist, cer: c.cer, wordUnits: w.units, wer: w.wer,
      cerLegacyCleaner: charDelta(before.textLegacy, revs[firstL4].textLegacy, page.script).cer,
      hunks: c.dist ? hunks(before.text, revs[firstL4].text, page.script) : [],
    };
  } else {
    r.validation = { measurable: false,
      reason: firstL4 === 0 ? 'page created already at level 4 (no level-3 stage in history)'
        : 'never validated — still level 3 or below' };
  }

  if (firstL4 >= 0 && firstL4 < revs.length - 1) {
    const last = revs[revs.length - 1];
    const c = charDelta(revs[firstL4].text, last.text, page.script);
    const editors = [...new Set(revs.slice(firstL4 + 1).map(v => v.user))];
    r.postValidation = {
      measurable: true, cer: c.cer, charDist: c.dist, charUnits: c.units,
      edits: revs.length - firstL4 - 1, editors,
      allBots: editors.length > 0 && editors.every(u => BOT_RE.test(u)),
      cerLegacyCleaner: charDelta(revs[firstL4].textLegacy, last.textLegacy, page.script).cer,
      hunks: c.dist ? hunks(revs[firstL4].text, last.text, page.script) : [],
    };
  } else {
    r.postValidation = { measurable: false, reason: firstL4 < 0 ? 'never validated' : 'no edits after validation' };
  }

  // C — how much PRINTED text the old cleaner deleted from this reference, as a share of
  // the page. Not a human error at all: our own bug, and the largest of the three.
  const cur = revs[revs.length - 1];
  const kept = letters(cur.text, page.script).length;
  const legacy = letters(cur.textLegacy, page.script).length;
  r.templateLoss = { referenceChars: kept, legacyChars: legacy, lostChars: kept - legacy,
    lostShare: kept ? (kept - legacy) / kept : 0 };
  return r;
}

// ── stats ──────────────────────────────────────────────────────────

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** Percentile bootstrap on the MEAN, seeded so the interval is reproducible. */
function bootstrapCI(xs, iters = 4000, seed = 20260904) {
  if (xs.length < 3) return null;
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const means = [];
  for (let b = 0; b < iters; b++) {
    let acc = 0;
    for (let i = 0; i < xs.length; i++) acc += xs[Math.floor(rnd() * xs.length)];
    means.push(acc / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * iters)], means[Math.floor(0.975 * iters)]];
}

/**
 * Char-weighted pooled rate — total corrected characters over total characters read. This is
 * the number that composes with an engine CER; the mean-over-pages is the number that answers
 * "how wrong is a typical reference page". They differ whenever page length correlates with
 * error, so both are reported.
 */
function summarize(rows) {
  const cers = rows.map(r => r.cer);
  const dist = rows.reduce((a, r) => a + r.charDist, 0);
  const units = rows.reduce((a, r) => a + r.charUnits, 0);
  return {
    n: rows.length,
    pooled_cer: units ? dist / units : null,
    mean_cer: cers.length ? cers.reduce((a, b) => a + b, 0) / cers.length : null,
    median_cer: median(cers),
    p90_cer: quantile(cers, 0.9),
    max_cer: cers.length ? Math.max(...cers) : null,
    clean_pages: rows.filter(r => r.charDist === 0).length,
    ci95_mean: bootstrapCI(cers),
    total_chars: units, total_changed_chars: dist,
  };
}

// ── run ────────────────────────────────────────────────────────────

let pages = loadPages();
if (LANG) pages = pages.filter(p => (p.language || '').toLowerCase().startsWith(LANG.toLowerCase()));
if (LIMIT) pages = pages.slice(0, LIMIT);
console.log(`reference-error-rate — ${pages.length} pages from ${HARVEST || GT_DIR}\n`);

const results = [];
let failed = 0;
for (const [i, p] of pages.entries()) {
  try {
    const revs = await fetchRevisions(p.wiki, p.title);
    if (!revs || !revs.length) { failed++; console.log(`  !  ${p.slug}: no revisions`); continue; }
    const r = analyse(p, revs);
    results.push(r);
    const v = r.validation.measurable
      ? `Δ${(r.validation.cer * 100).toFixed(2)}% (${r.validation.charDist}/${r.validation.charUnits} chars${r.validation.independent ? '' : ', SELF-validated'})`
      : `— ${r.validation.reason}`;
    console.log(`  ${String(i + 1).padStart(3)}/${pages.length} L${r.currentLevel} ${p.slug.slice(0, 46).padEnd(46)} ${v}`);
  } catch (e) {
    failed++;
    console.log(`  !  ${p.slug}: ${e.message.slice(0, 70)}`);
  }
  await sleep(SLEEP_MS);
}

// Only INDEPENDENT validations measure a second reader. A page its own transcriber marked
// validated is one reader twice and tells us nothing about reference error.
// A LEVEL-1 predecessor is raw uncorrected OCR, not a proofread transcription: measuring
// against it prices the whole proofreading pass, not the residual error of a level-3
// reference, and one such page carried a 10.9% delta into an otherwise 1.1% Latin sample.
const A = results.filter(r => r.validation.measurable && r.validation.independent && r.validation.priorLevel === 3);
const excludedPriorLevel = results.filter(r => r.validation.measurable && r.validation.independent && r.validation.priorLevel !== 3).length;
const B = results.filter(r => r.postValidation.measurable);

const byLang = (rows, pick) => Object.fromEntries(
  Object.entries(rows.reduce((a, r) => { (a[r.language] ||= []).push(pick(r)); return a; }, {}))
    .map(([k, v]) => [k, summarize(v)]));

const report = {
  generated_at: new Date().toISOString(),
  source: HARVEST || GT_DIR,
  metric: 'symmetric char-level Levenshtein after normalizeForScript (same folding the bench scores through), space-stripped',
  pages_examined: results.length,
  fetch_failures: failed,
  composition: {
    by_current_level: results.reduce((a, r) => { a[`L${r.currentLevel}`] = (a[`L${r.currentLevel}`] || 0) + 1; return a; }, {}),
    by_language_level: results.reduce((a, r) => { const k = `${r.language} L${r.currentLevel}`; a[k] = (a[k] || 0) + 1; return a; }, {}),
    never_validated: results.filter(r => !r.reachedLevel4).length,
    self_validated: results.filter(r => r.validation.measurable && !r.validation.independent).length,
    excluded_prior_level_not_3: excludedPriorLevel,
  },
  instrument_A_validation_delta: {
    what: 'error rate of a LEVEL-3 reference — what an independent second reader changed',
    bound: 'LOWER bound: the validator misses errors too, and errors both readers share are invisible',
    pooled: summarize(A.map(r => r.validation)),
    by_language: byLang(A, r => r.validation),
  },
  instrument_B_post_validation_delta: {
    what: 'residual in a LEVEL-4 reference — corrections made AFTER two humans signed off',
    bound: 'LOWER bound, and a loose one: it counts only errors somebody later happened to find',
    pooled: summarize(B.map(r => r.postValidation)),
    by_language: byLang(B, r => r.postValidation),
    bot_only_pages: B.filter(r => r.postValidation.allBots).length,
  },
  instrument_C_template_payload_loss: {
    what: 'printed text the pre-2026-09-05 cleaner deleted along with its formatting template',
    bound: 'exact for these pages — it is a diff of our own two cleaners, not an estimate',
    by_language: Object.fromEntries(Object.entries(
      results.reduce((a, r) => { (a[r.language] ||= []).push(r.templateLoss); return a; }, {}))
      .map(([k, v]) => [k, {
        n: v.length,
        pooled_share: v.reduce((a, t) => a + t.lostChars, 0) / Math.max(1, v.reduce((a, t) => a + t.referenceChars, 0)),
        pages_losing_5plus_chars: v.filter(t => t.lostChars >= 5).length,
        worst_page_share: Math.max(...v.map(t => t.lostShare)),
        total_lost_chars: v.reduce((a, t) => a + t.lostChars, 0),
      }])),
  },
  pages: results,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');

const pct = (x) => x == null ? '  n/a' : `${(x * 100).toFixed(2)}%`;
const line = (label, s) => console.log(`  ${label.padEnd(12)} n=${String(s.n).padStart(3)}  pooled=${pct(s.pooled_cer).padStart(7)}  mean=${pct(s.mean_cer).padStart(7)}  median=${pct(s.median_cer).padStart(7)}  p90=${pct(s.p90_cer).padStart(7)}  clean=${s.clean_pages}/${s.n}${s.ci95_mean ? `  CI95[${pct(s.ci95_mean[0])}, ${pct(s.ci95_mean[1])}]` : ''}`);

console.log(`\n── composition ──`);
console.log(`  ${JSON.stringify(report.composition.by_language_level)}`);
console.log(`  never validated: ${report.composition.never_validated}/${results.length}   self-validated (excluded): ${report.composition.self_validated}`);

const meanOf = (rows, f) => (rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : null);
console.log(`\n── A: what an independent second reader changed (error rate of a LEVEL-3 reference) ──`);
line('POOLED', report.instrument_A_validation_delta.pooled);
for (const [k, s] of Object.entries(report.instrument_A_validation_delta.by_language)) line(k, s);
console.log(`  measured through the OLD cleaner the same delta reads mean=${pct(meanOf(A, r => r.validation.cerLegacyCleaner))} — template churn masquerading as human correction`);

console.log(`\n── B: corrections after two humans signed off (residual in a LEVEL-4 reference) ──`);
line('POOLED', report.instrument_B_post_validation_delta.pooled);
for (const [k, s] of Object.entries(report.instrument_B_post_validation_delta.by_language)) line(k, s);
console.log(`  measured through the OLD cleaner: mean=${pct(meanOf(B, r => r.postValidation.cerLegacyCleaner))}`);

console.log(`\n── C: printed text the OLD cleaner deleted with its formatting template (our bug, not theirs) ──`);
for (const [k, s] of Object.entries(report.instrument_C_template_payload_loss.by_language)) {
  console.log(`  ${k.padEnd(12)} n=${String(s.n).padStart(3)}  ${pct(s.pooled_share).padStart(7)} of reference letters  (${s.total_lost_chars} chars; ${s.pages_losing_5plus_chars}/${s.n} pages hit; worst page ${pct(s.worst_page_share)})`);
}

const worst = A.filter(r => r.validation.charDist > 0).sort((a, b) => b.validation.cer - a.validation.cer).slice(0, 8);
if (worst.length) {
  console.log(`\n── largest validation deltas (what validators actually fix) ──`);
  for (const r of worst) {
    console.log(`  ${pct(r.validation.cer).padStart(7)}  ${r.slug.slice(0, 52)}`);
    for (const h of r.validation.hunks.slice(0, 3)) {
      console.log(`            "${(h.before || '∅').slice(0, 60)}" → "${(h.after || '∅').slice(0, 60)}"`);
    }
  }
}
console.log(`\nWrote ${OUT}`);
