#!/usr/bin/env node
/**
 * Phase 2 — pull the USTC denominator once and cache it: every Latin edition
 * printed 1400-1700, collapsed to its work_cluster_id.
 *
 * NOTE on the denominator: USTC `year` is the PRINT year, so "Latin 1400-1700"
 * is the early-modern PRINTED-Latin corpus — it INCLUDES early-modern reprints
 * of ancient and medieval works (printed Ovid, printed Aquinas). It is NOT a
 * pure "Renaissance-composed Latin works" set; classifying composition era for
 * all ~500K editions is out of scope here. We therefore report a concrete,
 * reproducible denominator (early-modern Latin print clusters) and treat it as
 * an UPPER bound on the Renaissance-composed corpus.
 *
 * Output: scripts/output/ustc-latin-clusters.jsonl  — one row per work_cluster_id:
 *   { work_cluster_id, surname, title_repr, year_min, n_editions,
 *     legacy_has_translation, in_sl }
 * legacy_has_translation = OR of the (unreliable, author-level) ustc_editions
 * .has_english_translation across the cluster — kept only to quantify the
 * over-count delta against our new work-level layer.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/02-pull-ustc-clusters.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supa, extractSurname } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output/ustc-latin-clusters.jsonl');

async function main() {
  const sb = supa();
  const clusters = new Map();
  let total = 0;
  // keyset pagination on id (NOT offset .range() — offset scans degrade badly
  // past ~100k rows on this 1.6M-row table).
  let lastId = 0;
  const PAGE = 1000;
  const t0 = Date.now();
  while (true) {
    const { data, error } = await sb
      .from('ustc_editions')
      .select('id,work_cluster_id,author_1,title,year,has_english_translation,in_source_library')
      .eq('language_1', 'Latin')
      .gte('year', 1400)
      .lte('year', 1700)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(error.message);
    if (data.length === 0) break;
    lastId = data[data.length - 1].id;
    for (const r of data) {
      const wc = r.work_cluster_id;
      if (!wc) continue;
      let c = clusters.get(wc);
      if (!c) {
        c = {
          work_cluster_id: wc,
          surname: extractSurname(r.author_1) || (wc.split('::')[0] || ''),
          title_repr: r.title || '',
          year_min: r.year || null,
          n_editions: 0,
          legacy_has_translation: false,
          in_sl: false,
        };
        clusters.set(wc, c);
      }
      c.n_editions++;
      if (r.year && (!c.year_min || r.year < c.year_min)) c.year_min = r.year;
      // keep the longest title as representative (more tokens to match on)
      if (r.title && r.title.length > c.title_repr.length) c.title_repr = r.title;
      if (r.has_english_translation) c.legacy_has_translation = true;
      if (r.in_source_library) c.in_sl = true;
    }
    total += data.length;
    if (data.length < PAGE) break;
    if (total % 50000 < PAGE) {
      console.log(`  pulled ${total} editions, ${clusters.size} clusters (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  }
  process.stdout.write(`\r  pulled ${total} editions, ${clusters.size} clusters (${Math.round((Date.now() - t0) / 1000)}s)\n`);

  const w = fs.createWriteStream(OUT);
  for (const c of clusters.values()) w.write(JSON.stringify(c) + '\n');
  w.end();

  // summary
  const arr = [...clusters.values()];
  const legacyTrans = arr.filter((c) => c.legacy_has_translation).length;
  const inSl = arr.filter((c) => c.in_sl).length;
  console.log(`\ntotal Latin 1400-1700 editions: ${total}`);
  console.log(`distinct work clusters:          ${arr.length}`);
  console.log(`  legacy has_translation (author-level, unreliable): ${legacyTrans} (${(100 * legacyTrans / arr.length).toFixed(1)}%)`);
  console.log(`  in_source_library:               ${inSl}`);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => { console.error('\n', e); process.exit(1); });
