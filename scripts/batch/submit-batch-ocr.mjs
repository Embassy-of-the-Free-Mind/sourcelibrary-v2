/**
 * Bulk OCR submission — triggers the Hetzner pipeline orchestrator Phase 2.
 *
 * IMPORTANT: This script should be run ON HETZNER, not locally.
 * The orchestrator downloads images and builds JSONL files (100MB+),
 * which times out on Vercel's 60s function limit for large books.
 *
 * Usage (on Hetzner):
 *   cd /root/sourcelibrary && set -a && source .env.production.local && set +a
 *   node scripts/batch/submit-batch-ocr.mjs [--count=20] [--max-pages=500] [--dry-run] [--provider=bph]
 *
 * Or from local Mac:
 *   ssh root@46.224.122.120 "cd /root/sourcelibrary && set -a && source .env.production.local && set +a && node scripts/batch/submit-batch-ocr.mjs --count=50 --provider=bph"
 *
 * This is a thin wrapper around the pipeline orchestrator Phase 2.
 * For ad-hoc use when you need to push specific books through OCR faster
 * than the regular cron cycle.
 */
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_COUNT = parseInt(getArg('count') || '20', 10);
const MAX_PAGES = parseInt(getArg('max-pages') || '500', 10);
const DRY_RUN = hasFlag('dry-run');
const PROVIDER = getArg('provider');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find books ready for OCR
  const matchFilter = {
    'pipeline_auto.status': 'archive_complete',
    'pipeline_auto.split_checked': true,
    pages_count: { $gt: 0, $lte: MAX_PAGES },
  };
  if (PROVIDER) matchFilter['image_source.provider'] = PROVIDER;

  const candidates = await db.collection('books')
    .find(matchFilter, { projection: { id: 1, title: 1, pages_count: 1, language: 1 } })
    .sort({ pages_count: 1 })
    .limit(BOOK_COUNT)
    .maxTimeMS(30_000)
    .toArray();

  console.log(`Found ${candidates.length} books at archive_complete (≤${MAX_PAGES}pp${PROVIDER ? ', provider=' + PROVIDER : ''})`);

  if (candidates.length === 0) {
    console.log('Nothing to submit. The orchestrator Phase 2 handles OCR submission.');
    console.log('Run: node scripts/workers/pipeline-orchestrator.mjs --phase 2');
    await client.close();
    return;
  }

  const totalPages = candidates.reduce((s, b) => s + (b.pages_count || 0), 0);
  console.log(`${candidates.length} books, ~${totalPages} pages`);
  console.log(`Estimated cost: ~$${(totalPages * 0.0011).toFixed(2)} (batch pricing)\n`);

  if (DRY_RUN) {
    for (const b of candidates) {
      console.log(`  [dry-run] ${(b.language || '?').padEnd(10)} | ${String(b.pages_count).padStart(4)}pp | ${(b.title || '').slice(0, 60)}`);
    }
    console.log(`\nDry run — ${candidates.length} books would be submitted.`);
    console.log('\nTo submit, run the orchestrator Phase 2 (on Hetzner):');
    console.log('  node scripts/workers/pipeline-orchestrator.mjs --phase 2');
    await client.close();
    return;
  }

  // Delegate to the orchestrator — it handles image download, JSONL building,
  // file-based batch submission, key rotation, and pipeline status updates.
  console.log('Triggering orchestrator Phase 2...\n');
  await client.close();

  const { execSync } = await import('child_process');
  try {
    execSync(
      `node scripts/workers/pipeline-orchestrator.mjs --phase 2`,
      { stdio: 'inherit', timeout: 600_000 }
    );
  } catch (err) {
    console.error('Orchestrator failed:', err.message?.slice(0, 200));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
