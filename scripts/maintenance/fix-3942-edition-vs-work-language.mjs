#!/usr/bin/env node
/**
 * fix-3942-edition-vs-work-language.mjs — correct the two catalogue records in
 * issue #3942, where `books.language` named the WORK's language while the leaves
 * we actually hold are in another one.
 *
 * The contract (src/lib/resolve-language.ts, #2185): `language` is the
 * MANIFESTATION language — what is printed on the pages in this scan.
 * `original_language` is the work hint, set only when it differs. Both records
 * below inverted that, and `classifyTextRole`'s non-English short-circuit
 * (src/lib/text-role.ts) then read the wrong scalar and called a 19th-c. French
 * translation an `original`.
 *
 * Evidence is the OCR model's own per-page `<language>` declaration — the same
 * signal english-source-detect.mjs uses, and the only one that reads the leaf
 * rather than the catalogue:
 *
 *   69b418ae2b0edf3eaa2dd9aa  "Hebrew Kabbalistic Collection"
 *     328/422 pages Hebrew, exactly 1 German. Catalogued German.
 *     An automated detector already flagged this on 2026-08-09
 *     (language_review_detail: detected Hebrew, current German, confidence high)
 *     and nothing acted on it. The MS is a Hebrew original, so text_role
 *     'original' was right for the wrong reason and stays.
 *
 *   69ef3e3a72c1376fdf2b0d3d  "Les Prolégomènes d'Ibn Khaldoun"
 *     450 pages French-only, 145 French+Arabic (de Slane's quoted Arabic),
 *     ZERO Arabic-only. Catalogued Arabic. This is de Slane's 1863 French
 *     translation, so the MCP `original` field was serving French under a
 *     record that declared Arabic — a reader citing it for non-European
 *     sourcing was quoting English←French←Arabic.
 *
 * ACTUATION NOTE (CLAUDE.md): `books.language` and `text_role` are read by
 * scripts/workers/sync-books-catalog.mjs (Supabase books_catalog mirror, which
 * backs every card surface) and feed textRoleRank in search ordering. The
 * first-translation screens on both records recorded
 * `source_language_screen.basis: 'declared_language'` — i.e. they trusted the
 * scalar this script is changing. Neither verdict flips (French and Hebrew are
 * both non-English, so `foreign_source` still holds), and neither book carries
 * `is_first_translation`, so no public badge moves. Re-run the catalog sync
 * after applying.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-3942-edition-vs-work-language.mjs          # dry-run (default)
 *   node scripts/maintenance/fix-3942-edition-vs-work-language.mjs --apply  # write
 */
import { MongoClient, ObjectId } from 'mongodb';
import { mkdirSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();

/**
 * `languages[]` is derived from the scalar by normalize-language-tags.mjs, so it
 * is set here too — leaving it stale would let a language filter keep matching
 * the old value after the visible one changed. The Arabic that de Slane quotes
 * is quoted material, not the edition's language, so it does not enter the array
 * (the normalizer only splits genuine compounds like "Latin-German").
 */
const FIXES = [
  {
    _id: '69b418ae2b0edf3eaa2dd9aa',
    expect: { language: 'German' },
    set: {
      language: 'Hebrew',
      languages: ['Hebrew'],
      language_multi: false,
      language_review: false,
      text_role: 'original',
      text_role_source: 'human-qa-3942',
    },
    note: '328/422 OCR pages declare Hebrew, 1 declares German; already flagged lang_drift 2026-08-09 and untriaged.',
  },
  {
    _id: '69ef3e3a72c1376fdf2b0d3d',
    expect: { language: 'Arabic' },
    set: {
      language: 'French',
      languages: ['French'],
      language_multi: false,
      original_language: 'Arabic',
      is_translation: true,
      text_role: 'modern-translation',
      text_role_source: 'human-qa-3942',
    },
    note: "de Slane 1863 French translation of the Muqaddimah: 450 OCR pages French-only, 145 French+Arabic, 0 Arabic-only.",
  },
];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1); }
const mc = new MongoClient(uri);
await mc.connect();
const B = mc.db('bookstore').collection('books');

const backup = [];
let changed = 0;

for (const fix of FIXES) {
  const _id = ObjectId.createFromHexString(fix._id);
  const before = await B.findOne({ _id }, {
    projection: {
      title: 1, language: 1, languages: 1, language_multi: 1, original_language: 1,
      is_translation: 1, text_role: 1, text_role_source: 1, language_review: 1,
      field_provenance: 1,
    },
  });
  if (!before) { console.log(`SKIP ${fix._id} — not found`); continue; }

  // Guard against re-running over a record someone has since corrected by hand:
  // only touch it while it still holds the exact wrong value the issue reported.
  if (before.language !== fix.expect.language) {
    console.log(`SKIP ${fix._id} — language is "${before.language}", expected "${fix.expect.language}" (already fixed or changed under us)`);
    continue;
  }

  backup.push({ _id: fix._id, title: before.title, before });
  console.log(`\n${APPLY ? 'FIX' : 'WOULD FIX'} ${fix._id} "${(before.title || '').slice(0, 70)}"`);
  for (const [k, v] of Object.entries(fix.set)) {
    console.log(`   ${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(v)}`);
  }

  if (!APPLY) continue;

  await B.updateOne({ _id }, {
    $set: {
      ...fix.set,
      // sync-books-catalog.mjs runs incrementally on `updated_at > lastSync`, so
      // a correction that does not bump it is invisible to the Supabase mirror
      // FOREVER — the card surfaces would have kept serving "German" and
      // "Arabic" while Atlas held the fix, and nothing would report the drift.
      updated_at: new Date(),
      'field_provenance.language': {
        source: 'manual',
        value: fix.set.language,
        previous_value: before.language,
        confidence: 'high',
        chosen_from: 'ocr_page_language_declaration',
        issue: 3942,
        note: fix.note,
        script: 'fix-3942-edition-vs-work-language.mjs',
        date: NOW,
      },
      language_review_resolved: { issue: 3942, at: NOW, outcome: 'relabelled from page evidence' },
    },
  });
  changed++;
}

const backupPath = `scripts/maintenance/backups/fix-3942-backup-${NOW.slice(0, 10)}.json`;
try {
  mkdirSync('scripts/maintenance/backups', { recursive: true });
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup: ${backupPath}`);
} catch {
  console.log(`\n(could not write ${backupPath} — backup below)\n${JSON.stringify(backup, null, 2)}`);
}
console.log(APPLY
  ? `Applied ${changed} record(s). Re-run scripts/workers/sync-books-catalog.mjs so the Supabase mirror picks these up.`
  : `Dry-run: ${backup.length} record(s) would change. Re-run with --apply.`);

await mc.close();
