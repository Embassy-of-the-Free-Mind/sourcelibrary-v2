#!/usr/bin/env node
/**
 * PRIOR ART: `fix-7537-julien-laozi-edition-language.mjs` and `fix-3942-edition-vs-work-language.mjs`
 * made this correction one record at a time, and their writes are copied here.
 * `relabel-bilingual-edition.mjs` keeps the CATALOGUED language first, which would leave these
 * filed under Chinese, the fault being fixed. `recountBook()` in `page-counts.mjs` does the
 * re-stamp of `translation_state`, so no second copy of that rule lives here.
 *
 * Nine Western scholarly editions of Chinese works were catalogued `language: Chinese`,
 * `text_role: original`. Legge's Analects led /zh search for 論語, The She King sat on the native
 * shelf, and their pages are mostly the translators' own words. Found by page tags over all 903
 * non-Siku Chinese volumes, then counted on every page of each (2026-11-04):
 *
 *   volume                 pages  tagged English/French  Chinese only  letters vs Han in body
 *   Legge Analects 1861      536                    326           199   726,482 / 37,928
 *   Legge Mencius 1861       648                    382           254   772,332 / 69,111
 *   Legge Mencius 1893       604                    577            20   896,036 / 61,520
 *   Legge She King 1871      554                    479            67   936,002 / 48,131
 *   Legge Ch'un Ts'ew 5.1    586                    459           109 1,070,380 / 109,222
 *   Legge Ch'un Ts'ew 5.2    540                    362           157 1,083,483 / 152,272
 *   Couvreur Li Ki 1913      816             610 French           182 1,039,362 / 127,131
 *   Hirth/Rockhill 1911      311                    292             9   652,485 / 20,352
 *   Legge Fo-Kwo-Ki 1886     229                    156            62   232,732 / 30,660
 * Control: a Chinese 本草綱目 volume reads 0 English, 182 of 182 Chinese. Scans opened by eye:
 * Analects p.240, Hirth/Rockhill p.156, Fo-Kwo-Ki p.115, Li Ki p.409. Translators of the last
 * two named from their imprints (St. Petersburg 1911; Oxford, Clarendon 1886), not title pages.
 *
 * The Chinese is real and stays second in languages[]. Which language a bilingual edition
 * principally IS is a curatorial call (language-fields.md); this one is Derek's, 2026-11-04.
 *
 * WHAT READS THIS:
 *  - `language` moves each book off the /zh shelf and language filters at once.
 *  - An English edition's reader leads with the transcription, the English pane off. On these
 *    books that matters: the stored `translation` is a machine pass over Legge's own English that
 *    romanises his Chinese (何有於我哉 to "Ho yew yu wo tsae") and drops citations. It is kept, not
 *    deleted, and readers get his words first.
 *  - recountBook re-stamps translation_state.english_original. sync-books-catalog.mjs carries it
 *    to Supabase on updated_at.
 * Nothing re-OCRs or re-translates. Couvreur stays non-English, so it keeps its pane as it was.
 *
 * Usage: node --env-file=.env.production.local scripts/maintenance/fix-7537-western-editions-of-chinese-classics.mjs [--apply]
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'fix-7537-western-editions-of-chinese-classics';
const ENGLISH = { language: 'English', languages: ['English', 'Chinese'] };
const FIXES = [
  ['analects-chinese-classics-vol-1-legge', ENGLISH],
  ['mencius-chinese-classics-vol-2-legge', ENGLISH],
  ['the-chinese-classics-vol-2-the-works-of-mencius-james-legge', ENGLISH],
  ['the-chinese-classics-vol-4-part-2-the-she-king-james-legge', ENGLISH],
  ['the-chinese-classics-vol-5-part-1-the-chun-tsew-with-the-tso', ENGLISH],
  ['the-chinese-classics-vol-5-part-2-the-chun-tsew-with-the-tso', ENGLISH],
  ['description-of-foreign-peoples-rugua', ENGLISH],
  ['fo-guo-ji-record-of-buddhist-kingdoms-faxian', ENGLISH],
  // Couvreur prints Chinese, French and a Latin version; French leads by the page tags.
  ['li-ki-memoires-sur-les-bienseances-et-les-ceremonies-couvreur', { language: 'French', languages: ['French', 'Chinese', 'Latin'] }],
];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1); }
const mc = new MongoClient(uri);
await mc.connect();
const db = mc.db('bookstore');
const B = db.collection('books');

for (const [slug, target] of FIXES) {
  const set = { ...target, language_multi: true, original_language: 'Chinese', is_translation: true, text_role: 'modern-translation', text_role_source: 'human-qa-7537' };
  const fields = Object.fromEntries([...Object.keys(set), 'id', 'title', 'is_first_translation', 'translation_state'].map((k) => [k, 1]));
  const before = await B.findOne({ slug }, { projection: fields });
  if (!before) { console.log(`MISSING ${slug}`); continue; }
  const bookId = before.id || String(before._id);
  console.log(`${APPLY ? 'FIX' : 'WOULD FIX'} ${bookId} ${slug} first=${!!before.is_first_translation} rung=${before.translation_state?.rung}`);
  // Only while it holds the value being corrected, so a later hand fix is never overwritten.
  if (before.language !== 'Chinese') { console.log(`  SKIP: language is "${before.language}"`); continue; }
  if (before.is_first_translation) { console.log('  SKIP: carries a first-translation badge, look by hand'); continue; }
  if (!APPLY) continue;
  const r = await B.updateOne({ _id: before._id, language: 'Chinese' }, {
    $set: {
      ...set,
      updated_at: new Date(),
      'field_provenance.language': {
        source: 'manual',
        value: target.language,
        previous_value: before.language,
        confidence: 'high',
        chosen_from: 'ocr_page_language_declaration',
        issue: 7537,
        note: 'Western scholarly edition: page tags over every page plus reading; decided by Derek 2026-11-04.',
        script: 'fix-7537-western-editions-of-chinese-classics.mjs',
        date: new Date().toISOString(),
      },
    },
  });
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'language-relabelled-from-page-evidence', detail: { issue: 7537, before } });
  await recountBook(db, bookId, { reason: SWEEP });
  const after = await B.findOne({ _id: before._id }, { projection: { language: 1, languages: 1, text_role: 1, 'translation_state.rung': 1, 'translation_state.english_original': 1 } });
  console.log(`  modified ${r.modifiedCount}: ${after.language} ${JSON.stringify(after.languages)} ${after.text_role} rung=${after.translation_state?.rung} english_original=${after.translation_state?.english_original}`);
}
await mc.close();
