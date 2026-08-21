/**
 * Which REGISTER does each badged book's first-translation claim get?
 *
 * Runs `classifyFirstTranslationClaim` over every badged + visible book and
 * reports the split, so a copy change is sized against real data and can be
 * re-measured after any evidence sweep. Read-only.
 *
 *   npx tsx --env-file=.env.production.local scripts/audit/ft-claim-register.ts
 *
 * Baseline, 2026-08-07 (5,932 badged + visible):
 *   candidate       5,217  87.9%   weak or unrecorded evidence
 *   confirmed         627  10.6%   strong or moderate evidence
 *   defeated           59   1.0%   badged while our own verdict names a prior
 *   not_applicable     29   0.5%   English source, or catalogued English
 *
 * The `defeated` row is a screening queue, not a rendering state: those books
 * carry `is_first_translation: true` while `first_translation.verdict` reads
 * `not_first`. The evidence panel already shows them as "Existing translations",
 * but the flag still drives the cards. See #3524 / #2933.
 */
import { getReadDb } from '@/lib/mongodb';
import { classifyFirstTranslationClaim, type ScreenedBook } from '@/lib/first-translation/candidate';

async function main() {
const db = await getReadDb();
const books = db.collection('books');

const cur = books.find(
  { is_first_translation: true, visible: true },
  {
    projection: {
      id: 1, title: 1, language: 1, original_language: 1, is_first_translation: 1, visible: 1, author: 1,
      first_translation: 1, translation_verification: 1,
      source_language_screen: 1, translator_author_screen: 1,
      pages_translated: 1, pages_ocr: 1, pages_blank: 1, pages_count: 1,
    },
  },
);

const tally: Record<string, number> = {};
const reasons: Record<string, number> = {};
const samples: Record<string, string[]> = {};
let incomplete = 0;
let review = 0;
let n = 0;

for await (const b of cur) {
  n++;
  const r = classifyFirstTranslationClaim(b as unknown as ScreenedBook);
  tally[r.claim] = (tally[r.claim] ?? 0) + 1;
  const key = `${r.claim} / ${r.reason}`;
  reasons[key] = (reasons[key] ?? 0) + 1;
  if (r.screensIncomplete) incomplete++;
  if (r.needsReview) review++;
  const s = (samples[key] ??= []);
  if (s.length < 3) s.push(`${b.id} — ${String(b.title ?? '').slice(0, 55)}`);
}

console.log(`badged + visible scanned: ${n}\n`);
console.log('claim:');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(6)}  ${((v / n) * 100).toFixed(1)}%`);
}
console.log('\nclaim / reason:');
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(46)} ${String(v).padStart(6)}`);
  for (const s of samples[k] ?? []) console.log(`      ${s}`);
}
console.log(`\nscreensIncomplete: ${incomplete}   needsReview: ${review}`);
process.exit(0);
}

main();
