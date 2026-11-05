#!/usr/bin/env node
/**
 * Step 1 of #7778 (as changed by Derek, 2026-10-30): STAGE the English translations the
 * n=1000 validation (#2684) found and the work-level matcher missed. Nothing is written to
 * `translation_catalogs` (it feeds the public first-translation badges and /census); merging
 * the staged rows is Derek's decision.
 *
 * PRIOR ART: scripts/translation-layer/01-build-external-works.mjs --staging (#7769) — the
 * reader and the row shape (source, source_id, url, orig_lang, orig_author, orig_title,
 * en_title, en_year, orig_year, snapshot) used here, so `01 --staging` picks these rows up
 * beside LoC / Open Library / Wikidata. The #7769 ingesters read catalogue dumps, not the
 * validation verdicts. scripts/enrichment/harvest-ft-into-translation-catalogs.mjs writes
 * the live table and is deliberately not used.
 *
 * Which works: pipeline-"gap" rows whose published consensus (gap-validation-n250-results.json)
 * says a prior English translation exists. A row is STAGED only if
 *   (a) at least two instruments (Gemini, Claude, Sonnet #7691, tie-break) say translated, and
 *   (b) a cited link loads (HTTP 200) and the page names the author or translator by surname,
 *       or two distinctive words of the translation's title.
 * (b) matters: Gemini's Google Books ids are often invented and resolve to another book
 * (8_9ZAAAAcAAJ, cited for Bolton's Florus, is Merivale's Lectures on Colonization).
 * The rest are kept in the provenance file as held, with the reason. Held is not a verdict.
 *
 * Matcher false positives (pipeline-"translated" rows the consensus says are NOT translated)
 * are recorded as cluster-level flags in the provenance file.
 *
 * Writes: eval-data/gap-validation-staged.jsonl     — the staged rows (committed)
 *         eval-data/gap-validation-catalog-rows.json — every candidate, verdicts, link checks,
 *                                                     held reasons, matcher false positives
 *         $TL_STAGING_DIR/gap_validation.jsonl       — only with --to-staging-dir (default
 *                                                     scripts/output/translation-staging/)
 * Usage:  node scripts/analysis/gap-validation-stage-translations.mjs [--to-staging-dir]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const OUT = path.join(EVAL, 'gap-validation-catalog-rows.json');
const TO_STAGING = process.argv.includes('--to-staging-dir');
const STAGED = path.join(EVAL, 'gap-validation-staged.jsonl');
const STAGING_DIR = process.env.TL_STAGING_DIR || path.join(__dir, '../output/translation-staging');
const SOURCE = 'gap_validation';
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EVAL, f), 'utf8'));
const rdl = (f) => fs.readFileSync(path.join(EVAL, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lastGood = (rows) => { const m = new Map(); for (const v of rows) if (v.translation_verdict !== 'FAIL' || !m.has(v.key)) m.set(v.key, v); return m; };

const results = rd('gap-validation-n250-results.json');
const frame = new Map(rd('gap-validation-n250-frame.json').works.map((w) => [w.key, w]));
const YEARS = rd('gap-validation-translation-years.json').years;
const INSTR = {
  gemini: lastGood(rdl('gap-validation-gemini-verdicts.jsonl')),
  claude: lastGood(rdl('gap-validation-claude-verdicts.jsonl')),
  sonnet: lastGood(rdl('gap-validation-sonnet-verdicts.jsonl')),
  tiebreak: new Map(rdl('gap-validation-tiebreak-verdicts.jsonl').map((r) => [r.key, r])),
};
const saysTranslated = (name, v) => !!v && (name === 'tiebreak' ? v.complete_prior_exists === true : v.translation_verdict === 'translated');

const deaccent = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP = new Set(['english', 'translation', 'translated', 'volume', 'edition', 'university', 'collected', 'history', 'histories', 'narrative', 'letters', 'treatise', 'contains', 'complete', 'principal', 'several', 'friends', 'excellent', 'famous', 'memorable', 'commentary', 'introduction', 'anonymous', 'unknown', 'fathers', 'province', 'english', 'dissertation', 'critical']);
const words = (s) => deaccent(s).toLowerCase().match(/[a-z]{6,}/g)?.filter((w) => !STOP.has(w)) || [];
const lastName = (s) => { const w = deaccent(s || '').toLowerCase().replace(/\([^)]*\)/g, '').split(/ and |;|,| et al/)[0].match(/[a-z]{4,}/g) || []; const l = w.at(-1); return l && !STOP.has(l) ? l : null; };

// a link counts if it loads and the page names the author or translator by surname, or two
// distinctive words of the translation's title (first names and generic words do not count)
async function checkLink(url, need) {
  if (!url || /vertexaisearch|grounding-api-redirect/.test(url)) return { url, ok: false, why: 'redirect' };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (SourceLibrary gap-validation; +https://sourcelibrary.org)' } });
    const body = deaccent((await r.text()).slice(0, 400000)).toLowerCase();
    clearTimeout(t);
    if (r.status !== 200) return { url, ok: false, why: `http ${r.status}` };
    const name = need.names.find((n) => body.includes(n));
    if (name) return { url, ok: true, matched: name };
    const tw = need.titleWords.filter((n) => body.includes(n));
    return tw.length >= 2 ? { url, ok: true, matched: tw.slice(0, 3).join('+') } : { url, ok: false, why: 'page does not name the work' };
  } catch (e) { return { url, ok: false, why: String(e.name || e.message).slice(0, 40) }; }
}

// "Translator, 1952, Title" (Gemini's format) → parts; anything else stays a citation string
function parsePrior(prior, key) {
  const p = (prior || '').trim();
  const m = p.match(/^([^,]{2,120}?),\s*(?:c\.\s*)?(1[4-9]\d\d|20[0-2]\d)(?:[–-]\d{2,4})?,\s*(.+)$/);
  if (m) return { translator: m[1].trim(), pub_year: m[2], english_title: m[3].replace(/^["“]|["”]$/g, '').trim().slice(0, 400) };
  return { translator: null, pub_year: YEARS[key] ? String(YEARS[key]) : null, english_title: p.slice(0, 400) };
}

async function main() {
  const candidates = results.rows.filter((r) => r.label === 'gap' && r.consensus === true);
  const falsePositives = results.rows.filter((r) => r.label === 'translated' && r.consensus === false);
  console.log(`matcher false negatives (consensus translated, pipeline gap): ${candidates.length}`);
  console.log(`matcher false positives (consensus untranslated, pipeline translated): ${falsePositives.length}`);

  const out = [];
  for (const r of candidates) {
    const w = frame.get(r.key);
    const verdicts = {};
    for (const [name, m] of Object.entries(INSTR)) {
      const v = m.get(r.key);
      if (v) verdicts[name] = { translated: saysTranslated(name, v), relationship: v.relationship || null, prior: v.prior || '', evidence_url: v.evidence_url || null };
    }
    const yes = Object.entries(verdicts).filter(([, v]) => v.translated);
    // the citation: tie-break first (it applied the completeness rule), then Gemini (structured), Claude, Sonnet
    const order = ['tiebreak', 'gemini', 'claude', 'sonnet'].filter((n) => verdicts[n]?.translated && verdicts[n].prior);
    const cite = verdicts[order[0]];
    const parsed = parsePrior(cite?.prior, r.key);
    const surname = (w.surname || '').toLowerCase();
    const need = {
      names: [...new Set([surname.length >= 4 && surname !== 'unknown' ? deaccent(surname) : null, lastName(parsed.translator)].filter(Boolean))],
      titleWords: [...new Set(words(parsed.english_title))].slice(0, 6),
    };
    // every URL a "translated" instrument cited, evidence_url first
    const urls = [...new Set(yes.flatMap(([n]) => {
      const v = n === 'tiebreak' ? INSTR.tiebreak.get(r.key) : INSTR[n].get(r.key);
      return [v.evidence_url, ...(v.sources || [])];
    }).filter(Boolean))].slice(0, 8);
    let link = null; const tried = [];
    for (const u of urls) { const c = await checkLink(u, need); tried.push(c); if (c.ok) { link = c; break; } }
    const allPartial = yes.every(([, v]) => v.relationship === 'partial');
    const unknownAuthor = !w.author || /^unknown$/i.test(w.surname || '');
    const compYear = [INSTR.claude.get(r.key), INSTR.gemini.get(r.key), INSTR.sonnet.get(r.key)].map((v) => v?.composition_year_est).find((y) => Number.isFinite(y)) ?? null;
    const row = {
      source: SOURCE,
      source_id: `n1000:${r.key}`,
      url: link?.url || null,
      orig_lang: 'latin',
      orig_author: unknownAuthor ? '' : w.author,
      orig_title: w.title || '',
      en_title: parsed.english_title || '',
      en_year: parsed.pub_year ? Number(parsed.pub_year) : null,
      orig_year: compYear,
      snapshot: '2026-06 (Gemini, Claude) + 2026-10 (Sonnet)',
      translator: parsed.translator,
      completeness: allPartial ? 'partial' : 'complete',
      work_cluster_id: w.work_cluster_id,
      instruments: yes.map(([n]) => n),
      evidence: 'scripts/analysis/eval-data/gap-validation-catalog-rows.json',
    };
    const reasons = [];
    if (yes.length < 2) reasons.push(`only ${yes.map(([n]) => n).join('/')} says translated`);
    if (!link) reasons.push('no cited link loads and names the work');
    if (!row.en_title) reasons.push('no citation text');
    out.push({ key: r.key, work_cluster_id: w.work_cluster_id, era: r.era, print_year: w.print_year_min, instruments_translated: yes.map(([n]) => n), verdicts, link_checks: tried, row, staged: reasons.length === 0, held_because: reasons });
    process.stdout.write(reasons.length ? 'h' : '+');
  }
  console.log();

  const staged = out.filter((o) => o.staged);
  console.log(`staged: ${staged.length}; held: ${out.length - staged.length}`);
  for (const o of out.filter((x) => !x.staged)) console.log(`  held ${o.key}: ${o.held_because.join('; ')}`);
  const jsonl = staged.map((o) => JSON.stringify(o.row)).join('\n') + '\n';
  fs.writeFileSync(STAGED, jsonl);
  console.log(`wrote ${path.relative(process.cwd(), STAGED)} (${staged.length} rows)`);
  if (TO_STAGING) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
    fs.writeFileSync(path.join(STAGING_DIR, 'gap_validation.jsonl'), jsonl);
    console.log(`wrote ${path.join(STAGING_DIR, 'gap_validation.jsonl')}`);
  }

  const fp = falsePositives.map((r) => {
    const w = frame.get(r.key);
    return { key: r.key, work_cluster_id: w.work_cluster_id, era: r.era, author: w.author, title: w.title, matched_sources: w.matched_sources, best_title_score: w.best_title_score,
      flag: 'matcher_false_positive',
      evidence: Object.fromEntries(Object.entries(INSTR).map(([n, m]) => [n, m.get(r.key)]).filter(([, v]) => v).map(([n, v]) => [n, { verdict: v.translation_verdict ?? v.complete_prior_exists, relationship: v.relationship || null, prior: (v.prior || '').slice(0, 300) }])) };
  });
  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10), issue: 7778, source_label: SOURCE,
    rule: 'stage iff pipeline-gap + published consensus translated + >=2 instruments translated + a cited link that loads and names the work',
    note: 'Not written to translation_catalogs (Derek, 2026-10-30). 37 rows this job inserted there after that note arrived, but before it was read, were deleted by id minutes later; the table is back to 40,538 rows.',
    staged: out.filter((o) => o.staged).length, held: out.filter((o) => !o.staged).length,
    false_negatives: out, matcher_false_positives: fp,
  }, null, 2));
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
