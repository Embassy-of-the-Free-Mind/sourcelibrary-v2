#!/usr/bin/env node
/**
 * withdraw-ft-tibetan.mjs — withdraw the first-translation claim on the Tibetan
 * corpus, pending a trustworthy transcription (#4523, #4534).
 *
 * WHY (and why this is not a bibliographic demotion)
 * --------------------------------------------------
 * A "first English translation" badge asserts something about the BIBLIOGRAPHY.
 * Every other demotion path in this repo answers a bibliographic question: does
 * a prior translation exist? This one does not. It answers a prior question —
 * is the thing we are calling a translation a translation at all?
 *
 * Two independent findings say no, for Tibetan:
 *
 *  1. THE INSTRUMENT. GlotOCR Bench (arXiv 2604.12978) measures our production
 *     OCR model, gemini-3.1-flash-lite, at 19% Acc@5 on Tibetan CLEAN PRINTED
 *     text, with 100% script accuracy — it reliably emits Tibetan script and
 *     unreliably emits the right Tibetan. Cross-run agreement on our own
 *     manuscript pages runs 26-56% against an ~87-93% baseline for a printed
 *     Latin control. Some pages came back as Devanagari Hindu scripture.
 *  2. THE IMAGES. 80,981 pages across 167 Tibetan books were archived from
 *     tile-stitched masters that are 63.5% white canvas (#4534). 74,344 of them
 *     carry a published translation generated from an image with two thirds of
 *     the folio missing.
 *
 * So the verdict is `needs_review`, not `not_first`: we are not claiming a prior
 * exists. We are saying the claim cannot stand on this text. It is restorable —
 * this is exactly the state a re-OCR with a competent instrument should clear.
 *
 * WHAT THIS DOES NOT WRITE, DELIBERATELY
 * --------------------------------------
 *  - NOT `first_translation_attempts`. That ledger records SEARCHES. We did not
 *    search. CLAUDE.md: "Keep 'we could not ask' separate from 'we asked and
 *    found nothing'" — a row there would say we asked. It is also read by the
 *    nightly reconcile loop, so writing to it is actuation, not recording.
 *  - NOT `is_first_translation`. That boolean is already false on all of these
 *    (measured 0/398) — the badge renders from the VERDICT via isFirstTranslation(),
 *    which is why flipping the boolean would have changed nothing on the page.
 *    Single-writer stays reconcile-first-translation-flag.ts.
 *  - NOT page text, translations, or visibility. The text stays; only the claim
 *    about it is withdrawn.
 *
 * The prior verdict is preserved as a ROW in `book_events` (not a new column on
 * 400 books — #3969), so the withdrawal is reversible per book.
 *
 * `updated_at` is bumped on purpose: `sync-books-catalog.mjs` selects by
 * `updated_at > lastSync` and mirrors `first_translation.verdict` into the
 * catalog's `ft_verdict`. Without the bump the write is real in Atlas and inert
 * on every card surface.
 *
 * Dry-run by default.
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/withdraw-ft-tibetan.mjs
 *   node scripts/maintenance/withdraw-ft-tibetan.mjs --apply
 *   node scripts/maintenance/withdraw-ft-tibetan.mjs --language=Tibetan --ids-out ids.txt
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const APPLY = args.includes('--apply');
const LANGUAGE = getArg('language', 'Tibetan');
const IDS_OUT = getArg('ids-out', null);
const REASON = 'ft_withdrawn_untrusted_transcription';

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

/** Verdicts that badge as a first — mirror of FIRST_FAMILY in src/lib/first-translation/types.ts. */
const FIRST_FAMILY = ['first_no_prior', 'first_from_source', 'first_complete', 'first_modern'];

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = db.collection('books');

const candidates = await books.find(
  { language: LANGUAGE, 'first_translation.verdict': { $in: FIRST_FAMILY } },
  {
    projection: {
      _id: 1, id: 1, title: 1, visible: 1, pages_translated: 1,
      first_translation: 1, is_first_translation: 1,
    },
  },
).toArray();

