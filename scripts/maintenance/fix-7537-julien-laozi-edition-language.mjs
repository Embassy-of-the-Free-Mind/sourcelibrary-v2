#!/usr/bin/env node
/**
 * PRIOR ART: `fix-3942-edition-vs-work-language.mjs` made this same correction for de
 * Slane's French Ibn Khaldun and its writes are copied here. It carries a fixed list of
 * two records. `relabel-bilingual-edition.mjs` keeps the CATALOGUED language first, which
 * would leave this French book filed under Chinese, the fault being fixed.
 *
 * `dao-de-jing-laozi` is Stanislas Julien's 1842 Paris edition: a French translation and
 * commentary with the Chinese text. It was catalogued Chinese with text_role original, so
 * it was the first hit for 道德經 on /zh with French under 中文原文, and its English read as
 * a translation from Chinese when it is English from French.
 *
 * Evidence, 2026-11-04 (language-fields.md asks for two instruments and a reading):
 *   1. Characters across 355 pages of OCR: 375,206 Latin-script, 7,272 Han. 98% Latin.
 *   2. Page tags naming French: 295 of 355. Chinese alone: 44. English: 1.
 *   3. By eye: the title page (LE LIVRE DE LA VOIE ET DE LA VERTU … PAR STANISLAS JULIEN,
 *      PARIS, M DCCC XLII) and p.20, French.
 * Chinese is on enough pages to be substantial, so it stays second in languages[].
 *
 * WHAT READS THIS: `language` feeds the /zh shelf and every language filter at once;
 * sync-books-catalog.mjs carries it to Supabase on its next incremental run, which is why
 * updated_at is bumped. textRoleRank in search ordering reads text_role. Nothing re-OCRs
 * or re-translates on this change.
 *
 * Usage: node --env-file=.env.production.local scripts/maintenance/fix-7537-julien-laozi-edition-language.mjs [--apply]
 */
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const _id = ObjectId.createFromHexString('69e8b25c2ff2a8dc09e7773b');
const SET = {
  language: 'French',
  languages: ['French', 'Chinese'],
  language_multi: true,
  original_language: 'Chinese',
  is_translation: true,
  text_role: 'modern-translation',
  text_role_source: 'human-qa-7537',
};

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1); }
const mc = new MongoClient(uri);
await mc.connect();
const db = mc.db('bookstore');
const B = db.collection('books');

const fields = Object.fromEntries([...Object.keys(SET), 'title', 'is_first_translation'].map((k) => [k, 1]));
const before = await B.findOne({ _id }, { projection: fields });
if (!before) { console.error('Not found.'); await mc.close(); process.exit(1); }
console.log(JSON.stringify({ title: before.title, is_first_translation: before.is_first_translation }));

// Only while it holds the value being corrected, so a later hand fix is never overwritten.
if (before.language !== 'Chinese') {
  console.log(`SKIP: language is "${before.language}", expected "Chinese".`);
  await mc.close();
  process.exit(0);
}
for (const [k, v] of Object.entries(SET)) console.log(`  ${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(v)}`);

if (!APPLY) {
  console.log('Dry run. Pass --apply to write.');
} else {
  const r = await B.updateOne({ _id, language: 'Chinese' }, {
    $set: {
      ...SET,
      updated_at: new Date(),
      'field_provenance.language': {
        source: 'manual',
        value: 'French',
        previous_value: before.language,
        confidence: 'high',
        chosen_from: 'ocr_page_language_declaration',
        issue: 7537,
        note: 'Julien 1842: 98% Latin-script characters, French on 295 of 355 page tags, title page read by eye.',
        script: 'fix-7537-julien-laozi-edition-language.mjs',
        date: new Date().toISOString(),
      },
    },
  });
  await recordSweepAction(db, {
    sweep: 'fix-7537-julien-laozi-edition-language',
    book_id: String(_id),
    action: 'language-relabelled-from-page-evidence',
    detail: { issue: 7537, before },
  });
  const after = await B.findOne({ _id }, { projection: fields });
  console.log('modified', r.modifiedCount, 'read back', JSON.stringify(after));
}
await mc.close();
