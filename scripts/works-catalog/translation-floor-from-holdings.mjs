#!/usr/bin/env node
/**
 * Translation-coverage FLOOR from our own holdings (#2453, Phase 2).
 *
 * The strongest evidence that a work has an English translation is that WE serve
 * one. `work_holdings.translated_pct` (built by build-holdings.mjs from each
 * Mongo book's pages_translated / readable-pages) gives that directly. This sets
 * works.translation_status from it — evidenced, free, no Gemini:
 *   translated_pct >= 90  -> 'full'
 *   0 < translated_pct < 90 -> 'partial'
 * Evidence records the SL book id + that it's an SL (machine) translation, so the
 * census never conflates it with a published scholarly translation. Only upgrades
 * 'unknown' rows — never downgrades a 'full'/'partial' set by another method.
 *
 * This is a FLOOR (only works we already hold + have translated). The broader
 * census — works translated by OTHERS, which we don't hold — needs external
 * authorities + verification (Phase 3, paid) and is out of scope here.
 *
 * Run on Hetzner (SUPABASE_DB_URL). Idempotent.
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/translation-floor-from-holdings.mjs           # measure
 *   node scripts/works-catalog/translation-floor-from-holdings.mjs --apply   # write
 */
import { pgClient } from './lib.mjs';

const APPLY = process.argv.includes('--apply');
const c = pgClient();
await c.connect();

// per work, best (highest translated_pct) held copy
const measure = await c.query(`
  with held as (
    select distinct on (work_id) work_id, book_id, translated_pct as pct
    from work_holdings where translated_pct > 0
    order by work_id, translated_pct desc
  )
  select w.tradition,
    count(*) filter (where h.pct >= 90) full,
    count(*) filter (where h.pct > 0 and h.pct < 90) partial
  from held h join works w on w.id = h.work_id
  where w.translation_status = 'unknown'
  group by 1 order by 1`);
let tf = 0, tp = 0;
console.log('tradition    full  partial');
for (const r of measure.rows) { console.log(' ', String(r.tradition).padEnd(11), String(r.full).padStart(4), String(r.partial).padStart(8)); tf += +r.full; tp += +r.partial; }
console.log(`TOTAL works gaining an evidenced translation status: ${tf} full + ${tp} partial = ${tf + tp}`);

if (APPLY) {
  const res = await c.query(`
    update works w set
      translation_status = case when h.pct >= 90 then 'full' else 'partial' end,
      translation_method = 'census-auto',
      translation_evidence = 'sl-holding ' || h.book_id || ' (SL translation, pct=' || h.pct || ')',
      updated_at = now()
    from (
      select distinct on (work_id) work_id, book_id, translated_pct as pct
      from work_holdings where translated_pct > 0
      order by work_id, translated_pct desc
    ) h
    where w.id = h.work_id and w.translation_status = 'unknown'`);
  console.log(`\nApplied: ${res.rowCount} works updated.`);
} else {
  console.log('\nMEASUREMENT ONLY — re-run with --apply to write.');
}
await c.end();
