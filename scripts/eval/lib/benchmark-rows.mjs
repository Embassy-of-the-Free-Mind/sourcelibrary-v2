/**
 * benchmark-rows.mjs — read every scored benchmark file into one row per page × engine.
 *
 * PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs — this is its reader, moved here unchanged
 * (#5983) so the Pareto generator (build-ocr-pareto.mjs) reads exactly the rows the evidence table
 * reads, with the same refusal, corrected-reference and engine-selected rules. The dashboard's
 * self-check against the scorer's own summaries still runs over these rows.
 *
 * Reads only committed files: scripts/eval/results/benchmark/<stratum>-<date>.json (latest per
 * stratum), the sealed registry scripts/eval/benchmark/*.json, and the refusal record. $0, no DB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ENGINE } from './refusals.mjs';

const EVAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BENCHMARK_DIR = path.join(EVAL_DIR, 'results', 'benchmark');

export function readBenchmarkRows(DIR = BENCHMARK_DIR) {
  // ── read: one row per page × engine ──────────────────────────────────────────
  const files = fs.readdirSync(DIR).filter(f => /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary-')).sort();
  if (!files.length) throw new Error(`no scored benchmark files in ${DIR}`);
  // Latest file per stratum wins; older dates stay on disk as history.
  const latest = new Map();
  for (const f of files) latest.set(f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, ''), f);

  // The sealed registry (scripts/eval/benchmark/<stratum>.json) carries what the result files drop:
  // catalogue year, language, provider. Joined by slug.
  const REGISTRY_DIR = path.join(EVAL_DIR, 'benchmark');
  const registry = new Map();
  for (const f of fs.readdirSync(REGISTRY_DIR).filter(f => f.endsWith('.json'))) {
    // Not every file here is a page registry: numbers-en-5224.json keeps `pages` as a COUNT.
    const pages = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), 'utf8')).pages;
    for (const p of Array.isArray(pages) ? pages : []) registry.set(p.slug, p);
  }
  // First named language only: "Japanese; Chinese" → Japanese, "Ancient Greek" → Greek.
  const cleanLanguage = l => { if (!l) return null; const first = String(l).split(/[;,]/)[0].trim().replace(/^Ancient /, ''); return first || null; };
  const SCRIPT_OF = { Latin: 'Latin', English: 'Latin', French: 'Latin', Italian: 'Latin', Spanish: 'Latin', Dutch: 'Latin', German: 'Latin', Greek: 'Greek', Hebrew: 'Hebrew', Armenian: 'Armenian', Syriac: 'Syriac', Chinese: 'Han', Japanese: 'Japanese (kana + kanji)' };
  // German is Latin SCRIPT; the Fraktur stratum is a typeface class within it, kept visible as its own level.
  const scriptOf = (language, stratum) => (stratum === 'german-fraktur' ? 'Latin (Fraktur)' : SCRIPT_OF[language] || null);
  // CATALOGUE year: for a reprint or a modern edition this is the WORK's date, not the scan's
  // (#4884 — a "1716" Hagakure was a typeset reprint). Read period cells with that in mind.
  const periodOf = y => (typeof y !== 'number' || !Number.isFinite(y) ? null : y < 1500 ? 'before 1500' : y < 1600 ? '1500–1599' : y < 1700 ? '1600–1699' : y < 1800 ? '1700–1799' : y < 1900 ? '1800–1899' : '1900 on');

  // REFUSALS (#5581): a page the engine declined (Gemini RECITATION …) is not a misread. Three sources,
  // best first: the result file's own `refused` (scored after #5581); the refusal record
  // benchmark-score.mjs --refusals-only reads off the run meters (results/benchmark/refusals/), for
  // result files scored earlier; else an API engine with no content on a referenced page, labelled
  // inferred. Never inferred on an unreferenced page: Gemini returns genuinely empty STOP outputs.
  const REFUSAL_DIR = path.join(DIR, 'refusals');
  const refusalFiles = fs.existsSync(REFUSAL_DIR) ? fs.readdirSync(REFUSAL_DIR).filter(f => /^refusals-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
  const refusalRecord = refusalFiles.length ? JSON.parse(fs.readFileSync(path.join(REFUSAL_DIR, refusalFiles.at(-1)), 'utf8')) : null;
  function refusalOfRow(stratum, slug, engine, e, referenced, isTier) {
    if (typeof e.refused === 'boolean') return e.refused ? (e.refusal_source || 'finishReason') : null;
    const rec = refusalRecord?.strata?.[stratum]?.[engine];
    if (rec?.meter) return rec.refused?.[slug] ? 'finishReason' : (rec.inferred?.includes(slug) ? 'inferred' : null);
    if (!referenced || !API_ENGINE.test(engine)) return null;
    return (isTier ? e.chars === 0 : e.n_content === 0) ? 'inferred' : null;
  }

  // Strata whose pages were selected BY an engine's outcome; they never enter a pooled language/period cell.
  const SELECTED_ON_ENGINE = new Set(['refused-en-4686']);

  const rows = [];
  const sources = [];
  for (const [stratum, file] of latest) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    if (!Array.isArray(j.pages) || !j.summary) throw new Error(`${file}: expected {summary, pages[]}`);
    const isTier = stratum.startsWith('ref-');
    sources.push({ stratum, file, date: j.summary.date, n_pages: j.pages.length, issue: j.summary.issue ?? null });
    for (const p of j.pages) {
      for (const [engine, e] of Object.entries(p.engines)) {
        if (e.missing) continue; // the engine was never run on this page — not a failure of the engine
        const referenced = isTier ? true : !!p.has_ref;
        const refusal = refusalOfRow(stratum, p.slug, engine, e, referenced, isTier);
        // In a reference tier an unaligned page has no CER: the engine ran and could not be placed
        // against the reference. That is COVERAGE, and it must not vanish into a smaller n.
        const aligned = isTier ? !!e.aligned : true;
        const reg = registry.get(p.slug) || {};
        // A reference that is a CORRECTION of a served read (the #5695 T1 transcriptions sealed beside
        // latin-period-5126) leans toward the engine it was corrected from. It stays visible in its own
        // stratum/substratum rows and never enters a pooled language or period cell (#5126 prereg).
        const correctedRef = /corrected-OCR reference/.test(p.substratum ?? reg.substratum ?? '');
        // A stratum DRAWN ON an engine's behaviour (refused-en-4686: pages Gemini refused as RECITATION)
        // would put 20 certain refusals into the pooled English lite cells. Same rule: own rows only.
        const selected = correctedRef || SELECTED_ON_ENGINE.has(stratum);
        const language = selected ? null : cleanLanguage(p.language ?? reg.language);
        const year = selected ? null : (p.year ?? reg.year ?? null);
        rows.push({
          stratum, slug: p.slug, engine, referenced, aligned,
          substratum: p.substratum ?? null,
          script_class: p.script_class ?? null,
          language, year,
          script: scriptOf(language, stratum),
          period: periodOf(year),
          // vs reference if `referenced`, else vs the proxy engine. Unchanged by #5581: a sealed stratum
          // scores a refusal as CER 1.0, a reference tier leaves it unplaced (coverage). The
          // answered-only median below drops it either way.
          cer: aligned && typeof e.cer === 'number' ? e.cer : null,
          refused: !!refusal, refusal_inferred: refusal === 'inferred',
          loop: e.loop === true, empty: e.empty === true,
          invention: typeof e.invention_ref === 'number' ? e.invention_ref : (typeof e.invention === 'number' ? e.invention : null),
          // against the REFERENCE alone (null where no reference, or a reference tier, which does not score it)
          invention_ref: typeof e.invention_ref === 'number' ? e.invention_ref : null,
        });
      }
    }
  }
  const refusalFile = refusalFiles.length ? refusalFiles.at(-1) : null;
  return { rows, sources, latest, refusalRecord, refusalFile };
}
