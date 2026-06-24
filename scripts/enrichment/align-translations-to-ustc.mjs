#!/usr/bin/env node
/**
 * Align modern English translations (translation_catalogs, ~26K rows) with
 * the early-modern source editions they translate (ustc_editions, 1.6M
 * rows covering 1450-1650 European printing). Result: a populated
 * translation_catalog_ustc_links join table.
 *
 * Per-translation loop with N concurrent pg connections — the original
 * single-statement INSERT...SELECT ran for 6h with 0 rows because the
 * planner picked a row-by-row plan anyway; the bounded per-row queries
 * give visible progress, error isolation, and saturate the GIN trigram
 * index on lower(ustc_editions.title).
 *
 * Matching strategy:
 *   - Author: word-boundary regex on surname (translation_catalogs stores
 *     bare surnames like "aquinas"; USTC stores "Thomas Aquinas, St" —
 *     trigram similarity at 0.85 misses these almost entirely, ~0.47 is
 *     typical, see _tmp-diag.mjs probe results).
 *   - Title: pg_trgm similarity >= 0.5 (catches Latin renamings like
 *     "consolation of philosophy" ↔ "Consolatio philosophiae" at ~0.63;
 *     misses radical renamings like "Aeneid" ↔ "Aeneis" which need an
 *     aliases table — out of scope here).
 *
 * Measured 2026-05-29 run: 17,660 eligible translations, 14.6% hit rate,
 * 34,293 links written across 6,038 distinct USTC editions, ~2 hours.
 * Top hits are the canon: Kempis Imitatio (3,081), Boccaccio Decameron
 * (1,440), Boethius De Consolatione (1,287), Ovid Metamorphoses (1,272),
 * Aquinas Summa (850).
 *
 * Idempotent: ON CONFLICT (translation_id, ustc_edition_id) DO NOTHING.
 *
 * Local IPv6 routing to Supabase is flaky; run from Hetzner or anywhere
 * with working IPv6 to Supabase.
 *
 * Usage:
 *   node scripts/enrichment/align-translations-to-ustc.mjs               # full apply
 *   node scripts/enrichment/align-translations-to-ustc.mjs --dry-run     # report counts only
 */

import pg from 'pg';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
if (!env.SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL in env');
  process.exit(1);
}

const TITLE_THRESHOLD = 0.5;
const CONCURRENCY = 5;
const BATCH_INSERT = 100;
const dryRun = process.argv.includes('--dry-run');

async function withClient(cb) {
  const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
  await c.connect();
  await c.query('SET statement_timeout = 60000');
  try { return await cb(c); } finally { await c.end(); }
}

async function getCandidates() {
  return withClient(async c => {
    const r = await c.query(`
      SELECT id, author_surname_lower, canonical_work_lower
      FROM translation_catalogs
      WHERE author_surname_lower IS NOT NULL AND author_surname_lower <> ''
        AND canonical_work_lower IS NOT NULL AND canonical_work_lower <> ''
        AND char_length(author_surname_lower) >= 3
        AND char_length(canonical_work_lower) >= 5
      ORDER BY id
    `);
    return r.rows;
  });
}

async function findMatches(c, t) {
  const r = await c.query(`
    SELECT u.id AS ustc_id,
      similarity($1::text, lower(u.author_1))::numeric(4,3) AS a_sim,
      similarity($2::text, lower(u.title))::numeric(4,3) AS t_sim
    FROM ustc_editions u
    WHERE lower(u.author_1) ~ ('\\m' || $1::text || '\\M')
      AND $2::text % lower(u.title)
      AND similarity($2, lower(u.title)) >= $3::numeric
    LIMIT 200
  `, [t.author_surname_lower, t.canonical_work_lower, TITLE_THRESHOLD]);
  return r.rows.map(row => ({
    translation_id: t.id,
    ustc_edition_id: row.ustc_id,
    author_sim: row.a_sim,
    title_sim: row.t_sim,
  }));
}

async function insertBatch(c, rows) {
  if (!rows.length) return 0;
  const values = [];
  const params = [];
  let p = 1;
  for (const r of rows) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, 'trigram_word_boundary', 'medium')`);
    params.push(r.translation_id, r.ustc_edition_id, r.author_sim, r.title_sim);
  }
  const sql = `INSERT INTO translation_catalog_ustc_links
    (translation_id, ustc_edition_id, author_sim, title_sim, link_method, link_confidence)
    VALUES ${values.join(',')}
    ON CONFLICT (translation_id, ustc_edition_id) DO NOTHING`;
  const r = await c.query(sql, params);
  return r.rowCount;
}

async function worker(idx, queue, stats) {
  await withClient(async c => {
    let pending = [];
    while (true) {
      const t = queue.next();
      if (!t) break;
      try {
        const matches = await findMatches(c, t);
        if (matches.length) pending.push(...matches);
        stats.processed++;
        if (matches.length > 0) stats.withMatches++;
        if (!dryRun && pending.length >= BATCH_INSERT) {
          stats.inserted += await insertBatch(c, pending);
          pending = [];
        }
      } catch (e) {
        stats.errors++;
        if (stats.errors < 5) console.error(`w${idx} t${t.id} err: ${e.message}`);
      }
    }
    if (!dryRun && pending.length) {
      stats.inserted += await insertBatch(c, pending);
    } else if (dryRun) {
      stats.wouldInsert = (stats.wouldInsert || 0) + pending.length;
    }
  });
}

async function main() {
  console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===');
  console.log('Loading candidate translations…');
  const candidates = await getCandidates();
  console.log(`${candidates.length.toLocaleString()} eligible translations.`);

  let i = 0;
  const queue = { next: () => i < candidates.length ? candidates[i++] : null };
  const stats = { processed: 0, withMatches: 0, inserted: 0, errors: 0 };

  const t0 = Date.now();
  const reporter = setInterval(() => {
    const dur = (Date.now() - t0) / 1000;
    const rate = stats.processed / dur;
    const eta = ((candidates.length - stats.processed) / rate / 60).toFixed(1);
    console.log(`  ${stats.processed}/${candidates.length} (${rate.toFixed(1)}/s) matches=${stats.withMatches} inserted=${stats.inserted} err=${stats.errors} eta=${eta}m`);
  }, 30000);

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i, queue, stats)));
  clearInterval(reporter);

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDONE in ${dur}s`);
  console.log(`Processed: ${stats.processed}/${candidates.length}`);
  console.log(`Translations with matches: ${stats.withMatches}`);
  console.log(`Total inserted: ${stats.inserted}`);
  console.log(`Errors: ${stats.errors}`);

  await withClient(async c => {
    const r = await c.query('SELECT count(*) FROM translation_catalog_ustc_links');
    console.log(`Final link count: ${r.rows[0].count}`);
  });
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
