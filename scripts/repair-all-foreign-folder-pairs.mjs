#!/usr/bin/env node
/**
 * Driver: runs scripts/repair-foreign-folder-pair.mjs against every
 * (host, partner) in the BPH foreign-folder audit, skipping any pair
 * already handled (host's foreign-folder page count is 0).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/repair-all-foreign-folder-pairs.mjs            # dry-run all
 *   node scripts/repair-all-foreign-folder-pairs.mjs --apply    # apply
 *   node scripts/repair-all-foreign-folder-pairs.mjs --skip 2   # skip first N
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_N = (() => {
  const idx = args.indexOf('--skip');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 0;
})();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

async function main() {
  const auditPath = resolve(REPO_ROOT, '.claude/docs/bph-foreign-folder-pages-2026-05-12.json');
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'));

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Filter: only pairs that still need work (host still has foreign-folder pages).
  const pending = [];
  for (const o of audit) {
    if (!o.sample_foreign_id) continue;
    const remaining = await db.collection('pages').countDocuments({
      book_id: o.id,
      archived_photo: { $regex: o.sample_foreign_id },
    });
    if (remaining > 0) {
      pending.push({ host: o.id, partner: o.sample_foreign_id, slug: o.slug, title: o.title, remaining });
    }
  }
  await client.close();

  console.log(`${pending.length} pairs still need repair (of ${audit.length} in audit).`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}, skipping first ${SKIP_N}.`);

  const work = pending.slice(SKIP_N);
  for (let i = 0; i < work.length; i++) {
    const p = work[i];
    console.log(`\n[${i + 1}/${work.length}] host=${p.host} partner=${p.partner}`);
    console.log(`  ${p.slug} — '${(p.title || '').slice(0, 60)}'`);
    console.log(`  remaining foreign pages: ${p.remaining}`);
    const argv = ['scripts/repair-foreign-folder-pair.mjs', '--host', p.host, '--partner', p.partner];
    if (!APPLY) argv.push('--dry-run');
    const r = spawnSync('node', argv, { stdio: 'inherit', cwd: REPO_ROOT });
    if (r.status !== 0) {
      console.error(`  FAILED on pair ${p.host}/${p.partner}; stopping.`);
      process.exit(r.status || 1);
    }
    // small pause between pairs (skip on the last)
    if (i < work.length - 1) await new Promise(r => setTimeout(r, 1500));
  }
  console.log('\nAll pairs done.');
}

main().catch(err => { console.error(err); process.exit(1); });
