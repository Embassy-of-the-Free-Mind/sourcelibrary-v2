#!/usr/bin/env node
/**
 * Repair for the two Wellcome-import defects found in #4311:
 *
 *  1. `books.work_id` set to the raw Wellcome id (route bug, PR #4316) — our
 *     work-identity key must never hold a provider id. Unset it (plus its
 *     source/confidence) so the normal resolver can mint a real identity.
 *  2. `books.language` forced to Sanskrit by the wave-1 pilot driver on
 *     editions that are English/Hindi TRANSLATIONS. Re-read the edition
 *     language from the Wellcome catalogue (languages[0]) and re-derive
 *     text_role from it.
 *
 * Only touches books whose work_id is byte-identical to their wellcome_id,
 * and only rewrites language when the authoritative Wellcome value differs.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-wellcome-work-id-and-language.mjs [--apply]
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find(
  { 'image_source.provider': 'wellcome' },
  { projection: { id: 1, title: 1, language: 1, author: 1, published: 1, year: 1, categories: 1, work_id: 1, work_id_source: 1, wellcome_id: 1, text_role: 1, text_role_source: 1 } },
).toArray();
console.log(`wellcome books: ${books.length}`);

const enLike = s => /^(en|eng|english)$/i.test((s || '').trim());
let idFixes = 0, langFixes = 0, metaFixes = 0;

for (const b of books) {
  const ops = { $set: {}, $unset: {} };

  // --- defect 1: provider id in the work-identity field ---
  if (b.work_id && b.wellcome_id && b.work_id === b.wellcome_id) {
    ops.$unset.work_id = '';
    ops.$unset.work_id_source = '';
    ops.$unset.work_id_confidence = '';
    idFixes++;
    console.log(`  work_id unset: ${b.id} (${b.work_id})  ${(b.title || '').slice(0, 45)}`);
  }

  // --- defect 3: metadata never fetched (route asked for ?include=items only,
  // so author/published/year/categories/language all fell through to
  // 'Unknown' — PR #4319). Backfill from the catalogue for any Wellcome book
  // still carrying the sentinel. Only fills sentinels; never overwrites a real
  // curated value.
  if (b.wellcome_id && (b.author === 'Unknown' || b.published === 'Unknown' || b.language === 'Unknown')) {
    const res = await fetch(`https://api.wellcomecollection.org/catalogue/v2/works/${b.wellcome_id}?include=languages,subjects,production,contributors`);
    if (res.ok) {
      const w = await res.json();
      const author = w.contributors?.find(c => c.roles?.some(r => r.label === 'author'))?.agent?.label
        || w.contributors?.[0]?.agent?.label;
      const published = w.production?.[0]?.dates?.[0]?.label;
      const language = w.languages?.[0]?.label;
      const categories = (w.subjects || []).map(s => s.label);
      if (b.author === 'Unknown' && author) ops.$set.author = author;
      if (b.published === 'Unknown' && published) {
        ops.$set.published = published;
        const yr = (published.match(/(1[0-9]\d\d|20\d\d)/) || [])[1];
        if (yr) ops.$set.year = Number(yr);
      }
      if (b.language === 'Unknown' && language) {
        ops.$set.language = language;
        // text_role was derived at import from language 'Unknown' (non-English
        // => 'original'). Re-derive now that the real edition language is known.
        ops.$set.text_role = enLike(language) ? 'modern-translation' : 'original';
        ops.$set.text_role_source = 'repair-4311';
        // original_language is only meaningful when THIS edition is a
        // translation. A second listed language on a non-English edition is
        // usually apparatus (an English introduction to a Sanskrit text), not a
        // source — reading it as one produced `language: Sanskrit,
        // original_language: English` on a Sanskrit original. So claim a source
        // only for English-language editions, and only when exactly one other
        // language is listed.
        const others = (w.languages || []).map(l => l.label).filter(l => l !== language);
        if (enLike(language) && others.length === 1) ops.$set.original_language = others[0];
      }
      if (categories.length && !(b.categories || []).length) ops.$set.categories = categories;
      if (Object.keys(ops.$set).length) {
        metaFixes++;
        console.log(`  metadata: ${(b.title || '').slice(0, 40)} -> author=${ops.$set.author ?? '-'} pub=${ops.$set.published ?? '-'} lang=${ops.$set.language ?? '-'} cats=${categories.length}`);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // --- defect 2: edition language forced to Sanskrit on a translation ---
  // Scoped DELIBERATELY NARROW: only books currently labelled Sanskrit, i.e.
  // the ones the wave-1 pilot driver overrode. Wellcome's `languages[]` order
  // is not a documented edition-language signal, so it is used here only to
  // undo a value we know we wrote — never to relabel a book someone else's
  // import or a curator set (a wide sweep here is how 547 translation editions
  // nearly got mislabelled; see invariants/language-fields.md).
  if (b.wellcome_id && b.language === 'Sanskrit') {
    const res = await fetch(`https://api.wellcomecollection.org/catalogue/v2/works/${b.wellcome_id}?include=languages`);
    if (res.ok) {
      const w = await res.json();
      const editionLang = w.languages?.[0]?.label;
      const otherLangs = (w.languages || []).slice(1).map(l => l.label);
      if (editionLang && editionLang !== b.language) {
        ops.$set.language = editionLang;
        // A non-English edition of a Sanskrit work keeps Sanskrit as its source;
        // record it so text_role and the FT layer can read the relationship.
        if (otherLangs.includes('Sanskrit') || b.language === 'Sanskrit') {
          ops.$set.original_language = 'Sanskrit';
        }
        // Re-derive: the import heuristic treats a non-English language as
        // 'original', which is exactly what the forced value produced.
        ops.$set.text_role = enLike(editionLang) ? 'modern-translation' : 'original';
        ops.$set.text_role_source = 'repair-4311';
        langFixes++;
        console.log(`  language: ${b.language} -> ${editionLang} (${otherLangs.join('/')})  ${(b.title || '').slice(0, 45)}`);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (APPLY && (Object.keys(ops.$set).length || Object.keys(ops.$unset).length)) {
    // updated_at bump is load-bearing for the Supabase catalog sync.
    ops.$set.updated_at = new Date();
    const update = {};
    if (Object.keys(ops.$set).length) update.$set = ops.$set;
    if (Object.keys(ops.$unset).length) update.$unset = ops.$unset;
    await db.collection('books').updateOne({ id: b.id }, update);
  }
}

console.log(`\nwork_id unsets: ${idFixes}  language corrections: ${langFixes}  metadata backfills: ${metaFixes}`);
console.log(APPLY ? 'applied.' : 'DRY RUN — pass --apply to write.');
await client.close();
