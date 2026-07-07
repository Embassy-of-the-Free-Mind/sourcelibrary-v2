#!/usr/bin/env node
/**
 * Quarantine the `source: ft_verification_discovery` rows out of
 * `translation_catalogs` (#3045).
 *
 * These ~302 rows are unverified Gemini discovery-pass output — all url-less,
 * often fabricated (the "Madame Dupin" translation of Reuchlin's *De Verbo
 * Mirifico* that nearly triggered a false demote; a 1969 Latin facsimile of
 * Pico's *Opera Omnia* masquerading as a complete English prior). Treating a
 * `found_refs` pointer into one of these as a trustworthy prior produces FALSE
 * DEMOTES of genuine first-translation badges.
 *
 * The read-path matchers already exclude them (`ft-catalog-match.mjs`,
 * `ft-prior-adjudicate.mjs` filter `source != 'ft_verification_discovery'`) and
 * the derive path no longer blanket-trusts `found_refs` (needs a resolvable
 * source_url — the discovery rows have none). This pass removes the rows from
 * the collection entirely so no future writer can accidentally re-surface them.
 *
 * SAFETY: nothing is destroyed. Rows are backed up to a timestamped JSON file
 * AND copied into the `translation_catalogs_quarantine` collection before being
 * removed from `translation_catalogs`. `--unapply` moves them straight back.
 * Dry-run by default — lists the rows and never writes.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/quarantine-ft-discovery-catalogs.mjs            # dry-run (list only)
 *   node scripts/maintenance/quarantine-ft-discovery-catalogs.mjs --apply    # back up + move to quarantine collection
 *   node scripts/maintenance/quarantine-ft-discovery-catalogs.mjs --unapply  # restore from quarantine collection
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getScriptClient } from '../lib/mongo.mjs';

const APPLY = process.argv.includes('--apply');
const UNAPPLY = process.argv.includes('--unapply');

const SOURCE = 'ft_verification_discovery';
const LIVE = 'translation_catalogs';
const QUARANTINE = 'translation_catalogs_quarantine';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');

/** A row is "locatable" (curated-shaped) if it carries an http(s) link. */
function hasUrl(r) {
  const u = r.url || r.source_url;
  return typeof u === 'string' && /^https?:\/\/\S/i.test(u.trim());
}

const { client, db } = await getScriptClient();
const live = db.collection(LIVE);
const quarantine = db.collection(QUARANTINE);

try {
  if (UNAPPLY) {
    const rows = await quarantine.find({ source: SOURCE }).toArray();
    if (rows.length === 0) {
      console.log(`Nothing to restore — ${QUARANTINE} holds 0 ${SOURCE} rows.`);
    } else {
      await live.insertMany(rows, { ordered: false });
      const r = await quarantine.deleteMany({ source: SOURCE });
      console.log(`RESTORED ${rows.length} rows back into ${LIVE}; removed ${r.deletedCount} from ${QUARANTINE}.`);
    }
    process.exit(0);
  }

  const rows = await live.find({ source: SOURCE }).toArray();
  const withUrl = rows.filter(hasUrl);

  console.log(`${LIVE}: ${await live.estimatedDocumentCount()} docs total`);
  console.log(`Rows with source='${SOURCE}': ${rows.length}`);
  console.log(`  ↳ of those carrying a resolvable url: ${withUrl.length} (expected ~0 — these rows are url-less)\n`);

  const sample = rows.slice(0, 25);
  for (const r of sample) {
    const who = r.canonical_author || r.author || r.author_surname || '—';
    const what = r.english_title || r.canonical_work || '—';
    console.log(`   ${hasUrl(r) ? '[url]' : '[   ]'} ${String(who).slice(0, 30).padEnd(30)}  ${String(what).slice(0, 60)}`);
  }
  if (rows.length > sample.length) console.log(`   … +${rows.length - sample.length} more`);
  console.log('');

  if (!APPLY) {
    console.log('DRY-RUN. Re-run with --apply to back up + move these rows to the quarantine collection.');
    process.exit(0);
  }

  if (rows.length === 0) {
    console.log('No rows to quarantine.');
    process.exit(0);
  }

  // 1) Back up to a timestamped JSON file (Date.now avoided — use ISO from Date via env-safe path).
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(OUTPUT_DIR, `translation-catalogs-ft-discovery-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(rows, null, 2));
  console.log(`Backed up ${rows.length} rows → ${backupPath}`);

  // 2) Copy into the quarantine collection (idempotent on _id), then remove from live.
  await quarantine.bulkWrite(
    rows.map((r) => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } })),
    { ordered: false },
  );
  const del = await live.deleteMany({ source: SOURCE });
  console.log(`APPLIED: moved ${rows.length} rows to ${QUARANTINE}; deleted ${del.deletedCount} from ${LIVE}.`);
  console.log(`Reverse with:  node scripts/maintenance/quarantine-ft-discovery-catalogs.mjs --unapply`);
} finally {
  await client.close();
}
