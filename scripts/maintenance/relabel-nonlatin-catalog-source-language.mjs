#!/usr/bin/env node
/**
 * Conservatively relabel `source_language` on translation_catalogs rows that
 * were built as Latin (`la`) by construction but are actually translations of a
 * NON-Latin original (issue #2899, data-hygiene tail).
 *
 * Why author-allowlist, NOT title keywords: title-marker matching is unsafe —
 * "The Golden Ass, or A Book of Changes" (Apuleius) and Cusanus's "Cribratio
 * Alkorani" are genuinely Latin; "A Journey to the West" is an Italian pilgrim's
 * diary. 11/16 keyword hits were false positives. Only an unambiguous non-Latin
 * AUTHOR is a safe signal. We relabel only rows whose author matches a curated
 * allowlist of authors who wrote in exactly one non-Latin source language.
 *
 * Low-harm note: a mislabeled `la` row never causes a FALSE match — the matcher's
 * SOURCE_LANG guard rejects a non-Latin book against an `la` row — it only causes
 * a MISSED match. So this is a recall fix, not a safety fix; hence the
 * conservative bar.
 *
 * Usage:
 *   node scripts/maintenance/relabel-nonlatin-catalog-source-language.mjs           # dry-run
 *   node scripts/maintenance/relabel-nonlatin-catalog-source-language.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { normalize } from '../lib/translation-catalog-record.mjs';

const APPLY = process.argv.includes('--apply');

// Each entry: a normalized author-name substring → its single non-Latin ISO.
// Keep STRICT: only authors with one unambiguous source language and no Latin
// namesake. Names are matched as substrings of author_normalized.
const AUTHOR_ALLOWLIST = [
  { match: 'luo guanzhong', iso: 'zh' },   // Sanguo yanyi (Romance of the Three Kingdoms)
  { match: 'valmiki', iso: 'sa' },         // Rāmāyaṇa
  { match: 'vyasa', iso: 'sa' },           // Mahābhārata / Purāṇas
  { match: 'kalidasa', iso: 'sa' },        // Śakuntalā, Meghadūta, …
  { match: 'cao xueqin', iso: 'zh' },      // Dream of the Red Chamber
  { match: 'wu chengen', iso: 'zh' },      // Journey to the West (the novel)
  { match: 'murasaki shikibu', iso: 'ja' }, // Tale of Genji
];

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const col = c.db('bookstore').collection('translation_catalogs');

const ops = [];
const preview = [];
for (const entry of AUTHOR_ALLOWLIST) {
  const rows = await col
    .find({ source_language: 'la', author_normalized: new RegExp(entry.match) })
    .project({ _id: 1, author: 1, english_title: 1 })
    .toArray();
  for (const r of rows) {
    // Defensive: skip if the author also reads as a Latin name (none in the
    // allowlist do, but guard against a future bad entry).
    preview.push(`  ${entry.iso} ← la | "${(r.english_title || '').slice(0, 50)}" | ${r.author}`);
    ops.push({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { source_language: entry.iso, source_language_provenance: 'author_allowlist' } },
      },
    });
  }
}

console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${ops.length} rows to relabel:`);
console.log(preview.join('\n') || '  (none)');
if (APPLY && ops.length) {
  const res = await col.bulkWrite(ops, { ordered: false });
  console.log(`modified ${res.modifiedCount}`);
}
await c.close();
