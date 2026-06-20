#!/usr/bin/env node
/**
 * Phase 4 (OPTIONAL, gated) — write the work-level external-translation
 * provenance back to ustc_editions.translation_sources (currently NULL on all
 * 1.6M rows). After this, `translation_sources IS NOT NULL` is the trustworthy,
 * audited "has an external English translation prior" signal — replacing the
 * unreliable author-level `has_english_translation`.
 *
 * SAFETY:
 *   - DRY-RUN by default. Pass --write to mutate.
 *   - Only FILLS a currently-null provenance column (non-destructive, reversible:
 *     set translation_sources back to null to undo).
 *   - Does NOT touch has_english_translation (legacy consumers depend on it);
 *     this adds a parallel, trustworthy channel instead of clobbering.
 *   - Only writes editions whose work_cluster_id is in cluster-external-priors
 *     (work-level matched), never author-level.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/04-write-provenance.mjs            # dry-run
 *        node scripts/translation-layer/04-write-provenance.mjs --write    # mutate
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supa } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const WRITE = process.argv.includes('--write');

async function main() {
  const priors = fs.readFileSync(path.join(OUT, 'cluster-external-priors.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  console.log(`matched clusters: ${priors.length}`);
  if (!WRITE) {
    console.log('\nDRY-RUN (pass --write to mutate). Would set translation_sources on every');
    console.log('ustc_editions row in each matched cluster. Sample of 5 clusters:');
    for (const p of priors.slice(0, 5)) {
      console.log(`  ${p.work_cluster_id}  ← ${p.external_translation_sources.join(', ')}`);
    }
    return;
  }

  const sb = supa();
  let done = 0, editionsTouched = 0, errors = 0;
  for (const p of priors) {
    const sources = p.external_translation_sources;
    const { data, error } = await sb
      .from('ustc_editions')
      .update({ translation_sources: sources })
      .eq('work_cluster_id', p.work_cluster_id)
      .select('id');
    if (error) { errors++; if (errors < 10) console.error(`  ERR ${p.work_cluster_id}: ${error.message}`); }
    else editionsTouched += data.length;
    done++;
    if (done % 250 === 0) process.stdout.write(`\r  ${done}/${priors.length} clusters, ${editionsTouched} editions`);
  }
  process.stdout.write(`\r  ${done}/${priors.length} clusters, ${editionsTouched} editions, ${errors} errors\n`);
  console.log('DONE. translation_sources IS NOT NULL is now the trustworthy work-level prior signal.');
}

main().catch((e) => { console.error(e); process.exit(1); });
