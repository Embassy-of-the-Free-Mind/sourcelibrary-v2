#!/usr/bin/env node
/**
 * Audit the gap between MongoDB BPH books and Supabase bph_works rows.
 *
 * Context: switching the grid view to a Supabase-only data source filters
 * the visible covers to `bph_works.sl_book_id IS NOT NULL`. Any digitised
 * BPH book in MongoDB whose UBN doesn't have a matching bph_works row
 * disappears from grid view. This script enumerates the gap so we can
 * decide what to backfill before flipping the data source.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.production.local | cut -d= -f2)
 *   node scripts/audit-bph-supabase-gap.mjs
 *   node scripts/audit-bph-supabase-gap.mjs --json > out.json   # full lists
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const AS_JSON = process.argv.includes('--json');

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) required');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('MONGODB_URI required');
  process.exit(1);
}

function extractUbn(dc) {
  if (typeof dc === 'string' && /^\d+$/.test(dc)) return dc;
  if (Array.isArray(dc)) {
    for (const v of dc) {
      if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    }
  }
  return null;
}

function classifyDc(dc) {
  if (!dc) return 'missing';
  const arr = Array.isArray(dc) ? dc : [dc];
  for (const v of arr) {
    if (typeof v === 'string' && /^\d+$/.test(v)) return 'numeric_ubn';
  }
  for (const v of arr) {
    if (typeof v === 'string' && v.toLowerCase().includes('iiif')) return 'iiif_url';
    if (typeof v === 'string' && /^https?:/i.test(v)) return 'http_url';
  }
  return 'other';
}

async function fetchSupabaseUbns() {
  const out = new Set();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/bph_works?select=ubn&order=ubn.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    const body = await res.json();
    for (const row of body) out.add(row.ubn);
    if (body.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  console.error('Loading bph_works UBNs from Supabase…');
  const supabaseUbns = await fetchSupabaseUbns();
  console.error(`  ${supabaseUbns.size} rows in bph_works`);

  console.error('Loading BPH books from MongoDB…');
  const client = new MongoClient(MONGODB_URI, {
    socketTimeoutMS: 120_000,
    serverSelectionTimeoutMS: 30_000,
  });
  await client.connect();
  const db = client.db('bookstore');
  const docs = await db
    .collection('books')
    .find(
      { 'image_source.provider': 'bph' },
      {
        projection: {
          id: 1,
          slug: 1,
          title: 1,
          'dublin_core.dc_identifier': 1,
          'dublin_core.title': 1,
        },
      },
    )
    .toArray();
  console.error(`  ${docs.length} BPH books in MongoDB`);

  const byClass = { numeric_ubn: [], iiif_url: [], http_url: [], other: [], missing: [] };
  for (const d of docs) {
    const dc = d?.dublin_core?.dc_identifier;
    byClass[classifyDc(dc)].push(d);
  }

  const missingInSupabase = []; // numeric UBN, but no bph_works row
  const linkable = [];
  for (const d of byClass.numeric_ubn) {
    const ubn = extractUbn(d.dublin_core?.dc_identifier);
    if (!ubn) continue;
    if (supabaseUbns.has(ubn)) linkable.push({ ubn, id: d.id, slug: d.slug, title: d.title });
    else missingInSupabase.push({ ubn, id: d.id, slug: d.slug, title: d.title });
  }

  // Count bph_works rows currently linked (sl_book_id != null) by sampling
  // the catalog API rather than re-fetching from Supabase here.
  const slLinkedRes = await fetch(`https://bph.sourcelibrary.org/api/catalog/bph?digitized=sl&limit=1`);
  const slLinkedBody = slLinkedRes.ok ? await slLinkedRes.json() : { total: null };

  const summary = {
    mongodb_bph_books: docs.length,
    supabase_bph_works_total: supabaseUbns.size,
    supabase_bph_works_linked_to_sl: slLinkedBody.total,
    mongodb_dc_classes: {
      numeric_ubn: byClass.numeric_ubn.length,
      iiif_url: byClass.iiif_url.length,
      http_url: byClass.http_url.length,
      other: byClass.other.length,
      missing: byClass.missing.length,
    },
    linkable_numeric_ubn_in_bph_works: linkable.length,
    missing_from_bph_works: missingInSupabase.length,
  };

  if (AS_JSON) {
    console.log(JSON.stringify({
      summary,
      missing_from_bph_works: missingInSupabase,
      iiif_books: byClass.iiif_url.map(d => ({ id: d.id, slug: d.slug, title: d.title, dc: d.dublin_core?.dc_identifier })),
      missing_dc_books: byClass.missing.map(d => ({ id: d.id, slug: d.slug, title: d.title })),
    }, null, 2));
  } else {
    console.log('SUMMARY');
    console.log('─'.repeat(60));
    for (const [k, v] of Object.entries(summary)) {
      if (typeof v === 'object') {
        console.log(`${k}:`);
        for (const [k2, v2] of Object.entries(v)) console.log(`  ${k2}: ${v2}`);
      } else {
        console.log(`${k}: ${v}`);
      }
    }
    console.log('');
    console.log(`Sample of ${Math.min(10, missingInSupabase.length)} books with numeric UBN but no bph_works row:`);
    for (const b of missingInSupabase.slice(0, 10)) {
      console.log(`  ubn=${b.ubn}  ${b.title || '(no title)'}  /book/${b.id}`);
    }
    console.log('');
    console.log(`Sample of ${Math.min(5, byClass.iiif_url.length)} IIIF-imported books (no numeric UBN to link):`);
    for (const b of byClass.iiif_url.slice(0, 5)) {
      console.log(`  ${b.title || '(no title)'}  dc=${JSON.stringify(b.dublin_core?.dc_identifier).slice(0, 80)}`);
    }
    if (byClass.missing.length > 0) {
      console.log('');
      console.log(`Sample of ${Math.min(5, byClass.missing.length)} books with no dc_identifier:`);
      for (const b of byClass.missing.slice(0, 5)) {
        console.log(`  ${b.title || '(no title)'}  /book/${b.id}`);
      }
    }
  }

  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
