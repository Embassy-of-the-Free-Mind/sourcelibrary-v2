/**
 * #5288 — project the translation-state ladder into Supabase `books_catalog`.
 *
 * PRIOR ART: scripts/migration/add-books-catalog-pages-translated-es.mjs — the
 * template (same ALTER + index + Mongo backfill shape); this adds two columns it
 * does not carry.
 *
 * Why: the catalog's only translation signal was `pages_translated > 0`, so the
 * browse grid, the collection manifest and the collection header (sync-worker's
 * `book_count`) all called a 25-page preview "translated", and an English
 * original with nothing to translate "untranslated". The ladder
 * (.claude/docs/translation-state.md, step 1 #5284) gives one rung per book;
 * browseBooks' `hasTranslation` now means the named view `readable_in_english`:
 *
 *   translation_rung IN (readable, complete)
 *   OR (english_original AND translation_rung IN (transcribed, translating))
 *
 * What it does (idempotent, safe to re-run):
 *   1. ADD COLUMN IF NOT EXISTS translation_rung text (NULL = not yet mirrored)
 *      and english_original boolean NOT NULL DEFAULT false, plus a CHECK that
 *      the rung is one of the seven ladder values.
 *   2. Index translation_rung (browseBooks / countBooks filter on it).
 *   3. Backfill every catalog row from Mongo through catalogTranslationColumns()
 *      — the stored `translation_state` when stamped, else the same rule applied
 *      to the stored counters (scripts/lib/page-counts.mjs). Only rows whose
 *      values differ are written.
 *
 * The writer half is scripts/workers/sync-books-catalog.mjs (and
 * rebuild-books-catalog.mjs): both spread catalogTranslationColumns() into the
 * row and carry its inputs in the projection.
 *
 * NO DELETE, no TRUNCATE: this only adds columns and UPDATEs them.
 *
 * Usage:
 *   secret-lover run -- node scripts/migration/add-books-catalog-translation-rung.mjs [--dry-run]
 *   (foreground only — SUPABASE_DB_URL comes from the Keychain)
 */
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { TRANSLATION_RUNGS, catalogTranslationColumns, isReadableInEnglish } from '../lib/page-counts.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const MONGODB_URI = process.env.MONGODB_URI;
if (!SUPABASE_DB_URL || !MONGODB_URI) {
  console.error('Missing SUPABASE_DB_URL or MONGODB_URI');
  process.exit(1);
}

const READABLE_IN_ENGLISH_SQL =
  `(translation_rung IN ('readable','complete') OR (english_original AND translation_rung IN ('transcribed','translating')))`;

