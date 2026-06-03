#!/usr/bin/env node
/**
 * Batch importer for the IIIF expansion-manifest pattern.
 *
 * Reads a staging manifest (JSON array of entries each carrying an `iiif_manifest`
 * URL) and imports each through the existing `/api/import/iiif` route, which parses
 * the manifest's canvases into pages. Complements `import-pdf-books.mjs` (PDF / per-page
 * sources) for sources that expose a real IIIF manifest (e.g. KU Leuven `lib.is`).
 *
 * SAFE BY DEFAULT: dry-run unless you pass --commit. Dry-run validates that each
 * manifest actually resolves (HTTP 200 + canvas count) so you see what *would* import.
 *
 * Auth: needs CRON_SECRET in env (the route accepts `Authorization: Bearer $CRON_SECRET`).
 *
 *   set -a; source .env.production.local; set +a
 *   # validate a subset (no DB writes):
 *   node scripts/import/import-iiif-manifest.mjs --manifest scripts/import/kuleuven-expansion.json --topic alchemy
 *   # actually import a subset:
 *   node scripts/import/import-iiif-manifest.mjs --manifest scripts/import/kuleuven-expansion.json --topic alchemy --commit
 *
 * Flags:
 *   --manifest <file>   (required) staging manifest JSON
 *   --commit            actually POST to the import route (default: dry-run)
 *   --topic <tag>       keep only entries whose topic_tags include <tag>
 *   --century <n>       keep only entries with century === n (e.g. 1600)
 *   --only <substr>     keep entries whose fingerprint/slug/title contains <substr>
 *   --limit <n>         cap the number processed
 *   --base <url>        import host (default https://sourcelibrary.org)
 *   --delay <ms>        delay between imports (default 800)
 */
import { readFileSync } from 'node:fs';

const a = process.argv.slice(2);
const flag = n => a.includes(n);
const val = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };

const MANIFEST = val('--manifest');
const COMMIT = flag('--commit');
const TOPIC = val('--topic');
const CENTURY = val('--century') ? parseInt(val('--century')) : null;
const ONLY = (val('--only') || '').toLowerCase();
const LIMIT = val('--limit') ? parseInt(val('--limit')) : Infinity;
const BASE = (val('--base', 'https://sourcelibrary.org')).replace(/\/$/, '');
const DELAY = parseInt(val('--delay', '800'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!MANIFEST) { console.error('ERROR: --manifest <file> is required'); process.exit(1); }
const SECRET = process.env.CRON_SECRET;
if (COMMIT && !SECRET) { console.error('ERROR: --commit needs CRON_SECRET in env (set -a; source .env.production.local; set +a)'); process.exit(1); }

let entries = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const before = entries.length;
if (TOPIC) entries = entries.filter(e => (e.topic_tags || []).includes(TOPIC));
if (CENTURY !== null) entries = entries.filter(e => e.century === CENTURY);
if (ONLY) entries = entries.filter(e => `${e.fingerprint} ${e.slug} ${e.title}`.toLowerCase().includes(ONLY));
entries = entries.filter(e => e.iiif_manifest && e.title).slice(0, LIMIT);

console.log(`Manifest: ${MANIFEST}  (${before} entries → ${entries.length} after filters)`);
console.log(`Mode: ${COMMIT ? 'COMMIT (writing to ' + BASE + ')' : 'DRY-RUN (no writes; validating manifests)'}\n`);

const fetchJson = async (url, opts) => {
  const r = await fetch(url, opts);
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

const summary = { imported: 0, exists: 0, failed: 0, unreachable: 0, pages: 0 };
let i = 0;
for (const e of entries) {
  i++;
  const label = `[${i}/${entries.length}] ${(e.title || '').slice(0, 55)}`;
  if (!COMMIT) {
    // validate the IIIF manifest resolves + count canvases
    try {
      const r = await fetch(e.iiif_manifest, { headers: { 'User-Agent': 'SourceLibrary-importer/1.0' } });
      if (!r.ok) { console.log(`  ✗ ${label} — manifest HTTP ${r.status}`); summary.unreachable++; }
      else {
        const m = await r.json();
        const seq = m.sequences?.[0]?.canvases || m.items || [];
        summary.pages += seq.length;
        console.log(`  ✓ ${label} — ${seq.length} pages  (${e.iiif_manifest})`);
      }
    } catch (err) { console.log(`  ✗ ${label} — ${String(err).slice(0, 50)}`); summary.unreachable++; }
    await sleep(150);
    continue;
  }
  // COMMIT: POST to the import route
  const payload = {
    manifest_url: e.iiif_manifest,
    title: e.title,
    display_title: e.display_title || e.title,
    author: e.author || 'Anonymous',
    published: e.published || null,
    provider: e.provider || 'kuleuven',
    contributing_library: e.contributing_library || null,
    shelfmark: e.shelfmark || null,
    categories: e.categories || [],
  };
  try {
    const { status, body } = await fetchJson(`${BASE}/api/import/iiif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(payload),
    });
    if (status === 200 || status === 201) { summary.imported++; summary.pages += body?.pagesCreated || 0; console.log(`  ✓ ${label} — ${body?.pagesCreated ?? '?'} pages → ${body?.bookUrl || body?.bookId}`); }
    else if (status === 409) { summary.exists++; console.log(`  • ${label} — already exists (${body?.existingId || ''})`); }
    else { summary.failed++; console.log(`  ✗ ${label} — HTTP ${status} ${body?.error || ''}`); }
  } catch (err) { summary.failed++; console.log(`  ✗ ${label} — ${String(err).slice(0, 60)}`); }
  await sleep(DELAY);
}

console.log('\n===== SUMMARY =====');
if (COMMIT) console.log(`imported: ${summary.imported}  |  already-exists: ${summary.exists}  |  failed: ${summary.failed}  |  pages: ${summary.pages}`);
else console.log(`reachable manifests: ${entries.length - summary.unreachable}/${entries.length}  |  unreachable: ${summary.unreachable}  |  total pages: ${summary.pages}`);
