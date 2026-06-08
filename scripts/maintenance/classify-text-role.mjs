#!/usr/bin/env node
/**
 * Classify every visible book's `text_role` — the foundational field for
 * distinguishing original-language SOURCES from (often modern) TRANSLATIONS,
 * so render/search gates can prefer the original + our own translation rather
 * than surfacing e.g. Jowett's 1875 Plato or Evans-Wentz's Tibetan Book of the
 * Dead as the primary text. See issue #2395.
 *
 * text_role values:
 *   original            — original-language source (any non-English scan, or a
 *                         genuine English-native work like Bacon/Cudworth/More)
 *   period-translation  — historical translation, pre-~1700 (kept as artifact)
 *   modern-translation  — ~18th c.+ translation standing in for an original.
 *                         Loeb/SBE facing-page editions count here too (per
 *                         Derek, 2026-06-03): even though the original is in the
 *                         same scan, we present it as a translation.
 *
 * Heuristic, English-language books only (the actionable set). Marked
 * `text_role_source: 'heuristic-v1'` so it's clearly auto-derived and must be
 * human-QA'd before any gate goes live (issue #2395 acceptance criteria).
 * Also records `original_in_scan: true` for Loeb/facing-page so the gate knows
 * the original text is already present.
 *
 * KEEP THE classify() HEURISTIC IN SYNC with src/lib/text-role.ts
 * `classifyTextRole()`, which runs the same logic at import time so new books
 * are classified on insert. This script is the catch-all sweep for import paths
 * that bypass that hook (the direct-insert scripts) and for re-classifying after
 * metadata enrichment (e.g. once `year` lands). Run `--only-missing` from a cron
 * to keep the tail classified.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/classify-text-role.mjs --dry-run
 *   node scripts/maintenance/classify-text-role.mjs                    # live write, all visible books
 *   node scripts/maintenance/classify-text-role.mjs --only-missing     # only books with no text_role (cron-friendly)
 *   node scripts/maintenance/classify-text-role.mjs --limit=50 --dry-run
 */

import { MongoClient } from 'mongodb';

const enLike = v => !v || /^(english|en)$/i.test(String(v).trim());

// Strong translation signals on an English-language scan.
const TRANS_TITLE = /transl|englished|rendered into english|done into english|made english|from the (greek|latin|hebrew|arabic|sanskrit|german|french|italian|chinese|tibetan|persian|coptic|aramaic|syriac)|\bloeb\b|sacred books of the east/i;
const TRANS_AUTHOR = /\btr(ans)?\.?\b|translated by|;\s*tr\b/i;
// Classical / non-English-original authors: an English edition attributed to
// them is by definition a translation.
const CLASSICAL = /\b(plato|aristotle|plotinus|proclus|iamblichus|porphyry|plutarch|pythagoras|ptolemy|galen|hippocrates|homer|hesiod|sophocles|euripides|aeschylus|epictetus|marcus aurelius|sextus empiricus|philo|origen|cicero|seneca|virgil|ovid|lucretius|apuleius|boethius|aquinas|avicenna|averroes|al-biruni|al-kindi|maimonides|hermes trismegistus|laozi|lao tzu|confucius|zhuangzi|mencius|xunzi|patanjali|shankara|kabir|rumi|hafiz|sa'di|nagarjuna|padmasambhava)\b/i;
const LOEB = /\b(loeb|sacred books of the east)\b/i;

// First 4-digit year found across the candidate fields, or NaN. Mirrors
// coerceYear() in src/lib/text-role.ts — keep in sync.
function coerceYear(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'number' && v > 0) return v;
    const m = String(v).match(/\d{4}/);
    if (m) return Number(m[0]);
  }
  return NaN;
}

function classify(book) {
  // Non-English scan → it's an original-language source.
  if (!enLike(book.language)) return { role: 'original', loeb: false };

  const t = book.title || '';
  const a = book.author || '';
  const sigOrig = book.original_language && !enLike(book.original_language);
  const sigTitle = TRANS_TITLE.test(t);
  const sigAuth = TRANS_AUTHOR.test(a);
  const sigClassical = CLASSICAL.test(a) || CLASSICAL.test(t);
  const loeb = LOEB.test(t) || LOEB.test(a);

  if (!(sigOrig || sigTitle || sigAuth || sigClassical)) {
    // English book with no translation signal → treat as English-native original.
    return { role: 'original', loeb: false };
  }
  // It's a translation. Loeb always counts as modern (original co-present but
  // presented as translation). Otherwise split by era.
  if (loeb) return { role: 'modern-translation', loeb: true };
  const yr = coerceYear(book.year, book.published, book.original_work_year);
  if (yr && yr > 0 && yr < 1700) return { role: 'period-translation', loeb: false };
  return { role: 'modern-translation', loeb: false };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyMissing = args.includes('--only-missing');
  const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Run with: set -a; source .env.production.local; set +a');
    process.exit(1);
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db('bookstore').collection('books');

  // --only-missing: classify just the books that have no text_role yet (the
  // import tail). Default: re-classify all visible books.
  const query = onlyMissing
    ? { visible: true, text_role: { $exists: false } }
    : { visible: true };
  const cursor = col.find(
    query,
    { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, published: 1, original_work_year: 1, language: 1, original_language: 1, read_count: 1 } },
  );

  const dist = { original: 0, 'period-translation': 0, 'modern-translation': 0 };
  let loebCount = 0, processed = 0, written = 0;
  const samples = { 'period-translation': [], 'modern-translation': [] };
  const ops = [];

  for await (const b of cursor) {
    if (limit && processed >= limit) break;
    processed++;
    const { role, loeb } = classify(b);
    dist[role]++;
    if (loeb) loebCount++;
    if (role !== 'original' && samples[role].length < 8) {
      samples[role].push(`${b.read_count || 0}rd ${b.year || '?'} — ${(b.title || '').slice(0, 44)} (${(b.author || '').slice(0, 22)})${loeb ? ' [Loeb]' : ''}`);
    }
    const set = { text_role: role, text_role_source: 'heuristic-v1' };
    if (loeb) set.original_in_scan = true;
    ops.push({ updateOne: { filter: { id: b.id }, update: { $set: set } } });
    if (ops.length >= 1000 && !dryRun) {
      const r = await col.bulkWrite(ops); written += r.modifiedCount; ops.length = 0;
    }
  }
  if (ops.length && !dryRun) { const r = await col.bulkWrite(ops); written += r.modifiedCount; }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Processed ${processed} visible books`);
  console.log(`  original:            ${dist.original}`);
  console.log(`  period-translation:  ${dist['period-translation']}`);
  console.log(`  modern-translation:  ${dist['modern-translation']} (incl. ${loebCount} Loeb/SBE)`);
  if (!dryRun) console.log(`  modifiedCount:       ${written}`);
  console.log('\nperiod-translation samples:'); samples['period-translation'].forEach(s => console.log('  ', s));
  console.log('\nmodern-translation samples:'); samples['modern-translation'].forEach(s => console.log('  ', s));

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
