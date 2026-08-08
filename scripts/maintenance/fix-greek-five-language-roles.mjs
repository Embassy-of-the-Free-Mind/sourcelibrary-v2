#!/usr/bin/env node
/**
 * Corrects `original_language` / `text_role` / `original_in_scan` on the 40
 * editions imported by scripts/import/greek-five-authors-batch.mjs (2026-08-08).
 *
 * WHY: the import script passed each book's *edition* language as the route's
 * `original_language` argument. `resolveLanguage()` (src/lib/resolve-language.ts)
 * deliberately nulls `original_language` when it equals `language` — FRBR work ==
 * manifestation — so every one of those hints was dropped. That in turn left
 * `is_translation` false, and `classifyTextRole()` returns 'original' for any
 * non-English scan lacking that flag, so four vernacular renderings of Greek
 * works (Boileau's French Longinus, Gori's Italian Longinus, Hervet's Latin
 * Sextus, Huart's French Sextus) were classified as originals.
 *
 * All five authors wrote in Greek, so `original_language: 'Greek'` is correct for
 * every book here except Gassendi's Philosophiae Epicuri Syntagma, which is his
 * own Latin composition and not a rendering of a Greek text — it is excluded.
 *
 * Three shapes are distinguished, because they mean different things downstream:
 *   TRANSLATION  — a rendering into another language; the Greek is not in the scan.
 *   APPARATUS    — a Greek text printed with Latin/vernacular commentary. Stays
 *                  text_role 'original'; the Greek IS in the scan.
 *   FACING       — Greek and a translation printed together. text_role stays a
 *                  translation, but original_in_scan is true, so quoting surfaces
 *                  know the Greek is present.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-greek-five-language-roles.mjs --dry-run
 *   node scripts/maintenance/fix-greek-five-language-roles.mjs --apply
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');

// id → [shape, note]. Books not listed keep what the import gave them.
const PLAN = {
  // ── TRANSLATION: Greek work rendered into another language ─────────────────
  '6a76d4a3b13a2814115465a7': ['TRANSLATION', "Charleton 1656, Epicurus's Morals (English)"],
  '6a76d4b6e4fbf6807f19662b': ['TRANSLATION', "Digby 1712, Epicurus's Morals (English)"],
  '6a76d4d66ba8d6d1d3f8e71d': ['TRANSLATION', 'Anon. 1698, An Essay upon Sublime (English)'],
  '6a76d4de6ba8d6d1d3f8e791': ['TRANSLATION', 'Welsted 1712, Works of Dionysius Longinus (English)'],
  '6a76d4e76ba8d6d1d3f8e86c': ['TRANSLATION', 'Boileau 1733, Traite du Sublime (French) — was misclassified original'],
  '6a76d4ed6ba8d6d1d3f8e9e5': ['TRANSLATION', 'Gori 1737, Trattato del Sublime (Italian) — was misclassified original'],
  '6a76d4f56ba8d6d1d3f8ea66': ['TRANSLATION', 'Smith 1752, Longinus On the Sublime (English)'],
  '6a76d5156ba8d6d1d3f8ee80': ['TRANSLATION', '1713, Works of Anacreon and Sappho (English)'],
  '6a76d52af28570a9bf4e785d': ['TRANSLATION', 'Fawkes 1760, Anacreon, Sappho, Bion, Moschus (English)'],
  '6a76d569f28570a9bf4e7d48': ['TRANSLATION', 'Petersen 1918, Lyric Songs of the Greeks (English)'],
  '6a76d571f28570a9bf4e7e23': ['TRANSLATION', 'Hervet 1569, Adversus Mathematicos (Latin) — was misclassified original'],
  '6a76d583f28570a9bf4e83a6': ['TRANSLATION', 'Huart 1725, Les Hipotiposes (French) — was misclassified original'],
  '6a76d5c5f28570a9bf4e942e': ['TRANSLATION', 'Hampton 1772, General History of Polybius (English)'],
  '6a76d60d14c23e08b16a4090': ['TRANSLATION', 'Shuckburgh 1889, Histories of Polybius Vol. 1 (English)'],

  // ── FACING: Greek printed alongside the translation ────────────────────────
  '6a76d4fe6ba8d6d1d3f8eb54': ['FACING', '1810, Longinus in Greek together with the English translation'],
  '6a76d50e6ba8d6d1d3f8ed41': ['FACING', 'Rhys Roberts 1907, Greek text after the Paris MS + translation'],

  // ── APPARATUS: Greek text, non-Greek editorial matter. Stays 'original'. ───
  '6a76d4be6ba8d6d1d3f8e511': ['APPARATUS', 'Herculanensium Voluminum 1793 — Greek papyri, Latin commentary'],
  '6a76d4cd6ba8d6d1d3f8e6ca': ['APPARATUS', 'Koerte 1890, Metrodori Epicurei Fragmenta'],
  '6a76d51e6ba8d6d1d3f8eef0': ['APPARATUS', 'Wolf 1733, Sapphus Fragmenta et Elogia'],
  '6a76d532f28570a9bf4e79ba': ['APPARATUS', '1770, Anacreon/Sappho/Alcaeus Greek text'],
  '6a76d541f28570a9bf4e7b35': ['APPARATUS', '1826, Anacreontis Carmina; Sapphus et Erinnae Fragmenta'],
  '6a76d54ff28570a9bf4e7bdc': ['APPARATUS', 'Neue 1827, Sapphonis Mytilenaeae Fragmenta'],
  '6a76d558f28570a9bf4e7c6e': ['APPARATUS', '1863, Vita e Frammenti di Saffo (Greek + Italian)'],
  '6a76d5aff28570a9bf4e8ab5': ['APPARATUS', 'Casaubon 1609, Polybius Greek and Latin'],
};

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const books = c.db('bookstore').collection('books');

let changed = 0, skipped = 0;
for (const [id, [shape, note]] of Object.entries(PLAN)) {
  const b = await books.findOne({ id }, { projection: { id: 1, title: 1, language: 1, original_language: 1, text_role: 1, original_in_scan: 1, year: 1 } });
  if (!b) { console.log(`  MISSING ${id} — ${note}`); skipped++; continue; }

  const set = { original_language: 'Greek', text_role_source: 'curated-2026-08-08' };
  if (shape === 'TRANSLATION' || shape === 'FACING') {
    set.is_translation = true;
    set.text_role = (b.year && b.year < 1700) ? 'period-translation' : 'modern-translation';
    set.original_in_scan = shape === 'FACING';
  } else {
    set.text_role = 'original';
    set.original_in_scan = true;
  }

  const before = `${b.language}/orig=${b.original_language ?? '-'}/role=${b.text_role}/scan=${b.original_in_scan ?? false}`;
  const after = `${b.language}/orig=${set.original_language}/role=${set.text_role}/scan=${set.original_in_scan}`;
  if (before === after) { console.log(`  = ${id} unchanged — ${note}`); skipped++; continue; }

  if (APPLY) {
    const r = await books.updateOne({ id }, { $set: set });
    if (r.modifiedCount !== 1) { console.log(`  ! ${id} modifiedCount=${r.modifiedCount} — ${note}`); skipped++; continue; }
  }
  console.log(`  ${APPLY ? '✓' : '·'} ${shape.padEnd(11)} ${before}  →  ${after}   ${note}`);
  changed++;
}

console.log(`\n${APPLY ? 'Applied' : 'Would change'}: ${changed}   unchanged/skipped: ${skipped}   planned: ${Object.keys(PLAN).length}`);
await c.close();
