#!/usr/bin/env node
/**
 * ft-constituent-catalog-match.mjs — Tier-0 catalog match for CONTAINER sub-works
 * (#2916 verification, sibling of scripts/eval/ft-catalog-match.mjs).
 *
 * FREE. No LLM/API calls — pure DB matching against the `translation_catalogs`
 * collection. The book-level matcher (ft-catalog-match.mjs) asks "does our catalog
 * already hold a prior English translation of this BOOK?"; this asks the same of
 * each CONSTITUENT in a container's `contents_works[]` (#2913/#2916). A
 * guard-passing match means a constituent the container decomposed into is NOT a
 * first — so it should not count toward firstTranslatedWorks. This is the cheap
 * first move of the per-constituent verification pass: the famous-canon containers
 * (Plato Opera → Meno/Phaedo…, Galen Operum, Corpus Hermeticum) demote for free,
 * before any paid Stage-1/Stage-2 verification of the obscure tail.
 *
 * MEASURED YIELD (2026-06-30, first run): 269 of 3,620 constituents are in
 * named-author containers (the rest are Various/anonymous → paid live-search tier);
 * 14 match a catalog row by title+author, 10 also pass the source-language guard,
 * but **0 pass the completeness guard** — only 172 of 23,756 catalog rows (1%) are
 * `completeness: complete`. So the FREE Tier-0 path currently demotes ~nothing: the
 * recall lever is metadata-blocked (catalog.completeness unset), same ceiling the
 * book-level matcher hits. This tool is correct + ready; it yields the moment the
 * catalog gets completeness backfilled, or feeds the paid tier in the meantime.
 *
 * SCOPE / HONESTY:
 *  - Constituents inherit the container's author. So this only runs on containers
 *    with a single NON-generic author (Plato, Galen, …). Multi-author "Various"
 *    containers can't be author-matched and are reported as `unverifiable_here`
 *    (NOT a gap — they fall through to the paid live-search tier).
 *  - Guards mirror ft-prior-guard.ts / ft-catalog-match.mjs exactly (anthology,
 *    completeness, source-language, namesake) so verdicts are consistent.
 *  - NEVER flips a flag or edits contents_works. Emits a reviewable report; with
 *    --apply, records `found` evidence in `first_translation_attempts` (idempotent),
 *    the same ledger the live producers feed. A demote stays Derek's sign-off.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-constituent-catalog-match.mjs                  # report only
 *   node scripts/eval/ft-constituent-catalog-match.mjs --sample 20      # + readable QA dump
 *   node scripts/eval/ft-constituent-catalog-match.mjs --apply          # report + record evidence
 *
 * Output:
 *   scripts/output/ft-constituent-catalog-match-<date>.json
 *   scripts/output/ft-constituent-catalog-match-<date>.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { appendAttempt } from '../lib/ft-attempt-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const DATE = new Date().toISOString().slice(0, 10);
const APPLY = process.argv.includes('--apply');
const SAMPLE = (() => { const i = process.argv.indexOf('--sample'); return i > -1 ? parseInt(process.argv[i + 1], 10) || 20 : 0; })();

// ── Text normalisation (mirrors ft-catalog-match.mjs / ft-prior-guard.ts) ───────
function normalise(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
const STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'for', 'are', 'was', 'been', 'have', 'has', 'its',
  'into', 'upon', 'also', 'very', 'more', 'some', 'such', 'than', 'being', 'over', 'both', 'each',
  'only', 'english', 'translation', 'translated', 'works', 'text',
  'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus',
]);
function sigTokens(s) { return normalise(s).split(/\s+/).filter((t) => t.length >= 4 && !STOP_WORDS.has(t)); }
function tokenOverlap(a, b) {
  const ta = new Set(sigTokens(a)); const tb = new Set(sigTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
function coverageDir(title, priorTitle) {
  const toks = sigTokens(title); const prior = new Set(sigTokens(priorTitle));
  if (!toks.length) return 0;
  return toks.filter((t) => prior.has(t)).length / toks.length;
}
// Bidirectional: constituent titles are verbose ("Meno, or On Virtue") while catalog
// titles are terse ("Meno"). Either full containment is a real signal — the guards
// (author/source-lang/completeness/namesake) backstop the looser direction.
function titleCoverage(title, priorTitle) {
  return Math.max(coverageDir(title, priorTitle), coverageDir(priorTitle, title));
}
const GENERIC_AUTHORS = new Set(['anonymous', 'anon', 'unknown', 'various', 'collective', 'multiple authors', 'catholic church', 'catholica romana ecclesia']);
function isGenericAuthor(a) { const n = normalise(a); return !n || GENERIC_AUTHORS.has(n) || n.length < 3 || /various|multiple|anonymous|collective|unknown/.test(n); }
// Strip editorial parentheticals/role-words that corrupt surname extraction —
// "Plato (Ficino translation)" must key on `plato`, not `translation`.
function cleanAuthor(author) {
  return (author || '')
    .replace(/\([^)]*\)/g, ' ')                                   // drop "(Ficino translation)"
    .replace(/\b(translation|translated|trans|edition|ed|editor|tr|attributed|pseudo)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
function extractSurname(author) {
  const raw = cleanAuthor(author); if (raw.includes(',')) return normalise(raw.split(',')[0]);
  const parts = normalise(raw).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';                           // mononym (Plato/Galen) → that token
}
const LANG_TO_ISO = {
  latin: 'la', 'latin-german': 'la', la: 'la', greek: 'grc', 'ancient greek': 'grc', 'classical greek': 'grc', grc: 'grc',
  german: 'de', dutch: 'nl', french: 'fr', italian: 'it', spanish: 'es', hebrew: 'he', arabic: 'ar',
  sanskrit: 'sa', tibetan: 'bo', chinese: 'zh', syriac: 'syc', armenian: 'hy', akkadian: 'akk',
};
function sourceIso({ original_language, language }) {
  for (const key of [normalise(original_language || ''), normalise(language || '')]) {
    if (!key) continue;
    if (LANG_TO_ISO[key]) return LANG_TO_ISO[key];
    const first = key.split(/[-\/, ]/)[0]; if (LANG_TO_ISO[first]) return LANG_TO_ISO[first];
  }
  return normalise(language || '') || normalise(original_language || '') || 'unknown';
}

// ── Guards (mirror ft-catalog-match.mjs) ────────────────────────────────────────
const ANTHOLOGY_KEYWORDS = ['anthology', 'collected works', 'collected letters', 'selected works', 'selected writings', 'selections from', 'reader', 'companion', 'works of', 'writings of', 'sources in', 'sourcebook', 'collected papers', 'complete works', 'miscellany', 'omnibus'];
function guardAnthology(title, row) {
  const t = normalise(row.english_title || ''); const w = normalise(row.canonical_work || '');
  const kw = ANTHOLOGY_KEYWORDS.find((k) => t.includes(k) || w.includes(k));
  if (!kw) return { pass: true, reason: 'no anthology keywords' };
  const cov = Math.max(titleCoverage(title, row.english_title || ''), titleCoverage(title, row.canonical_work || ''));
  if (cov >= 0.8) return { pass: true, reason: `kw "${kw}" but coverage=${cov.toFixed(2)} — likely this work` };
  return { pass: false, reason: `anthology kw "${kw}" coverage=${cov.toFixed(2)}` };
}
function guardComplete(row) {
  const c = (row.completeness || 'unknown').toLowerCase().trim();
  return c === 'complete' ? { pass: true, reason: 'completeness=complete' } : { pass: false, reason: `completeness="${row.completeness ?? 'unset'}"` };
}
function guardSourceLang(book, row) {
  const bookIso = sourceIso(book); const catIso = normalise(row.source_language || '');
  if (!catIso) return { pass: false, reason: 'catalog row has no source_language' };
  if (bookIso === 'unknown') return { pass: false, reason: `book source-language unknown ("${book.language}")` };
  if (bookIso === catIso) return { pass: true, reason: `source_language match (${catIso})` };
  return { pass: false, reason: `source-lang mismatch: ${bookIso} vs ${catIso}` };
}
function guardNamesake(author, row, aJac) {
  if (aJac >= 0.5) return { pass: true, reason: `author overlap=${aJac.toFixed(2)}` };
  const at = sigTokens(author || '');
  const catAuth = normalise([row.canonical_author, row.author, row.author_normalized].filter(Boolean).join(' '));
  const corrob = at.filter((t) => catAuth.includes(t));
  if (corrob.length >= 2) return { pass: true, reason: `author corroboration (${corrob.join('+')})` };
  return { pass: false, reason: `weak author signal (overlap=${aJac.toFixed(2)}) — possible namesake` };
}

const MIN_TITLE_COVERAGE = 0.6;
const MIN_AUTHOR_JACCARD = 0.34;

async function main() {
  await withMongo(async (db) => {
    // 1) load seeded containers + their inherited author/language
    const containers = await db.collection('books')
      .find({ 'contents_works_meta.provenance': 'chapter_index' })
      .project({ _id: 0, id: 1, title: 1, author: 1, language: 1, original_language: 1, work_id: 1, contents_works: 1 })
      .toArray();
    const totalConstituents = containers.reduce((a, b) => a + b.contents_works.length, 0);
    console.log(`Seeded containers: ${containers.length} | constituents: ${totalConstituents}`);

    // 2) load catalog rows (exclude the contaminated discovery harvest, #2885), index by surname
    const catRows = await db.collection('translation_catalogs')
      .find({ source: { $ne: 'ft_verification_discovery' } })
      .project({ _id: 1, source: 1, author: 1, author_normalized: 1, author_surname: 1, canonical_author: 1, english_title: 1, canonical_work: 1, translator: 1, pub_year: 1, publisher: 1, completeness: 1, source_language: 1, url: 1, source_url: 1 })
      .toArray();
    const bySurname = new Map();
    for (const row of catRows) {
      const sn = row.author_surname ? normalise(row.author_surname) : extractSurname(row.canonical_author || row.author);
      if (!sn || sn.length < 3) continue;
      (bySurname.get(sn) || bySurname.set(sn, []).get(sn)).push(row);
    }
    console.log(`Catalog rows: ${catRows.length} | surnames indexed: ${bySurname.size}\n`);

    // 3) match each constituent (author inherited from container)
    const demotes = []; // guard-passing prior found → constituent is NOT a first
    let scannedConstituents = 0, unverifiableContainers = 0, unverifiableConstituents = 0;

    for (const b of containers) {
      if (isGenericAuthor(b.author)) { unverifiableContainers++; unverifiableConstituents += b.contents_works.length; continue; }
      const sn = extractSurname(b.author);
      const candidates = (sn && sn.length >= 3) ? bySurname.get(sn) : null;
      if (!candidates?.length) { unverifiableContainers++; unverifiableConstituents += b.contents_works.length; continue; }

      const cleanAuth = cleanAuthor(b.author);
      b.contents_works.forEach((w, idx) => {
        scannedConstituents++;
        const pseudo = { language: w.source_language || b.language, original_language: b.original_language };
        let best = null;
        for (const row of candidates) {
          const tCov = Math.max(titleCoverage(w.title, row.english_title || ''), titleCoverage(w.title, row.canonical_work || ''));
          if (tCov < MIN_TITLE_COVERAGE) continue;
          const aJac = tokenOverlap(cleanAuth, [row.canonical_author, row.author].filter(Boolean).join(' '));
          if (aJac < MIN_AUTHOR_JACCARD) {
            const corrob = sigTokens(cleanAuth).filter((t) => normalise([row.canonical_author, row.author].filter(Boolean).join(' ')).includes(t));
            if (corrob.length < 2) continue;
          }
          const guards = { ANTHOLOGY: guardAnthology(w.title, row), COMPLETENESS: guardComplete(row), SOURCE_LANG: guardSourceLang(pseudo, row), NAMESAKE: guardNamesake(cleanAuth, row, aJac) };
          const allPass = Object.values(guards).every((g) => g.pass);
          const cand = { row, tCov, aJac, guards, allPass };
          if (!best || (cand.allPass && !best.allPass) || (cand.allPass === best.allPass && tCov > best.tCov)) best = cand;
        }
        if (best?.allPass) {
          demotes.push({
            book_id: b.id, work_id: b.work_id || null, container_title: b.title, container_author: b.author,
            constituent_index: idx, constituent_title: w.title,
            catalog_id: String(best.row._id), english_title: best.row.english_title, canonical_work: best.row.canonical_work,
            translator: best.row.translator, pub_year: best.row.pub_year, publisher: best.row.publisher,
            completeness: best.row.completeness, source: best.row.source, url: best.row.url || best.row.source_url || null,
            title_coverage: +best.tCov.toFixed(2), author_overlap: +best.aJac.toFixed(2),
          });
        }
      });
    }

    // 4) report
    const demoteContainers = new Set(demotes.map((d) => d.book_id)).size;
    console.log('── RESULT ──');
    console.log(`  scanned constituents (named-author containers): ${scannedConstituents}`);
    console.log(`  unverifiable here (generic/no-surname containers): ${unverifiableContainers} containers / ${unverifiableConstituents} constituents → paid live-search tier`);
    console.log(`  guard-passing PRIOR found (demote candidates): ${demotes.length} constituents across ${demoteContainers} containers`);
    console.log(`  → these constituents should NOT count toward firstTranslatedWorks.`);

    if (SAMPLE && demotes.length) {
      console.log(`\n── SAMPLE (${Math.min(SAMPLE, demotes.length)} demote candidates) ──`);
      const shuffled = [...demotes].sort(() => Math.random() - 0.5).slice(0, SAMPLE);
      for (const d of shuffled) {
        console.log(`  • "${d.constituent_title.slice(0, 44)}" in [${d.container_author}] ${d.container_title.slice(0, 34)}`);
        console.log(`      prior: ${d.translator || '?'}, ${d.pub_year || '?'} — "${(d.english_title || d.canonical_work || '').slice(0, 50)}" (cov ${d.title_coverage}, auth ${d.author_overlap})${d.url ? ' ' + d.url : ''}`);
      }
    }

    // 5) outputs
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonPath = path.join(OUT_DIR, `ft-constituent-catalog-match-${DATE}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ date: DATE, containers: containers.length, totalConstituents, scannedConstituents, unverifiableConstituents, demotes }, null, 2));
    const mdPath = path.join(OUT_DIR, `ft-constituent-catalog-match-${DATE}.md`);
    const byContainer = {};
    for (const d of demotes) (byContainer[d.book_id] = byContainer[d.book_id] || { t: d.container_title, a: d.container_author, items: [] }).items.push(d);
    const md = [`# Constituent catalog-match — ${DATE}`, '', `Scanned ${scannedConstituents} constituents in named-author containers; **${demotes.length} have a guard-passing prior** in our catalog (demote candidates) across ${demoteContainers} containers. ${unverifiableConstituents} constituents are in generic/Various containers (paid live-search tier).`, '',
      ...Object.values(byContainer).sort((x, y) => y.items.length - x.items.length).map((c) => `## ${c.a} — ${c.t}\n${c.items.map((d) => `- "${d.constituent_title}" → prior: ${d.translator || '?'}, ${d.pub_year || '?'} (${d.completeness}) ${d.url || ''}`).join('\n')}`)].join('\n');
    fs.writeFileSync(mdPath, md + '\n');
    console.log(`\nWrote ${jsonPath}\n      ${mdPath}`);

    // 6) evidence logging (still never flips a flag)
    if (APPLY) {
      let logged = 0;
      for (const d of demotes) {
        const ok = await appendAttempt(db, {
          attempt_id: `${d.book_id}#${d.constituent_index}:constituent_catalog:${d.catalog_id}`,
          book_id: d.book_id, work_id: d.work_id, date: new Date().toISOString(),
          method: 'constituent_catalog_match', match_key: 'author_title',
          constituent: { index: d.constituent_index, title: d.constituent_title },
          sources_checked: ['translation_catalogs'],
          queries: [[d.container_author, d.constituent_title].filter(Boolean).join(' ').trim()].filter(Boolean),
          result: 'found', found_refs: [d.catalog_id],
          priors: [{ english_title: d.english_title || undefined, translator: d.translator || undefined, pub_year: d.pub_year != null ? String(d.pub_year) : undefined, publisher: d.publisher || undefined, completeness: d.completeness || undefined, source_url: d.url || undefined }],
          evidence_strength: 'moderate', independence_score: 0.3, model: null,
          notes: `[constituent-registry-match] container "${d.container_title}" sub-work "${d.constituent_title}" has a guard-passing prior in translation_catalogs (${d.source || 'catalog'}); title_coverage=${d.title_coverage}, author_overlap=${d.author_overlap}`,
        });
        if (ok) logged++;
      }
      console.log(`Recorded ${logged} new constituent 'found' attempts (idempotent; ${demotes.length - logged} already present).`);
    } else {
      console.log('\n(report only — re-run with --apply to record evidence in first_translation_attempts; never flips a flag either way)');
    }
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