// The direct host db.<ref>.supabase.co is IPv6-only (.claude/docs/supabase.md);
// fall back to the IPv4 session pooler (port 5432 allows DDL), same credentials
// with the user qualified by the project ref.
async function connectPg() {
  try {
    const c = new pg.Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    await c.connect();
    return c;
  } catch (e) {
    console.log(`   direct connection failed (${e.code || e.message}); trying the session pooler`);
  }
  const m = SUPABASE_DB_URL.match(/^postgres(?:ql)?:\/\/[^:]+:(.+)@db\.([^.]+)\.supabase\.co:\d+\/(\w+)/);
  if (!m) throw new Error('SUPABASE_DB_URL has an unexpected shape');
  const [, password, ref, database] = m;
  for (const host of ['aws-1-eu-west-1', 'aws-0-eu-west-1', 'aws-0-eu-central-1'].map(h => `${h}.pooler.supabase.com`)) {
    try {
      const c = new pg.Client({ host, port: 5432, database, user: `postgres.${ref}`, password: decodeURIComponent(password), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
      await c.connect();
      console.log(`   connected via ${host}`);
      return c;
    } catch (e) {
      console.log(`   ${host}: ${String(e.message).slice(0, 80)}`);
    }
  }
  throw new Error('Could not connect to Supabase Postgres');
}

async function main() {
  const c = await connectPg();
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  console.log('1. ALTER TABLE books_catalog ADD COLUMN translation_rung, english_original...');
  if (!DRY_RUN) {
    await c.query(`ALTER TABLE books_catalog ADD COLUMN IF NOT EXISTS translation_rung text`);
    await c.query(`ALTER TABLE books_catalog ADD COLUMN IF NOT EXISTS english_original boolean NOT NULL DEFAULT false`);
    const { rows: hasCheck } = await c.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'books_catalog_translation_rung_check'`
    );
    if (hasCheck.length === 0) {
      const list = TRANSLATION_RUNGS.map(r => `'${r}'`).join(',');
      await c.query(
        `ALTER TABLE books_catalog ADD CONSTRAINT books_catalog_translation_rung_check
           CHECK (translation_rung IS NULL OR translation_rung IN (${list}))`
      );
    }
    console.log('2. CREATE INDEX books_catalog_translation_rung_idx...');
    await c.query(`CREATE INDEX IF NOT EXISTS books_catalog_translation_rung_idx ON books_catalog (translation_rung)`);
  }

  console.log('3. Reading Mongo books (counters + translation_state)...');
  const docs = await db.collection('books').find({}, {
    projection: {
      _id: 0, id: 1, visible: 1, language: 1, content_type: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, pages_translatable: 1,
      'translation_state.rung': 1, 'translation_state.english_original': 1, 'translation_state.version': 1,
    },
  }).toArray();
  const stamped = docs.filter(d => d.translation_state?.rung).length;
  console.log(`   ${docs.length} books read; ${stamped} carry a translation_state stamp, the rest use the counter fallback.`);

  const ids = [];
  const rungs = [];
  const english = [];
  const liveByRung = {};
  let liveReadableInEnglish = 0;
  for (const d of docs) {
    if (!d.id) continue;
    const cols = catalogTranslationColumns(d);
    ids.push(d.id);
    rungs.push(cols.translation_rung);
    english.push(cols.english_original);
    if (d.visible === true && (d.pages_count || 0) > 0) {
      liveByRung[cols.translation_rung] = (liveByRung[cols.translation_rung] || 0) + 1;
      if (isReadableInEnglish({ rung: cols.translation_rung, english_original: cols.english_original })) liveReadableInEnglish++;
    }
  }
  console.log('   Mongo, visible AND pages_count > 0, by rung (what the catalog should show):');
  for (const [r, n] of Object.entries(liveByRung).sort((a, b) => b[1] - a[1])) console.log(`   ${r.padEnd(14)} ${n}`);
  console.log(`   readable_in_english: ${liveReadableInEnglish}`);

  if (DRY_RUN) {
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM books_catalog`);
    console.log(`   books_catalog has ${rows[0].n} rows; ${ids.length} Mongo books would be matched by id.`);
    console.log('DRY RUN — nothing written.');
    await c.end();
    await mongo.close();
    return;
  } else {
    let updated = 0;
    for (let i = 0; i < ids.length; i += 2000) {
      const res = await c.query(
        `UPDATE books_catalog b SET translation_rung = v.r, english_original = v.e
           FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS r, unnest($3::bool[]) AS e) v
          WHERE b.id = v.id
            AND (b.translation_rung IS DISTINCT FROM v.r OR b.english_original IS DISTINCT FROM v.e)`,
        [ids.slice(i, i + 2000), rungs.slice(i, i + 2000), english.slice(i, i + 2000)]
      );
      updated += res.rowCount;
    }
    console.log(`   Updated ${updated} catalog rows.`);
  }

  const { rows: byRung } = await c.query(
    `SELECT coalesce(translation_rung, '(null)') AS rung, count(*)::int AS n
       FROM books_catalog WHERE visible AND pages_count > 0 GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log('\nbooks_catalog, visible AND pages_count > 0, by rung:');
  for (const r of byRung) console.log(`   ${r.rung.padEnd(14)} ${r.n}`);
  const { rows: rie } = await c.query(
    `SELECT count(*)::int AS n FROM books_catalog WHERE visible AND pages_count > 0 AND ${READABLE_IN_ENGLISH_SQL}`
  );
  const { rows: anyPage } = await c.query(
    `SELECT count(*)::int AS n FROM books_catalog WHERE visible AND pages_count > 0 AND pages_translated > 0`
  );
  console.log(`   readable_in_english: ${rie[0].n}  (old hasTranslation, pages_translated > 0: ${anyPage[0].n})`);

  await c.end();
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
