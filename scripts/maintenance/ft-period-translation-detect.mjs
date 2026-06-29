/**
 * Detect period-translations mis-tagged as `original` (#2876 follow-up, lever c).
 *
 * The work-identity casebook (`.claude/docs/work-identity-casebook.md`, pattern
 * #2) and the Iamblichus *De mysteriis* spot-check found that Renaissance Latin
 * translations (Ficino, Trebatius, Argyropoulos…) are systematically stored
 * `text_role:original, original_language:Latin` when they are in fact
 * translations *from the Greek*. Corpus-wide the gap is stark:
 * `period-translation` is used ~19× vs `original` ~47,000×.
 *
 * Why it matters: a period-translation tagged `original` (a) inflates the
 * "we hold the source-language original" coverage, (b) corrupts the
 * source-language rule that gates first-translation verdicts, and (c) can let a
 * Latin *translation* be mistaken for a translatable source and badged an
 * English first.
 *
 * This is REPORT-ONLY. It detects high-precision candidates via an explicit
 * translator phrase ("…interprete X", "ex graeco … versa/conversa/reddita",
 * "latinitate donatus"), EXCLUDING bilingual/dual-text editions (a Greek-Latin
 * edition contains the original too). It proposes `text_role:'period-translation'`
 * and infers `original_language` only when the title/translator makes the source
 * unambiguous; otherwise it flags the row for review. It writes:
 *   - a human report (.md),
 *   - a reversible BACKUP of the current {text_role, original_language},
 *   - a re-tag queue (.json) — apply ONLY after Derek's sign-off.
 *
 * The phrase signal is the clean STARTING set; a larger latent set is reachable
 * by work_id clustering (a Latin edition sharing a work with a Greek original) —
 * left for a follow-up so the first pass stays high-precision.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/ft-period-translation-detect.mjs
 */
import { withMongo } from '../lib/mongo.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const DATE = new Date().toISOString().slice(0, 10);
const OUT = 'scripts/output';

// Explicit translator/translation phrase → this edition is a translation.
const TRANSLATOR_PHRASE = /interprete\b|\binterpr\.|\btranslatore\b|\bvertente\b|latine\s+(redd|versa|conversa|translat|donat)|latinitate\s+donat|(\bex|\be)\s+(graeco|graec[ao]|hebraeo|hebraico|arabico|chaldaico)\b|graeco\s+in\s+latinum|ex\s+graeca\s+lingua|interpretatio\s+latina/i;
// Dual-text editions contain the original too — do NOT re-tag as translation.
const BILINGUAL = /graece\s+et\s+latine|graec[eo].?\s?latin|greek.?latin|greek\s+and\s+latin|griechisch|bilingual|gr\.?\s*(et|&|und)\s*lat/i;

// Source-language inference (only when unambiguous).
function inferSource(title, author) {
  const s = `${title} ${author}`;
  if (/\bhebraeo|hebraico\b/i.test(s)) return 'Hebrew';
  if (/\barabico\b/i.test(s)) return 'Arabic';
  if (/\bchaldaico\b/i.test(s)) return 'Chaldean';
  if (/\b(graeco|graec[ao])\b/i.test(s) || /ex\s+graec/i.test(s)) return 'Greek';
  // Known Greek→Latin translators (the casebook's named set).
  if (/\bficino\b|\bargyropoulos\b|argyropylus|\btrebati|bessarion|leonardo\s+bruni|\bbruni\b/i.test(s)) return 'Greek';
  return null; // unknown → review, don't guess
}

await withMongo(async (db) => {
  const cur = db.collection('books').find(
    { text_role: 'original' },
    { projection: { title: 1, author: 1, language: 1, original_language: 1, work_id: 1, is_first_translation: 1 } },
  );

  const queue = [];
  const backup = [];
  let bilingualExcluded = 0;
  let scanned = 0;
  const bySource = {};

  for await (const d of cur) {
    scanned++;
    const t = d.title || '';
    const a = d.author || '';
    if (!(TRANSLATOR_PHRASE.test(t) || TRANSLATOR_PHRASE.test(a))) continue;
    if (BILINGUAL.test(t)) { bilingualExcluded++; continue; }

    const src = inferSource(t, a);
    const needsReview = src == null;
    bySource[src ?? 'review'] = (bySource[src ?? 'review'] || 0) + 1;

    backup.push({ _id: String(d._id), id: String(d._id),
      prev_text_role: 'original', prev_original_language: d.original_language ?? null });
    queue.push({
      book_id: String(d._id),
      title: t.slice(0, 110), author: a.slice(0, 60), language: d.language ?? null,
      current_original_language: d.original_language ?? null,
      proposed_text_role: 'period-translation',
      proposed_original_language: src,           // null when uncertain
      needs_review: needsReview,                 // human picks the source
      currently_badged_first: !!d.is_first_translation,
      confidence: needsReview ? 'medium' : 'high',
    });
  }

  mkdirSync(OUT, { recursive: true });
  const stamp = `${OUT}/ft-period-translation-${DATE}`;
  writeFileSync(`${stamp}-backup.json`, JSON.stringify(backup, null, 1));
  writeFileSync(`${stamp}-retag-queue.json`, JSON.stringify(queue, null, 1));

  const high = queue.filter((q) => !q.needs_review).length;
  const review = queue.filter((q) => q.needs_review).length;
  const stillBadged = queue.filter((q) => q.currently_badged_first).length;

  const L = [];
  L.push(`# Period-Translation Re-tag — candidates (${DATE})`);
  L.push('');
  L.push(`Report-only. Scanned **${scanned}** \`text_role:original\` records. No tags changed.`);
  L.push('');
  L.push(`**Candidates (translator phrase, non-bilingual): ${queue.length}**`);
  L.push(`- high-confidence source inferred: **${high}** · needs source review: **${review}**`);
  L.push(`- excluded as bilingual/dual-text editions: ${bilingualExcluded}`);
  L.push(`- of the candidates, currently still badged \`is_first_translation\`: **${stillBadged}** (a period-translation should not carry an English-first badge)`);
  L.push('');
  L.push('| inferred source | n |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('### samples');
  for (const q of queue.slice(0, 15)) {
    L.push(`- \`${q.book_id}\` [${q.language || '?'}→${q.proposed_original_language || 'review'}] ${q.title}`);
  }
  L.push('');
  L.push('## Apply (after sign-off)');
  L.push("- High-confidence rows: set `text_role:period-translation` + `original_language` = inferred source.");
  L.push('- Review rows: confirm the source language by hand first (the title doesn\'t state it).');
  L.push(`- Backup of current state: \`${stamp}-backup.json\` (restore source).`);
  L.push('- This corrects metadata only; it does not itself flip badges. Books still badged first after re-tag should be re-resolved (a Latin translation is not an English first).');
  L.push('');
  L.push('Casebook pattern #2 (period-translation): `.claude/docs/work-identity-casebook.md`.');
  writeFileSync(`${stamp}.md`, L.join('\n') + '\n');

  console.log(L.join('\n'));
  console.error(`\n✓ wrote ${stamp}.md (+ -backup/-retag-queue .json)`);
});