// The render gate (isFirstTranslation): first-family verdict AND visible AND
// some translated pages. Reported separately so the number matches the site.
const rendering = candidates.filter((b) => b.visible && (b.pages_translated ?? 0) > 0);

console.log(`${LANGUAGE}: ${candidates.length} books carry a first-family verdict`);
console.log(`  of which currently RENDER a badge (visible + translated): ${rendering.length}`);
console.log(`  carrying is_first_translation:true: ${candidates.filter((b) => b.is_first_translation === true).length}`);

const byEv = {}; const byRes = {}; const byVerdict = {};
for (const b of candidates) {
  byEv[b.first_translation?.evidence_strength ?? '(none)'] = (byEv[b.first_translation?.evidence_strength ?? '(none)'] || 0) + 1;
  byRes[b.first_translation?.resolver ?? '(none)'] = (byRes[b.first_translation?.resolver ?? '(none)'] || 0) + 1;
  byVerdict[b.first_translation.verdict] = (byVerdict[b.first_translation.verdict] || 0) + 1;
}
console.log('\n  by verdict:', JSON.stringify(byVerdict));
console.log('  by evidence_strength:', JSON.stringify(byEv));
console.log('  by resolver:', JSON.stringify(byRes));

if (IDS_OUT) {
  writeFileSync(IDS_OUT, candidates.map((b) => String(b.id ?? b._id)).join('\n') + '\n');
  console.log(`\nwrote ${candidates.length} ids to ${IDS_OUT}`);
}

if (!APPLY) {
  console.log('\nDRY-RUN — nothing written.');
  console.log('Sample:');
  for (const b of candidates.slice(0, 10)) {
    console.log(`  ${String(b.id ?? b._id)} ${String(b.title).slice(0, 44).padEnd(44)} ${b.first_translation.verdict} / ${b.first_translation.evidence_strength ?? '-'} / ${b.first_translation.resolver ?? '-'}`);
  }
  console.log('\nRe-run with --apply to withdraw. Then: sync-books-catalog.mjs, then purge/warm.');
  await c.close();
  process.exit(0);
}

const now = new Date();
let wrote = 0; let events = 0;
for (const b of candidates) {
  // Provenance FIRST: if the update dies half way, the record of what the
  // verdict used to be already exists. A withdrawal you cannot reverse is a
  // deletion.
  await db.collection('book_events').insertOne({
    book_id: String(b.id ?? b._id),
    type: 'ft_withdrawn',
    at: now,
    reason: REASON,
    issue: 4523,
    previous_first_translation: b.first_translation,
    previous_is_first_translation: b.is_first_translation ?? false,
    note: 'Tibetan FT claims withdrawn pending a trustworthy transcription: OCR '
      + 'instrument measured at 19% Acc@5 on printed Tibetan (GlotOCR), and 167 '
      + 'Tibetan books were transcribed from tile-gutter masters (#4534). '
      + 'Restorable from previous_first_translation.',
  });
  events++;

  await books.updateOne(
    { _id: b._id },
    {
      $set: {
        'first_translation.verdict': 'needs_review',
        'first_translation.resolver': 'human',
        'first_translation.resolved_at': now,
        // Bumped so sync-books-catalog picks the row up; without this the
        // catalog keeps serving the old ft_verdict and the cards keep badging.
        updated_at: now,
      },
    },
  );
  wrote++;
}

console.log(`\nAPPLIED. verdict -> needs_review on ${wrote} books; ${events} book_events rows written.`);
console.log('NEXT:');
console.log('  1. node scripts/workers/sync-books-catalog.mjs      (mirror ft_verdict into Supabase)');
console.log('  2. purge + warm the affected book pages             (see deploy-and-caching.md)');
console.log('  3. reconcile-first-translation-flag.ts is a no-op here — the boolean was already false.');
await c.close();
