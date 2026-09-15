#!/usr/bin/env node
/**
 * PRIOR ART: scripts/import/import-oraec.mjs — the same idea (a publisher's own
 * transcription becomes the page's source text, stamped with a corpus name in place
 * of a model), but it CREATES books from a corpus dump. This one repairs books that
 * already exist and carry a model's invented reading. scripts/etcsl/fetch-cdli-witnesses.mjs
 * already talks to CDLI, but only to find witness P-numbers and photographs — it never
 * fetches an inscription.
 *
 * Replace fabricated cuneiform "OCR" with CDLI's published ATF transliteration (#4851).
 *
 * WHY
 * ---
 * A vision model does not read cuneiform from a tablet photograph. What it emits is
 * recall keyed off the museum number, and it emits it with a confidence score: our
 * `P102318` page claims "1 barig 1 ban2 fresh apples … to the palace" at
 * `<confidence>0.95</confidence>`, where CDLI's published reading is "2 grain-fed
 * sheep … from Abbasaga". Our own research note measured this (`/blog/cuneiform-ocr`:
 * a ~15% F1 ceiling, "a cuneiform commentator, not a cuneiform reader") — and then the
 * four exhibit tablets were published with the fabrications presented as transcription.
 *
 * WHAT IT WRITES
 * `pages.ocr.data` = the ATF, with `ocr.source: 'cdli-atf'` and `ocr.model: null`,
 * because the transliteration is CDLI's scholarship and must not read as ours or as a
 * model's. The fabricated OCR and translation are moved to `page_revisions` first
 * (never deleted), and `translation` is cleared: a translation of an invented
 * transliteration cannot be repaired, only withdrawn. Re-translating the ATF is a
 * separate, deliberate run.
 *
 * WHAT IT REFUSES
 * A book whose ATF does not map 1:1 onto our page images:
 *   - a COMPOSITE (`RIME 4.03.06.add21 (Laws of Hammurapi) composite`, P464358) is a
 *     modern scholarly reconstruction of a work, not a reading of our photograph;
 *     pasting it under the stele image would be a new provenance claim, not a fix.
 *   - a multi-surface monument (P213189, 40K of ATF across four faces vs our two
 *     images) needs the surface/column structure mapped to pages first.
 * Both are reported and skipped. Never guess (see `lesson_stated_provenance_traps`).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/cdli-atf-source.mjs                 # dry run, all CDLI books
 *   node scripts/import/cdli-atf-source.mjs --apply
 *   node scripts/import/cdli-atf-source.mjs --book-id=ID --apply
 */
import { MongoClient } from 'mongodb';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';

const APPLY = process.argv.includes('--apply');
const BOOK_ID = (process.argv.find(a => a.startsWith('--book-id=')) || '').split('=')[1] || null;
const CDLI_ARTIFACT = 'https://cdli.earth/artifacts';

/** CDLI's JSON is the only working route to an inscription: the `.atf` and
 *  `/inscription` paths 404/500, and cdli.mpiwg-berlin.mpg.de now 301s here. */
async function fetchArtifact(pNumber) {
  const res = await fetch(`${CDLI_ARTIFACT}/${pNumber}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`CDLI ${res.status} for P${pNumber}`);
  const body = await res.json();
  const a = Array.isArray(body) ? body[0] : body;
  return {
    designation: a?.designation || null,
    atf: a?.inscription?.atf || null,
    genres: (a?.genres || []).map(g => g?.genre?.genre).filter(Boolean),
    languages: (a?.languages || []).map(l => l?.language?.language).filter(Boolean),
  };
}

/** Surfaces the ATF declares (`@tablet`, `@obverse`, `@column i`, …). */
function atfSurfaces(atf) {
  return (atf.match(/^@\w[^\n]*/gm) || []).map(s => s.trim());
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const query = BOOK_ID ? { id: BOOK_ID } : { 'image_source.provider': 'cdli' };
  const books = await db.collection('books').find(query).toArray();
  console.log(`${books.length} CDLI book(s)${APPLY ? '' : '  [DRY RUN]'}\n`);

  for (const book of books) {
    const pNumber = String(book.image_source?.identifier || '').replace(/^P/i, '');
    if (!pNumber) { console.log(`SKIP  ${book.id}  no P-number on image_source.identifier`); continue; }

    let art;
    try { art = await fetchArtifact(pNumber); }
    catch (e) { console.log(`SKIP  ${book.slug}  ${e.message}`); continue; }

    if (!art.atf) { console.log(`SKIP  ${book.slug}  P${pNumber} has no published ATF`); continue; }

    const pages = await db.collection('pages').find({ book_id: book.id }).sort({ page_number: 1 }).toArray();
    const surfaces = atfSurfaces(art.atf);
    const composite = /composite/i.test(art.designation || '');

    console.log(`${book.slug}\n  P${pNumber}  ${art.designation}  [${art.genres.join(', ')}]  ATF ${art.atf.length} chars, surfaces: ${surfaces.length}, our pages: ${pages.length}`);

    // The unit that must line up is the ARTIFACT, not the surface: a tablet's ATF
    // covers its obverse, reverse and columns, and our single "full-view" photograph
    // is that same tablet. So one page and one artifact is a match, however many
    // `@surface` lines the ATF declares. Two pages against one monument's 85 surfaces
    // is not — that needs a surface→page mapping nobody has made yet.
    if (composite) { console.log('  HOLD  composite — a modern reconstruction of the WORK, not a reading of our photograph (#4851)\n'); continue; }
    if (pages.length !== 1) {
      console.log(`  HOLD  one artifact across ${pages.length} page images — needs a surface→page mapping first (#4851)\n`);
      continue;
    }

    const page = pages[0];
    const hadOcr = (page.ocr?.data || '').length;
    const hadTr = (page.translation?.data || '').length;
    console.log(`  page ${page.id}: replacing ${hadOcr} chars of model OCR, withdrawing ${hadTr} chars of translation`);
    if (!APPLY) { console.log('  (dry run)\n'); continue; }

    // Both fabrications kept, never deleted — the evidence is the point (#4851).
    await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'cdli_atf_replaces_fabricated_ocr' });
    if (hadTr) await saveRevisionBeforeOverwrite(db, page.id, 'translation', { reason: 'cdli_atf_withdraws_fabricated_translation' });

    const now = new Date();
    await db.collection('pages').updateOne({ id: page.id }, {
      $set: {
        ocr: {
          data: art.atf,
          language: art.languages[0] || book.language || null,
          // Not a model reading and not ours: CDLI's editors transliterated this.
          model: null,
          source: 'cdli-atf',
          source_url: `${CDLI_ARTIFACT}/${pNumber}`,
          designation: art.designation,
          updated_at: now,
        },
        translation: {},
        updated_at: now,
      },
    });
    // Counters come from the canonical module, never from arithmetic here
    // (tests/unit/page-counter-writers.test.ts, #4499).
    const [counts] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(book.id)).toArray();
    await db.collection('books').updateOne({ id: book.id }, {
      $set: {
        pages_ocr: counts?.with_ocr ?? 0,
        pages_translated: counts?.with_translation ?? 0,
        'image_source.inscription_source': 'cdli-atf',
        updated_at: now,
      },
    });
    console.log('  WROTE ATF, translation withdrawn\n');
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
