#!/usr/bin/env node
/**
 * Spot-check the work-level layer against the authors the issue flagged as
 * legacy author-level failures:
 *   Filelfo 130/130 (over-flag), Bembo 43/43, Valla 372/343, Poliziano 105/104,
 *   Pico 128/0 (name-match under-flag).
 * The work-level layer should: shrink the over-flagged (only actually-translated
 * works get a prior) and rescue Pico (the Oration etc. are heavily translated).
 *
 * Usage: node scripts/translation-layer/05-spotcheck.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { surnameStems } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const clusters = readJsonl('ustc-latin-clusters.jsonl');
const priors = new Set(readJsonl('cluster-external-priors.jsonl').map((p) => p.work_cluster_id));

const AUTHORS = ['filelfo', 'bembo', 'valla', 'poliziano', 'politianus', 'pico', 'ficino', 'erasmus'];
console.log('author        | editions | clusters | legacy_trans_clusters | worklevel_external_prior_clusters');
console.log('-'.repeat(95));
for (const a of AUTHORS) {
  const stem = surnameStems(a)[0];
  const cs = clusters.filter((c) => surnameStems(c.surname).includes(stem));
  if (cs.length === 0) continue;
  const editions = cs.reduce((s, c) => s + c.n_editions, 0);
  const legacy = cs.filter((c) => c.legacy_has_translation).length;
  const wl = cs.filter((c) => priors.has(c.work_cluster_id)).length;
  console.log(`${a.padEnd(13)} | ${String(editions).padStart(8)} | ${String(cs.length).padStart(8)} | ${String(legacy).padStart(21)} | ${String(wl).padStart(33)}`);
}
