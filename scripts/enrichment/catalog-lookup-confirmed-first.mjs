#!/usr/bin/env node
/**
 * Free catalog-lookup pass: for each confirmed_first book, query the
 * translation_catalogs table by author surname + canonical-work fragments.
 * If any authoritative-source row matches, the book likely has an English
 * translation that the prior pipeline missed.
 *
 * The original verify-translation-claims.mjs queried Open Library / Google
 * Books / Internet Archive APIs at runtime, but those have known gaps —
 * scholarly translations (Loeb, I Tatti, Brill, university press) are
 * sparsely indexed. The translation_catalogs Supabase table is broader
 * (~26,855 rows, see breakdown in task #12) and includes UNESCO Index
 * Translationum master + LoC MARC + Open Library + HathiTrust + extended
 * Harvard/Liverpool/Cistercian/PIMS + publisher feeds.
 *
 * Authoritative sources (exclude sl_ft_llm_claim since that's just our
 * LLM-cache, not independent verification):
 *   unesco_master, loc_marc, openlibrary, hathitrust, loeb, brill,
 *   cambridge, chicago_indiana, validated_additions, sl_ft_catalog_verified,
 *   extended_*, publisher_*, godwin, penguin, broadview_norton_hackett,
 *   cua_paulist, routledge_degruyter
 *
 * Writes results to translation_verification.catalog_lookup_2026_05_30
 * for review or follow-up apply.
 *
 * Usage:
 *   node scripts/enrichment/catalog-lookup-confirmed-first.mjs --dry-run
 *   node scripts/enrichment/catalog-lookup-confirmed-first.mjs --save
 *   node scripts/enrichment/catalog-lookup-confirmed-first.mjs --save --limit 100
 */

import { MongoClient } from 'mongodb';
import pg from 'pg';
import fs from 'fs';

function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          env[m[1].trim()] = v;
        }
      }
      break;
    } catch {}
  }
  return { ...process.env, ...env };
}

const env = loadEnv();
const save = process.argv.includes('--save');
const getArg = name => { const i = process.argv.indexOf(name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : null;

const AUTH_SOURCES = [
  'unesco_master', 'loc_marc', 'openlibrary', 'hathitrust',
  'extended_unesco_index_translationum', 'extended_harvard_lcl',
  'extended_harvard_itrl', 'extended_harvard_doml',
  'extended_post-2009_(api/web_search)', 'loeb', 'cua_paulist',
  'cambridge', 'chicago_indiana', 'routledge_degruyter',
  'broadview_norton_hackett', 'publisher_hackett', 'publisher_penguin',
  'penguin', 'publisher_cua_press', 'publisher_oup', 'brill',
  'publisher_other_publisher', 'publisher_paulist_press', 'publisher_cup',
  'extended_liverpool_tth', 'extended_cistercian_publications', 'godwin',
  'extended_pims_toronto', 'publisher_yale_up', 'publisher_jhu_press',
  'validated_additions', 'sl_ft_catalog_verified',
];

function extractSurname(authorStr) {
  if (!authorStr) return '';
  const cleaned = authorStr.split(/[;|]/)[0].trim();
  const comma = cleaned.indexOf(',');
  let name = comma > 0 ? cleaned.substring(0, comma) : cleaned;
  name = name.replace(/\b(saint|st\.?|von|de|van|del|di|da|al-)\b/gi, '').trim();
  const parts = name.split(/\s+/);
  return (parts[parts.length - 1] || '').toLowerCase();
}

function canonicalWork(book) {
  const raw = (book.display_title || book.title || '').trim();
  return raw
    .replace(/\s*[(\[][^\)\]]*[)\]]\s*$/g, '')
    .replace(/\b(vol(ume)?|tom(us|e)|book|part|pt|bk)\.?\s*[ivxlcdm\d]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const mongo = new MongoClient(env.MONGODB_URI); await mongo.connect();
const db = mongo.db(env.MONGODB_DB || 'bookstore');
const pgc = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await pgc.connect();
await pgc.query('SET statement_timeout = 30000');

const match = {
  'translation_verification.disposition': 'confirmed_first',
  // Stable + legacy markers both honored (#2332 Task 2).
  'translation_verification.audit_applied': { $ne: true },
  'translation_verification.audit_applied_2026_05_30': { $ne: true },
  'translation_verification.catalog_lookup': { $exists: false },
  'translation_verification.catalog_lookup_2026_05_30': { $exists: false },
  visible: true,
  pages_count: { $gt: 0 },
};

const cursor = db.collection('books').find(match).project({
  id: 1, title: 1, display_title: 1, author: 1, language: 1,
});
if (LIMIT) cursor.limit(LIMIT);
const books = await cursor.toArray();
console.log(`=== Catalog-lookup pass: ${books.length} confirmed_first books ===`);
console.log(`Mode: ${save ? 'APPLYING' : 'DRY RUN'}\n`);

const placeholderSources = `'${AUTH_SOURCES.join("','")}'`;

let hits = 0, processed = 0;
const samples = [];

const t0 = Date.now();
for (const b of books) {
  processed++;
  const surname = extractSurname(b.author);
  const work = canonicalWork(b);
  if (surname.length < 3 || work.length < 4) continue;

  // Hit on (author surname matches) + (work title fragment trigram matches)
  const r = await pgc.query(`
    SELECT id, source, english_title, translator, pub_year, publisher
    FROM translation_catalogs
    WHERE source IN (${placeholderSources})
      AND author_surname_lower = $1::text
      AND (
        canonical_work_lower ILIKE '%' || $2::text || '%'
        OR english_title_lower ILIKE '%' || $2::text || '%'
        OR similarity(canonical_work_lower, $2::text) >= 0.55
        OR similarity(english_title_lower, $2::text) >= 0.55
      )
    LIMIT 3
  `, [surname, work.slice(0, 80)]);

  if (r.rows.length === 0) continue;
  hits++;
  const best = r.rows[0];

  if (samples.length < 8) {
    samples.push({
      id: b.id,
      bookTitle: (b.display_title || b.title || '').slice(0, 50),
      lang: b.language,
      surname,
      hit: best,
    });
  }

  if (save) {
    await db.collection('books').updateOne(
      { _id: b._id },
      { $set: {
        'translation_verification.catalog_lookup': {
          looked_up_at: new Date(),
          translation_found: true,
          hit: {
            source: best.source,
            english_title: best.english_title,
            translator: best.translator,
            pub_year: best.pub_year,
            publisher: best.publisher,
          },
          additional_hits: r.rows.length - 1,
        },
      }}
    );
  }

  if (processed % 500 === 0) {
    const dur = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  ${processed}/${books.length} processed, ${hits} hits (${dur}s)`);
  }
}

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nProcessed ${processed}/${books.length} in ${dur}s`);
console.log(`Hits: ${hits} (${(100 * hits / processed).toFixed(1)}%)`);

console.log('\n=== 8 sample hits ===');
for (const s of samples) {
  console.log(`  [${s.id}] (${s.lang}) "${s.bookTitle}" / surname=${s.surname}`);
  console.log(`    → [${s.hit.source}] "${(s.hit.english_title||'').slice(0,55)}" by ${(s.hit.translator||'').slice(0,30)} (${s.hit.pub_year})`);
}

await mongo.close(); await pgc.end();
