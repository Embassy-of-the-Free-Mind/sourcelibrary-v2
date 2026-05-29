#!/usr/bin/env node
/**
 * Backfill index_catalog_entries.language from the linked USTC edition.
 *
 * `language` is the language of the *banned work*, not the print language of
 * the Index edition. It is genuinely mixed within a single edition — a Spanish
 * Index lists Latin, Spanish, Italian and German works side by side — so a
 * per-edition blanket default (the original "Roman=lat, Spanish=lat/spa" idea)
 * would mislabel a meaningful slice. We instead copy the accurate per-work
 * language from the matched USTC edition (`ustc_editions.language_1`), which
 * uses full English names ("Latin", "German", "Italian", …).
 *
 * Entries with no `ustc_sn` (the ~92% unmatched) are left NULL on purpose:
 * most are author-only `opera_omnia` lines whose work-language is genuinely
 * indeterminate from the entry. NULL is more honest than a guess. When the
 * matching pass (backfill-catalog-ustc-sl-links.mjs) links more entries, just
 * re-run this — it only fills rows where language IS NULL.
 *
 * Idempotent. Re-runnable. One PATCH per distinct ustc_sn (not per entry).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-catalog-language.mjs            # dry-run
 *   node scripts/backfill-catalog-language.mjs --apply
 */
const APPLY = process.argv.includes('--apply');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = APPLY ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE_* missing'); process.exit(1); }
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

async function supa(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const opts = { method, headers: H };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
      if (!r.ok) {
        const text = (await r.text()).slice(0, 400);
        if (r.status >= 500 && attempt < 4) { await new Promise(res => setTimeout(res, 1000 * 2 ** attempt)); continue; }
        throw new Error(`${method} ${path} → ${r.status}: ${text}`);
      }
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (attempt === 4 || !/ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(e))) throw e;
      await new Promise(res => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
}

// Fetch every distinct ustc_sn among entries still missing a language.
async function fetchUnlinkedSns() {
  const sns = new Set();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const rows = await supa('GET',
      `index_catalog_entries?select=ustc_sn&ustc_sn=not.is.null&language=is.null&order=ustc_sn&limit=${PAGE}&offset=${offset}`);
    for (const r of rows) if (r.ustc_sn != null) sns.add(r.ustc_sn);
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return [...sns];
}

// Look up language_1 for a batch of USTC editions.
async function ustcLanguages(sns) {
  const map = new Map();
  const CHUNK = 200;
  for (let i = 0; i < sns.length; i += CHUNK) {
    const batch = sns.slice(i, i + CHUNK);
    const rows = await supa('GET',
      `ustc_editions?select=sn,language_1&sn=in.(${batch.join(',')})`);
    // USTC values carry casing/whitespace noise ("latin", "Latin "); canonicalise
    // so "Latin"/"latin"/"Latin " collapse into one bucket.
    for (const r of rows) {
      if (!r.language_1) continue;
      const lang = r.language_1.trim().replace(/^./, c => c.toUpperCase());
      map.set(r.sn, lang);
    }
  }
  return map;
}

async function main() {
  console.log(`catalog language backfill — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const sns = await fetchUnlinkedSns();
  console.log(`USTC-linked entries missing language: ${sns.length} distinct ustc_sn`);
  if (!sns.length) { console.log('Nothing to do.'); return; }

  const langBySn = await ustcLanguages(sns);
  console.log(`Resolved a USTC language for ${langBySn.size}/${sns.length} editions.`);

  // Group sns by the language we'll write, so we can PATCH per-language.
  const byLang = new Map();
  for (const [sn, lang] of langBySn) {
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(sn);
  }

  console.log('\nLanguage distribution to write:');
  for (const [lang, list] of [...byLang.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${lang.padEnd(16)} ${list.length} editions`);
  }

  if (!APPLY) {
    console.log('\n(dry run — pass --apply to write)');
    return;
  }

  console.log('\nWriting…');
  let patched = 0;
  for (const [lang, list] of byLang) {
    const CHUNK = 200;
    for (let i = 0; i < list.length; i += CHUNK) {
      const batch = list.slice(i, i + CHUNK);
      // Only touch rows still NULL, so a re-run never clobbers a better value.
      await supa('PATCH',
        `index_catalog_entries?ustc_sn=in.(${batch.join(',')})&language=is.null`,
        { language: lang });
      patched += batch.length;
      process.stdout.write(`\r  ${patched} editions patched`);
    }
  }
  console.log(`\nDone. Patched entries for ${patched} editions across ${byLang.size} languages.`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
