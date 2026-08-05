#!/usr/bin/env node
/**
 * prune-telemetry.mjs — MANUAL, human-triggered telemetry pruning (#2976).
 *
 * Per the #2976 decision (Derek, 2026-07-05) there is NO automated data
 * retention anywhere — no TTL indexes, no cron pruning. This script is the
 * only sanctioned way to delete old telemetry rows, and it runs only when a
 * human explicitly asks for it. Do NOT wire it to any cron/scheduler.
 *
 * Safety properties:
 *   - DRY-RUN BY DEFAULT: prints the exact cutoff date and doc count, deletes
 *     nothing.
 *   - --apply alone is NOT enough — you must also pass
 *     --yes-i-know-this-deletes.
 *   - Allowlisted collections only (api_usage, gemini_usage, analytics_events,
 *     mcp_tool_calls, mcp_clients, search_queries, analytics_pageviews,
 *     audit_log). Anything else is refused.
 *   - Before deleting, every doomed row is exported (gzipped EJSON-NDJSON) to
 *     scripts/output/<collection>-prune-<date>.json.gz and the export is
 *     verified non-empty; if the export fails or is empty, nothing is deleted.
 *   - Deletes in batches with progress logging.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/prune-telemetry.mjs --collection api_usage --older-than 180
 *   node scripts/maintenance/prune-telemetry.mjs --collection api_usage --older-than 180 --apply --yes-i-know-this-deletes
 */
import { createWriteStream, statSync, mkdirSync } from 'fs';
import { createGzip } from 'zlib';
import path from 'path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';

// Allowlist: collection -> the Date field its age is measured on.
// Field choices come from the #2976 audit + the lazy creators
// (src/lib/{api-usage,mcp-usage,search-log}.ts) and the archived
// analytics writers. Scope is the six no-retention collections of the
// 2026-07-05 decision ("nine minus the heartbeats") plus audit_log.
const ALLOWLIST = {
  api_usage: 'ts',
  gemini_usage: 'timestamp',
  analytics_events: 'created_at',
  mcp_tool_calls: 'ts',
  mcp_clients: 'ts',
  search_queries: 'ts',
  analytics_pageviews: 'timestamp',
  audit_log: 'timestamp',
};

const BATCH_SIZE = 5000;

function parseArgs(argv) {
  const args = { apply: false, confirmed: false, collection: null, olderThan: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--yes-i-know-this-deletes') args.confirmed = true;
    else if (a === '--collection') args.collection = argv[++i];
    else if (a.startsWith('--collection=')) args.collection = a.split('=')[1];
    else if (a === '--older-than') args.olderThan = argv[++i];
    else if (a.startsWith('--older-than=')) args.olderThan = a.split('=')[1];
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.collection || args.olderThan == null) {
    console.error('Usage: node scripts/maintenance/prune-telemetry.mjs --collection <name> --older-than <days> [--apply --yes-i-know-this-deletes]');
    console.error(`Allowlisted collections: ${Object.keys(ALLOWLIST).join(', ')}`);
    process.exit(1);
  }

  const tsField = ALLOWLIST[args.collection];
  if (!tsField) {
    console.error(`REFUSED: '${args.collection}' is not in the allowlist (${Object.keys(ALLOWLIST).join(', ')}).`);
    console.error('This script only prunes telemetry/log collections — see #2976.');
    process.exit(1);
  }

  const days = Number(args.olderThan);
  if (!Number.isInteger(days) || days < 1) {
    console.error(`--older-than must be a positive integer number of days (got '${args.olderThan}').`);
    process.exit(1);
  }

  if (args.apply && !args.confirmed) {
    console.error('REFUSED: --apply also requires --yes-i-know-this-deletes.');
    process.exit(1);
  }
  if (args.confirmed && !args.apply) {
    console.error('--yes-i-know-this-deletes given without --apply; running as dry-run anyway.');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filter = { [tsField]: { $lt: cutoff } };

  console.log(`prune-telemetry (#2976 — manual retention, never cronned)`);
  console.log(`  mode:        ${args.apply && args.confirmed ? 'APPLY — will export then DELETE' : 'DRY RUN (default) — nothing will be deleted'}`);
  console.log(`  collection:  ${args.collection}`);
  console.log(`  age field:   ${tsField}`);
  console.log(`  older than:  ${days} days`);
  console.log(`  cutoff:      ${tsField} < ${cutoff.toISOString()}`);
  console.log('');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection(args.collection);

  try {
    const total = await col.estimatedDocumentCount();
    console.log(`  counting docs matching the cutoff (collection has ~${total.toLocaleString()} docs total)...`);
    const doomed = await col.countDocuments(filter);
    console.log(`  ${doomed.toLocaleString()} docs would be deleted (${total > 0 ? ((doomed / total) * 100).toFixed(1) : 0}% of collection)`);

    if (!args.apply || !args.confirmed) {
      console.log('\nDry run complete — nothing deleted. Re-run with --apply --yes-i-know-this-deletes to prune.');
      return;
    }

    if (doomed === 0) {
      console.log('\nNothing to delete — exiting without touching anything.');
      return;
    }

    // ── Export the doomed rows BEFORE deleting anything ──────────
    const outDir = path.join(process.cwd(), 'scripts', 'output');
    mkdirSync(outDir, { recursive: true });
    const dateTag = new Date().toISOString().slice(0, 10);
    const outPath = path.join(outDir, `${args.collection}-prune-${dateTag}.json.gz`);
    console.log(`\n  exporting doomed rows to ${outPath} (gzipped EJSON, one doc per line)...`);

    const gzip = createGzip();
    const out = createWriteStream(outPath);
    const done = new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
      gzip.on('error', reject);
    });
    gzip.pipe(out);

    let exported = 0;
    const cursor = col.find(filter);
    for await (const doc of cursor) {
      const line = EJSON.stringify(doc) + '\n';
      if (!gzip.write(line)) {
        await new Promise((resolve) => gzip.once('drain', resolve));
      }
      exported++;
      if (exported % 100000 === 0) console.log(`    exported ${exported.toLocaleString()} / ~${doomed.toLocaleString()}...`);
    }
    gzip.end();
    await done;

    // ── Verify the export before any delete ──────────────────────
    const stat = statSync(outPath);
    console.log(`  export complete: ${exported.toLocaleString()} docs, ${(stat.size / 1024 / 1024).toFixed(1)} MB gzipped`);
    if (exported === 0 || stat.size < 50) {
      console.error('ABORT: export is empty or suspiciously small — deleting nothing.');
      process.exit(1);
    }

    // ── Delete in batches with progress ──────────────────────────
    // Deletes by the same immutable cutoff filter the export used; telemetry
    // timestamps are write-time stamps, so no new doc can enter the window.
    console.log(`\n  deleting in batches of ${BATCH_SIZE.toLocaleString()}...`);
    let deleted = 0;
    for (;;) {
      const ids = await col.find(filter).project({ _id: 1 }).limit(BATCH_SIZE).map((d) => d._id).toArray();
      if (ids.length === 0) break;
      const res = await col.deleteMany({ _id: { $in: ids } });
      deleted += res.deletedCount;
      console.log(`    deleted ${deleted.toLocaleString()} / ${doomed.toLocaleString()} (${((deleted / doomed) * 100).toFixed(1)}%)`);
    }

    const remaining = await col.countDocuments(filter);
    console.log(`\nDone. Deleted ${deleted.toLocaleString()} docs from ${args.collection}; ${remaining} docs still match the cutoff (expected 0).`);
    console.log(`Backup: ${outPath}`);
    if (remaining !== 0) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
