#!/usr/bin/env node
/**
 * backfill-ft-catalog-source-url.mjs — one-off (#2564): give the already-written
 * `sl_ft_llm_claim` rows their translation links, and remove the junk-translator
 * rows the old guard let through.
 *
 *  1. Cleanup: DELETE sl_ft_llm_claim rows whose translator is Various/Multiple/
 *     Several/Unknown/Ongoing (the tightened guard rejects these going forward).
 *  2. Backfill: for each prior in the enumeration JSONL that has a source_url,
 *     PATCH the matching catalog row's source_url (only where currently null).
 *
 * Needs the column: ALTER TABLE translation_catalogs ADD COLUMN source_url text;
 * (No SUPABASE_DB_URL in env → run that one line in the Supabase SQL editor first.)
 *
 * USAGE:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-ft-catalog-source-url.mjs /tmp/ft-found-priors.jsonl [--apply]
 */
import { readFileSync } from 'fs';

const JSONL = process.argv[2] || '/tmp/ft-found-priors.jsonl';
const APPLY = process.argv.includes('--apply');   // backfill source_url (safe, additive)
const CLEAN = process.argv.includes('--clean');   // ALSO delete junk-translator rows (destructive — separate opt-in)
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const api = p => `${URL}/rest/v1/translation_catalogs${p}`;
const enc = encodeURIComponent;

// 0. column present?
const probe = await fetch(api('?select=source_url&limit=1'), { headers: H });
if (!probe.ok) {
  console.error('source_url column missing. Run first (Supabase SQL editor):');
  console.error('  ALTER TABLE translation_catalogs ADD COLUMN source_url text;');
  process.exit(2);
}
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

// 1. cleanup junk-translator rows
const JUNK = ['various*', 'multiple*', 'several*', 'unknown*', 'ongoing*'];
const orFilter = `or=(${JUNK.map(p => `translator.ilike.${p}`).join(',')})`;
const junkRows = await (await fetch(api(`?source=eq.sl_ft_llm_claim&${orFilter}&select=id,translator`), { headers: H })).json();
console.log(`\nJunk-translator rows present: ${junkRows.length}${CLEAN ? ' (will DELETE)' : ' (kept — pass --clean to delete)'}`);
junkRows.slice(0, 5).forEach(r => console.log(`  - ${r.translator}`));
if (CLEAN && junkRows.length) {
  const del = await fetch(api(`?source=eq.sl_ft_llm_claim&${orFilter}`), { method: 'DELETE', headers: { ...H, Prefer: 'count=exact' } });
  console.log(`  deleted: ${del.headers.get('content-range') || del.status}`);
}

// 2. backfill source_url
const priors = [];
for (const line of readFileSync(JSONL, 'utf8').split('\n').filter(Boolean)) {
  try { const r = JSON.parse(line); for (const p of (r.prior_translations_found || [])) if (p.english_title && /^https?:/.test(p.source_url || '')) priors.push(p); } catch {}
}
console.log(`\nPriors with a link to backfill: ${priors.length}`);
let patched = 0, missed = 0;
for (const p of priors) {
  let q = `?source=eq.sl_ft_llm_claim&english_title=eq.${enc(p.english_title)}&source_url=is.null`;
  if (p.translator) q += `&translator=eq.${enc(p.translator)}`;
  if (!APPLY) { const r = await (await fetch(api(q + '&select=id'), { headers: H })).json(); if (Array.isArray(r) && r.length) patched += r.length; else missed++; continue; }
  const res = await fetch(api(q), { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ source_url: p.source_url }) });
  const rows = await res.json(); if (Array.isArray(rows) && rows.length) patched += rows.length; else missed++;
}
console.log(`${APPLY ? 'Patched' : 'Would patch'}: ${patched} rows · no-match: ${missed}`);
console.log(APPLY ? '\nDone.' : '\nDry run — re-run with --apply to write.');
