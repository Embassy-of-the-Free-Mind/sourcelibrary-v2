#!/usr/bin/env node
/**
 * Backfill `language` on books where the catalog says "Unknown" but the OCR
 * already declares a language via `<language>X</language>` tags. Pure data
 * propagation — no LLM calls, no external requests.
 *
 * Strategy per book:
 *   1. Pull up to N pages (default 5) sorted by page_number
 *   2. Collect <language> tag values from each page's ocr.data
 *   3. Pick the majority value (ties go to the first occurrence)
 *   4. Update books.language; track via _language_backfill for audit/revert
 *
 * Books with no OCR or no <language> tag in any sampled page are skipped.
 *
 * Usage:
 *   node scripts/maintenance/backfill-language-from-ocr.mjs            # dry-run
 *   node scripts/maintenance/backfill-language-from-ocr.mjs --apply
 *   node scripts/maintenance/backfill-language-from-ocr.mjs --limit 50
 */
import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();
const PAGES_PER_BOOK = 5;

const LANG_TAG_RX = /<language>([^<]+)<\/language>/g;

const NULL_LANG_VALUES = new Set(['', 'unknown', 'none', 'n/a', 'null', 'undefined']);
const LANG_CANON = {
  latin: 'Latin', german: 'German', french: 'French', italian: 'Italian',
  english: 'English', dutch: 'Dutch', spanish: 'Spanish', greek: 'Greek',
  hebrew: 'Hebrew', portuguese: 'Portuguese', polish: 'Polish',
  arabic: 'Arabic', russian: 'Russian', czech: 'Czech', swedish: 'Swedish',
  danish: 'Danish', norwegian: 'Norwegian', hungarian: 'Hungarian',
};

/**
 * Canonicalize a single language string. Returns null for empty / "none" /
 * "unknown" values. Returns an array if the input is a comma/and-separated
 * list of multiple languages.
 */
function canonicalize(lang) {
  if (!lang) return null;
  const t = lang.trim();
  if (!t) return null;
  if (NULL_LANG_VALUES.has(t.toLowerCase())) return null;

  // Split multi-language tags like "Latin, German" or "Latin and Greek"
  if (/[,&]|\band\b/i.test(t)) {
    const parts = t.split(/[,&]|\band\b/i).map(s => s.trim()).filter(Boolean);
    const canonized = parts.map(p => canonicalize(p)).filter(x => x != null).flat();
    return canonized.length === 0 ? null : canonized;
  }

  const lower = t.toLowerCase();
  return LANG_CANON[lower] || t.charAt(0).toUpperCase() + t.slice(1);
}

function majorityVote(values) {
  if (values.length === 0) return null;
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let bestVal = null, bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { bestVal = v; bestCount = c; }
  }
  return { value: bestVal, count: bestCount, total: values.length, distribution: Object.fromEntries(counts) };
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Skip wikimedia_commons and other artwork-only providers — they're single
// images with no OCR and no meaningful language attribute.
const cursor = db.collection('books').find(
  {
    language: 'Unknown',
    'image_source.provider': { $nin: ['wikimedia_commons', 'met_openaccess'] },
  },
  { projection: { _id: 1, title: 1, 'image_source.provider': 1, pages_count: 1 } }
);

let scanned = 0, noOcr = 0, noTag = 0, wouldWrite = 0, written = 0;
const samples = [];
const langCounts = new Map();

for await (const book of cursor) {
  if (scanned >= LIMIT) break;
  scanned++;

  const bookId = String(book._id);
  const pages = await db.collection('pages').find(
    { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
    { projection: { page_number: 1, 'ocr.data': 1 } }
  ).sort({ page_number: 1 }).limit(PAGES_PER_BOOK).toArray();

  if (pages.length === 0) { noOcr++; continue; }

  const tags = [];
  for (const p of pages) {
    const data = p.ocr?.data || '';
    let m;
    LANG_TAG_RX.lastIndex = 0;
    while ((m = LANG_TAG_RX.exec(data)) !== null) {
      const canon = canonicalize(m[1]);
      if (!canon) continue;
      if (Array.isArray(canon)) tags.push(...canon);
      else tags.push(canon);
    }
  }

  if (tags.length === 0) { noTag++; continue; }

  const vote = majorityVote(tags);
  const proposed = vote.value;
  wouldWrite++;
  langCounts.set(proposed, (langCounts.get(proposed) || 0) + 1);

  if (samples.length < 12) samples.push({
    id: bookId.slice(-8),
    title: book.title?.slice(0, 60),
    provider: book.image_source?.provider,
    proposed,
    confidence: `${vote.count}/${vote.total}`,
    distribution: vote.distribution,
  });

  if (APPLY) {
    const res = await db.collection('books').updateOne(
      { _id: book._id },
      { $set: {
        language: proposed,
        _language_backfill: {
          at: new Date(),
          source: 'ocr_language_tag',
          confidence: `${vote.count}/${vote.total}`,
          distribution: vote.distribution,
        },
      }}
    );
    if (res.modifiedCount > 0) written++;
  }
}

console.log(`Scanned: ${scanned}`);
console.log(`  no OCR pages: ${noOcr}`);
console.log(`  OCR but no <language> tag: ${noTag}`);
console.log(`  ${APPLY ? 'wrote' : 'would write'}: ${APPLY ? written : wouldWrite}`);

console.log('\nLanguages assigned:');
for (const [l, c] of [...langCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${l}: ${c}`);
}

console.log('\nSample (first 12):');
for (const s of samples) {
  console.log(`  [${s.confidence}] ${s.id} (${s.provider || '?'}) ${JSON.stringify(s.title)} → ${s.proposed}`);
  if (Object.keys(s.distribution).length > 1) console.log(`    distribution: ${JSON.stringify(s.distribution)}`);
}

if (!APPLY) console.log('\nDRY RUN — re-run with --apply to commit.');

await client.close();
