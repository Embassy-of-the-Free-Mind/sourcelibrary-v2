#!/usr/bin/env node
/**
 * Align modern English translations (translation_catalogs, 23K rows) with
 * the early-modern source editions they translate (ustc_editions, 1.6M
 * rows covering 1450-1650 European printing). Result: a populated
 * translation_catalog_ustc_links join table.
 *
 * The heavy lifting (pg_trgm join across 23K × 1.6M candidate space) is
 * server-side via the RPCs defined in
 * 20260528000001_translation_catalog_ustc_links.sql, so this script just
 * orchestrates: call the auto-link RPC at high threshold, report what
 * landed, fetch the ambiguous-zone report for the next round of LLM/curator
 * judgement.
 *
 * Cost: zero LLM spend at this stage. The ambiguous report drives a
 * follow-up LLM judging pass which is a separate (cheap) script.
 *
 * Usage:
 *   node scripts/enrichment/align-translations-to-ustc.mjs                       # report only (no insert)
 *   node scripts/enrichment/align-translations-to-ustc.mjs --apply               # high threshold (0.85/0.85)
 *   node scripts/enrichment/align-translations-to-ustc.mjs --apply --loose       # 0.80/0.65
 *   node scripts/enrichment/align-translations-to-ustc.mjs --ambiguous           # show pairs needing review
 */

import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.production.local', 'utf8');
    for (const line of content.split('\n')) {
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
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

async function callRpc(name, args) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`RPC ${name} failed: ${resp.status} ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function countLinks() {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/translation_catalog_ustc_links?select=count`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    }
  );
  const range = resp.headers.get('content-range') || '';
  const m = range.match(/\/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const loose = args.includes('--loose');
  const showAmbiguous = args.includes('--ambiguous');

  const before = await countLinks();
  console.log(`Existing link rows: ${before.toLocaleString()}`);

  if (apply) {
    const authThr = loose ? 0.80 : 0.85;
    const titThr  = loose ? 0.65 : 0.85;
    const CHUNK = 2000; // translations per RPC call — small enough to stay under statement_timeout

    // Find max id so we know how many chunks we need
    const maxIdResp = await callRpc('translation_catalogs_max_id', {});
    const maxId = maxIdResp ?? 30000;
    const totalChunks = Math.ceil(maxId / CHUNK);
    console.log(`\n→ Chunked alignment: ${totalChunks} chunks of ${CHUNK} ids each (max_id=${maxId}, thresholds: author=${authThr}, title=${titThr})`);

    let totalIns = 0;
    let totalProcessed = 0;
    const t0 = Date.now();
    for (let start = 0; start < maxId; start += CHUNK) {
      const end = start + CHUNK;
      const ct0 = Date.now();
      try {
        const result = await callRpc('align_translations_to_ustc_auto', {
          author_threshold: authThr,
          title_threshold: titThr,
          id_start: start,
          id_end: end,
        });
        const r = Array.isArray(result) ? result[0] : result;
        const ins = parseInt(r?.inserted_links || 0);
        const proc = parseInt(r?.processed_translations || 0);
        totalIns += ins;
        totalProcessed += proc;
        const cdur = ((Date.now() - ct0) / 1000).toFixed(1);
        console.log(`  chunk [${start}-${end}): processed=${proc} inserted=${ins} (${cdur}s)`);
      } catch (e) {
        console.error(`  chunk [${start}-${end}) FAILED: ${e.message}`);
      }
    }
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDone in ${dur}s.`);
    console.log(`Total translations processed: ${totalProcessed.toLocaleString()}`);
    console.log(`Total links inserted: ${totalIns.toLocaleString()}`);
    const after = await countLinks();
    console.log(`Link rows in table: ${after.toLocaleString()} (+${(after - before).toLocaleString()})`);
  } else {
    console.log('(Dry-run mode: re-run with --apply to insert high-confidence links.)');
  }

  if (showAmbiguous) {
    console.log('\n→ Fetching ambiguous-zone pairs (0.55-0.85 similarity)...');
    const pairs = await callRpc('align_translations_to_ustc_ambiguous', {
      lower_bound: 0.55,
      upper_bound: 0.85,
      per_translation_limit: 2,
    });
    console.log(`Ambiguous pairs: ${pairs.length}`);
    for (const p of pairs.slice(0, 20)) {
      console.log(`  [a=${p.author_sim} t=${p.title_sim}] ${p.trans_author?.slice(0, 35)} / ${p.trans_work?.slice(0, 40)}`);
      console.log(`                            ↔ ${p.ustc_author?.slice(0, 35)} / ${p.ustc_title?.slice(0, 40)} (${p.ustc_year || '?'})`);
    }
    if (pairs.length > 20) console.log(`  ... and ${pairs.length - 20} more`);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
