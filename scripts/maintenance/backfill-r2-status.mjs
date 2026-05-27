#!/usr/bin/env node
/**
 * R2 backfill operational status.
 *
 * Reads the latest /admin/r2-coverage snapshot and prints the per-provider
 * gap, the canonical command to back-fill each provider, and which providers
 * require local (non-Hetzner) execution because upstream libraries 429
 * Hetzner's IP.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-r2-status.mjs
 *   node scripts/maintenance/backfill-r2-status.mjs --provider=mdz   # detail one provider
 */

import { MongoClient } from 'mongodb';

const PROVIDER_FILTER = process.argv.find(a => a.startsWith('--provider='))?.split('=')[1];

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Per-provider operational notes. Keep in sync with scripts/workers/archive-*.mjs
// and scripts/maintenance/archive-images-fast.ts.
//
//   cmd:    the canonical archive command (run locally unless `hetznerOk`)
//   hetznerOk: true if the provider doesn't 429 Hetzner's IP. If false the
//              command MUST run on a non-Hetzner machine (typically Derek's Mac).
//   notes:  extra context surfaced to the operator
const PROVIDER_OPS = {
  ia:               { cmd: 'node scripts/workers/archive-bulk.mjs --limit=2000',                       hetznerOk: true,  notes: 'scheduled — runs every 2h via scheduler.mjs' },
  mdz:              { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=mdz --limit=2000', hetznerOk: true,  notes: 'no dedicated worker; archive-images-fast supports mdz IIIF' },
  harvard:          { cmd: 'node scripts/workers/archive-harvard.mjs --limit=2000 --concurrency=2',     hetznerOk: false, notes: 'Harvard MPS 429s Hetzner — local only. ~30 min per 1000 pages at 1 req/s.' },
  gallica:          { cmd: 'node scripts/workers/archive-gallica.mjs --limit=2000',                     hetznerOk: false, notes: 'BnF 429s Hetzner — local only.' },
  'e-rara':         { cmd: 'node scripts/workers/archive-erara.mjs --limit=2000',                       hetznerOk: false, notes: 'Swiss library, gentle rate limit (2/s). Local only.' },
  internet_archive: { cmd: 'node scripts/workers/archive-bulk.mjs --limit=2000',                       hetznerOk: true,  notes: 'same as `ia` alias' },
  bl:               { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=other --limit=2000', hetznerOk: true,  notes: 'British Library — no SOURCE_PATTERNS entry; use --source=other if --source filter doesn\'t match' },
  bsb:              { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=mdz --limit=2000',   hetznerOk: true,  notes: 'BSB uses digitale-sammlungen.de — same pattern as mdz' },
  bodleian:         { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=bodleian --limit=2000', hetznerOk: true, notes: '' },
  vatican:          { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=vatican --limit=2000', hetznerOk: true, notes: '' },
  wellcome:         { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=wellcome --limit=2000', hetznerOk: true, notes: '' },
  cambridge:        { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=cambridge --limit=2000', hetznerOk: true, notes: '' },
  hab:              { cmd: 'npx tsx scripts/maintenance/archive-images-fast.ts --source=hab --limit=2000',  hetznerOk: true, notes: '' },
};

// Providers that intentionally don't host images on R2.
const TEXT_ONLY = new Set(['etcsl', 'tu_darmstadt']);

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const snap = await db.collection('system_config').findOne({ _id: 'r2_coverage_snapshot' });
  if (!snap) {
    console.error('No r2_coverage_snapshot found. Run: node scripts/workers/r2-coverage-snapshot.mjs');
    process.exit(1);
  }

  const rows = Object.entries(snap.by_provider).map(([p, x]) => ({
    provider: p,
    books: x.books,
    pages: x.pages,
    r2: x.r2,
    failed: x.failed,
    unarchived: x.pages - x.r2 - x.failed,
    pct: x.pages > 0 ? Math.round((x.r2 / x.pages) * 100) : 0,
  })).filter(r => !TEXT_ONLY.has(r.provider) && r.unarchived > 0);
  rows.sort((a, b) => b.unarchived - a.unarchived);

  if (PROVIDER_FILTER) {
    const r = rows.find(x => x.provider === PROVIDER_FILTER);
    if (!r) { console.error(`provider not in current gap: ${PROVIDER_FILTER}`); process.exit(1); }
    const ops = PROVIDER_OPS[r.provider] || {};
    console.log(`${r.provider}: ${r.unarchived.toLocaleString()} unarchived pages across ${r.books.toLocaleString()} books (${r.pct}% R2)`);
    if (ops.cmd) console.log(`  cmd:    ${ops.cmd}`);
    if (ops.hetznerOk !== undefined) console.log(`  host:   ${ops.hetznerOk ? 'Hetzner OK' : 'LOCAL ONLY (upstream 429s Hetzner)'}`);
    if (ops.notes) console.log(`  notes:  ${ops.notes}`);
    await client.close();
    return;
  }

  console.log(`\nR2 backfill status — snapshot ${new Date(snap.computed_at).toISOString()}\n`);
  console.log(`library: ${snap.library.r2_pct}% record-level R2 coverage`);
  if (snap.variant_coverage) {
    const v = snap.variant_coverage.library;
    console.log(`variants (file-level): display ${v.display_pct}%, thumb ${v.thumb_pct}%, full ${v.full_pct}%`);
  }
  console.log(`total unarchived pages: ${rows.reduce((a, r) => a + r.unarchived, 0).toLocaleString()}\n`);

  console.log('provider              books   unarchived   pct   host         cmd');
  console.log('--------------------- -----   ----------   ---   ----------   ---');
  for (const r of rows) {
    const ops = PROVIDER_OPS[r.provider] || {};
    const host = ops.hetznerOk === undefined ? '?' : ops.hetznerOk ? 'hetzner+local' : 'LOCAL ONLY';
    const cmd = ops.cmd ? ops.cmd.slice(0, 70) : '(no dedicated worker)';
    console.log(`${r.provider.padEnd(20)}  ${String(r.books).padStart(5)}   ${String(r.unarchived).padStart(10)}   ${String(r.pct).padStart(3)}%  ${host.padEnd(11)}  ${cmd}`);
  }
  console.log('\nRun the cmd for each provider with --provider=<name> to see ops notes.');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
