/**
 * Stage A — structural pre-filter for the first-translation census (#2780).
 *
 * The cheapest, highest-leverage filter in the methodology funnel
 * (`.claude/docs/first-translation-census-methodology.md`, Stage A): among the
 * books that currently carry a public "First Translation" badge, find the ones
 * whose claim is *structurally ill-posed* and needs NO web research to settle —
 * artworks, multi-work containers (Opera Omnia / Sammlung / Collected Works /
 * miscellanies), and English-original editions. The badged-set audit found
 * ~30% of badge errors are exactly these.
 *
 * This script is REPORT-ONLY. It never writes a verdict or flips a flag. It
 * surfaces sign-off-ready demote candidates with a reason + confidence tier.
 * The canonical apply path (after Derek's sign-off) is unchanged:
 *   1. write `book.first_translation = { verdict: 'not_applicable', ... }`
 *      (verdict-only writer — ft-ingest-verdicts.ts), append to
 *      first_translation_attempts,
 *   2. run reconcile-first-translation-flag.ts --apply (the ONLY flag writer).
 * `not_applicable` is not in FIRST_FAMILY, so the reconcile demotes the badge.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-structural-prefilter.mjs            # full report -> scripts/output/
 *   node scripts/eval/ft-structural-prefilter.mjs --limit 50 # sample
 */
import { withMongo } from '../lib/mongo.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const LIMIT = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

const NON_ENGLISH = { $nin: [null, 'en', 'eng', 'English', 'english', 'en-US', 'en-GB'] };
const ENGLISH_TAGS = ['en', 'eng', 'English', 'english', 'en-US', 'en-GB'];

// ── Container title heuristics ──────────────────────────────────────────────
// A title pattern that signals a multi-work container (collected works,
// miscellany, anthology, catalogue) — a "first translation of THIS work" claim
// is ill-posed because there is no single work. Tuned to avoid the obvious
// false positive: French "opéra-comique" (a musical genre, not Latin "opera").
const CONTAINER_PATTERNS = [
  // Latin "Opera" only in collected-works contexts, never bare "opera comique"
  { key: 'opera_omnia', re: /\bopera\s+(omnia|quae\s+supersunt|quae\s+exstant|posthuma|theologica|philosophica|chymica|chemica|medica|mathematica|moralia)\b/i },
  { key: 'opera_omnia', re: /\bomnia\s+opera\b/i },
  { key: 'opera_omnia', re: /\bopera\b.{0,20}\b(oder\s+alle\s+b[üu]cher|tomus|tomi)\b/i },
  // German collections
  { key: 'sammlung', re: /\bsammlung(en)?\b/i },
  { key: 'gesammelte', re: /\bges(ammelte|amte)\s+(werke|schriften|briefe)\b/i },
  { key: 'saemtliche', re: /\bs[äa]mtliche\s+(werke|schriften|briefe)\b/i },
  // Florilegia / miscellanies / anthologies (any language)
  { key: 'florilegium', re: /\bflorileg/i },
  { key: 'miscellany', re: /\bmiscellan(y|ies|ea|eous)\b/i },
  { key: 'anthology', re: /\bantholog(y|ie|ia)\b/i },
  // English collected forms
  { key: 'collected_works', re: /\b(collected|complete|selected)\s+(works|writings|letters|poems|treatises|essays)\b/i },
  { key: 'collected_works', re: /\bcollected\s+works\s+of\b/i },
  // Catalogues / registers (a list of holdings, never a translated work)
  { key: 'catalogue', re: /\b(verzeichniss?|katalog|catalogue|catalog)\b/i },
];

// Deterministic source-language hint from the title itself, for the cases where
// `original_language` is unset but the title is unambiguous: a non-Latin script,
// or an explicit `[Hebrew: ...]` cataloguer prefix. Used only to re-route an
// English-tagged book away from "demote" and toward "fix the tag".
function titleLanguageHint(title) {
  const m = title.match(/^\s*\[\s*([A-Za-z]+)\s*:/); // "[Hebrew: ...]" prefix
  if (m) return m[1];
  if (/[֐-׿]/.test(title)) return 'Hebrew';
  if (/[Ѐ-ӿ]/.test(title)) return 'Cyrillic';
  if (/[؀-ۿ]/.test(title)) return 'Arabic';
  if (/[Ͱ-Ͽ]/.test(title)) return 'Greek';
  if (/[一-鿿぀-ヿ가-힯]/.test(title)) return 'CJK';
  return null;
}

function classify(b) {
  const reasons = [];
  const title = b.title || '';

  // HIGH — content type says it isn't a paginated text at all (a map, print,
  // sculpture). A "first translation" badge on an art object is ill-posed.
  if (b.content_type === 'artwork') {
    reasons.push({ category: 'artwork', confidence: 'high', detail: `content_type=artwork (resource_type=${b.resource_type ?? '?'})` });
  }

  // language=English does NOT mean English-original. The `language` field is the
  // SOURCE language and is sometimes wrong: many such books carry a correct
  // `original_language` of Latin/Sanskrit/etc — they are genuine non-English
  // firsts with a bad tag. Demoting them would strip real firsts (the exact
  // "assert beyond verification" failure mode). So split by original_language:
  if (ENGLISH_TAGS.includes(b.language)) {
    const orig = b.original_language;
    const titleHint = titleLanguageHint(title);
    if (orig && !ENGLISH_TAGS.includes(orig)) {
      // Mislabel — fix the `language` field, KEEP the badge, do NOT demote.
      // (This also wrongly excludes the book from the eligible-set count.)
      reasons.push({ category: 'language_mislabel', confidence: 'audit', detail: `language=English but original_language=${orig} — fix tag, do NOT demote` });
    } else if (titleHint) {
      // No original_language, but the title's own script betrays a non-English
      // source — almost certainly a mislabel too. Fix the tag, do NOT demote.
      reasons.push({ category: 'language_mislabel', confidence: 'audit', detail: `language=English but title is ${titleHint} script/marker — likely mislabel, fix tag, do NOT demote` });
    } else {
      // No corrective signal — might be a genuine English original (ill-posed
      // FT) OR an untagged source language. Needs a look, not an auto-demote.
      reasons.push({ category: 'english_suspect', confidence: 'medium', detail: `language=English, original_language=${orig ?? 'unset'} — verify source language` });
    }
  }

  // MEDIUM — title signals a multi-work container. Needs a human eye (a few
  // "Collected Works of X" CAN be a genuine first translation of the collection
  // as a unit), so it is a candidate, not an auto-demote.
  for (const p of CONTAINER_PATTERNS) {
    if (p.re.test(title)) {
      reasons.push({ category: `container:${p.key}`, confidence: 'medium', detail: `title matches /${p.re.source.slice(0, 40)}/` });
      break;
    }
  }

  return reasons;
}

await withMongo(async (db) => {
  const books = db.collection('books');
  const query = {
    is_first_translation: true,
    visible: true,
    pages_translated: { $gt: 0 },
    language: NON_ENGLISH,
  };
  // Note: English-tagged badged books are queried separately (the NON_ENGLISH
  // filter above excludes them by design) so the count is honest.
  const proj = { _id: 0, id: 1, title: 1, author: 1, language: 1, original_language: 1, content_type: 1, resource_type: 1, work_id: 1 };
  const englishBadged = await books.find(
    { is_first_translation: true, visible: true, pages_translated: { $gt: 0 }, language: { $in: ENGLISH_TAGS } },
    { projection: proj },
  ).toArray();

  const cursor = books.find(query, { projection: proj });
  if (LIMIT) cursor.limit(LIMIT);

  const candidates = [];
  let scanned = 0;
  for await (const b of cursor) {
    scanned++;
    const reasons = classify(b);
    if (reasons.length) candidates.push({ ...b, reasons });
  }
  // English-tagged badged: run the same classifier (splits mislabel vs suspect
  // via original_language) instead of a blanket demote.
  for (const b of englishBadged) {
    const reasons = classify(b);
    if (reasons.length) candidates.push({ ...b, reasons });
  }

  // ── Tally ──────────────────────────────────────────────────────────────
  const byCategory = {};
  const byConfidence = { high: 0, medium: 0, audit: 0 };
  for (const c of candidates) {
    const top = c.reasons[0];
    byConfidence[top.confidence] = (byConfidence[top.confidence] || 0) + 1;
    const cat = top.category.split(':')[0];
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  const total = scanned + englishBadged.length;
  const summary = {
    generated: new Date().toISOString(),
    scanned_badged_eligible: scanned,
    english_tagged_badged: englishBadged.length,
    total_badged_examined: total,
    structural_candidates: candidates.length,
    by_confidence: byConfidence,
    by_category: byCategory,
  };

  console.log('\n=== Stage A — structural pre-filter (REPORT ONLY) ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nTop sample per category:');
  for (const cat of Object.keys(byCategory)) {
    const ex = candidates.filter((c) => c.reasons[0].category.split(':')[0] === cat).slice(0, 6);
    console.log(`\n[${cat}] (${byCategory[cat]})`);
    for (const e of ex) console.log(`  ${e.id}  [${e.language}] ${(e.author || '').slice(0, 24)} — ${(e.title || '').slice(0, 64)}`);
  }

  // ── Write artifacts ──────────────────────────────────────────────────────
  const stamp = new Date().toISOString().slice(0, 10);
  const outJson = `scripts/output/ft-structural-prefilter-${stamp}.json`;
  const outMd = `scripts/output/ft-structural-prefilter-${stamp}.md`;
  mkdirSync(dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify({ summary, candidates }, null, 2));

  const lines = [];
  lines.push(`# Stage A — structural pre-filter (first-translation census #2780)`);
  lines.push('');
  lines.push(`Generated ${summary.generated}. **Report only — no badges changed.**`);
  lines.push('');
  lines.push(`Examined **${total}** badged books (${scanned} non-English-tagged + ${englishBadged.length} English-tagged).`);
  lines.push(`Found **${candidates.length}** structurally ill-posed badge claims that need no web research.`);
  lines.push('');
  lines.push(`By confidence: ${JSON.stringify(byConfidence)}`);
  lines.push('');
  lines.push(`| category | count | meaning |`);
  lines.push(`|---|---|---|`);
  const meaning = {
    artwork: 'content_type=artwork (map/print/object) — not a paginated text; FT claim ill-posed → DEMOTE candidate',
    container: 'multi-work container (Opera Omnia / Sammlung / Collected Works / miscellany / catalogue) — no single work to be "first" of → DEMOTE candidate (human eye first)',
    language_mislabel: 'language=English but original_language is non-English — bad `language` tag; FIX the tag, KEEP the badge (also wrongly excluded from eligible count)',
    english_suspect: 'language=English, no corrective original_language — verify the source language before any action',
  };
  for (const cat of Object.keys(byCategory)) lines.push(`| ${cat} | ${byCategory[cat]} | ${meaning[cat] || ''} |`);
  lines.push('');
  lines.push(`## Candidates`);
  lines.push('');
  for (const cat of Object.keys(byCategory)) {
    const rows = candidates.filter((c) => c.reasons[0].category.split(':')[0] === cat);
    lines.push(`### ${cat} (${rows.length})`);
    lines.push('');
    lines.push(`| id | lang | author | title | reason |`);
    lines.push(`|---|---|---|---|---|`);
    for (const r of rows) {
      const t = (r.title || '').replace(/\|/g, '/').slice(0, 80);
      const a = (r.author || '').replace(/\|/g, '/').slice(0, 28);
      lines.push(`| \`${r.id}\` | ${r.language} | ${a} | ${t} | ${r.reasons[0].detail} |`);
    }
    lines.push('');
  }
  lines.push(`## Next steps (two distinct tracks)`);
  lines.push('');
  lines.push(`**Track 1 — DEMOTE the structural non-claims** (artwork + confirmed containers), via the canonical path:`);
  lines.push(`1. Spot-check the container rows — a few "Collected Works of X" ARE a genuine first translation of the collection as a unit; keep those.`);
  lines.push(`2. For confirmed non-claims, write \`first_translation.verdict='not_applicable'\` via the verdict-only writer + append to \`first_translation_attempts\`.`);
  lines.push(`3. Run \`reconcile-first-translation-flag.ts --apply\` (the single flag writer) to demote.`);
  lines.push('');
  lines.push(`**Track 2 — FIX the language mislabels** (do NOT demote): correct \`books.language\` from English to \`original_language\`. These are genuine non-English firsts; the bad tag both risked a wrong demote AND wrongly excluded them from the ${'`'}eligible${'`'} census denominator. Worth a corpus-wide sweep beyond just the badged set.`);
  writeFileSync(outMd, lines.join('\n'));

  console.log(`\nWrote ${outJson}`);
  console.log(`Wrote ${outMd}`);
});
