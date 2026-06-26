#!/usr/bin/env node
/**
 * Phase 9 — EVIDENCE-BACKED scan (digitization) coverage for the early-modern
 * Latin record (issue #2684, third axis: exists / scanned / translated).
 *
 * The `ustc_editions.has_iiif_scan` flag is PROVENANCE-FREE (set on ~159k Latin
 * editions but `iiif_manifest_url` 0% populated) — the same trap the
 * `has_english_translation` flag was before the work-level rebuild. So instead of
 * trusting the flag we re-derive scan coverage from REAL harvested IIIF manifests:
 * match the harvested Latin manifests (Mongo `import_candidates`, ~387k with a
 * live `manifest_url`) to USTC work-clusters at the WORK level — the same
 * author-anchor + rare-token title-containment matcher used for translations
 * (lib.titleFit) — with added Latin orthography normalization (u/v, i/j) so
 * "Vniuersitatis" ↔ "universitatis".
 *
 * Then crosses scan coverage with the external-translation layer to produce the
 * decision-useful 2×2: scanned×translated over the Renaissance-Latin denominator.
 *
 * Reads:  scripts/output/ustc-latin-clusters.jsonl     (denominator, phase 2)
 *         scripts/output/cluster-external-priors.jsonl (translated, phase 3)
 *         Mongo import_candidates (language=Latin, manifest_url set)
 * Writes: scripts/output/cluster-scan-coverage.jsonl   (cluster → manifest sources)
 *         scripts/output/scan-coverage-report.json
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/09-scan-coverage.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, distinctiveTokens, supa } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// Latin orthography: collapse u/v and i/j so early-modern spelling variants meet.
const orth = (s) => (s || '').replace(/[vV]/g, 'u').replace(/[jJ]/g, 'i');

const WINDOW = [1480, 1620];

async function pullCandidates() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const col = c.db('bookstore').collection('import_candidates');
  const cur = col.find(
    { language: 'Latin', manifest_url: { $ne: null } },
    { projection: { title: 1, author: 1, author_surname: 1, source: 1, manifest_url: 1, date_earliest: 1 } }
  );
  const out = [];
  for await (const d of cur) {
    if (!d.title) continue;
    out.push({ title: d.title, author: d.author || d.author_surname || '', source: d.source || 'iiif', year: d.date_earliest || null });
  }
  await c.close();
  return out;
}

// cluster-level has_iiif_scan flag (the provenance-free baseline) for comparison
async function flaggedClusters() {
  const sb = supa();
  const set = new Set();
  let last = 0;
  while (true) {
    const { data, error } = await sb
      .from('ustc_editions')
      .select('id,work_cluster_id')
      .eq('language_1', 'Latin').gte('year', 1400).lte('year', 1700)
      .eq('has_iiif_scan', true).gt('id', last).order('id', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    for (const r of data) if (r.work_cluster_id) set.add(r.work_cluster_id);
    last = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return set;
}

async function main() {
  const clusters = readJsonl('ustc-latin-clusters.jsonl');
  const priorSet = new Set(readJsonl('cluster-external-priors.jsonl').map((r) => r.work_cluster_id));
  console.log(`clusters: ${clusters.length} | translated (external prior): ${priorSet.size}`);

  // PRECOMPUTE per cluster: distinctive token Set + author stems (once), so the
  // match loop never re-tokenizes a cluster title. DF over those token sets.
  const N = clusters.length;
  const df = new Map();
  const byStem = new Map();
  for (const c of clusters) {
    c._tok = new Set(distinctiveTokens(orth(c.title_repr)));
    c._aStems = surnameStems(orth(c.surname));
    for (const t of c._tok) df.set(t, (df.get(t) || 0) + 1);
    for (const stem of c._aStems) {
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push(c);
    }
  }
  const STRONG_IDF = 6.0, MID_IDF = 5.0;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1));

  console.log('Pulling Latin IIIF manifests from import_candidates…');
  const cands = await pullCandidates();
  console.log(`  candidates with a manifest_url + title: ${cands.length}`);

  const scanned = new Map(); // cluster_id -> { sources:Set, n:count }
  let matched = 0;
  let i = 0;
  for (const w of cands) {
    if (++i % 50000 === 0) console.log(`  scanned-match ${i}/${cands.length}…`);
    const stems = surnameStems(orth(w.author));
    if (!stems.length) continue;
    const cTok = new Set(distinctiveTokens(orth(w.title)));
    if (cTok.size === 0) continue;
    const seen = new Set(); let any = false;
    for (const stem of stems) {
      const arr = byStem.get(stem); if (!arr) continue;
      for (const c of arr) {
        if (seen.has(c.work_cluster_id)) continue;
        seen.add(c.work_cluster_id);
        if (c._tok.size === 0) continue;
        // shared distinctive tokens, minus author-name leak (either side's stems)
        let nStrong = 0, nMid = 0;
        for (const t of cTok) {
          if (!c._tok.has(t)) continue;
          if (stems.some((s) => s.length >= 3 && t.startsWith(s))) continue;
          if (c._aStems.some((s) => s.length >= 3 && t.startsWith(s))) continue;
          const v = idf(t);
          if (v >= STRONG_IDF) nStrong++;
          if (v >= MID_IDF) nMid++;
        }
        if (nStrong >= 1 || nMid >= 2) {
          let p = scanned.get(c.work_cluster_id);
          if (!p) { p = { sources: new Set(), n: 0 }; scanned.set(c.work_cluster_id, p); }
          p.sources.add(w.source); p.n++;
          any = true;
        }
      }
    }
    if (any) matched++;
  }
  console.log(`  candidate manifests that matched ≥1 cluster: ${matched}`);
  console.log(`  DISTINCT clusters with an evidence-backed scan: ${scanned.size}`);

  // write cluster-scan-coverage
  const w1 = fs.createWriteStream(path.join(OUT, 'cluster-scan-coverage.jsonl'));
  for (const [id, p] of scanned) w1.write(JSON.stringify({ work_cluster_id: id, scan_sources: [...p.sources].sort(), n_manifests: p.n }) + '\n');
  w1.end();

  console.log('Pulling has_iiif_scan flag (provenance-free baseline)…');
  const flagSet = await flaggedClusters();

  // --- coverage over denominators ---
  const inWin = (c) => c.year_min >= WINDOW[0] && c.year_min <= WINDOW[1];
  const cov = (subset) => {
    const n = subset.length;
    const sc = subset.filter((c) => scanned.has(c.work_cluster_id)).length;
    const fl = subset.filter((c) => flagSet.has(c.work_cluster_id)).length;
    const tr = subset.filter((c) => priorSet.has(c.work_cluster_id)).length;
    const both = subset.filter((c) => scanned.has(c.work_cluster_id) && priorSet.has(c.work_cluster_id)).length;
    const scanNoTr = subset.filter((c) => scanned.has(c.work_cluster_id) && !priorSet.has(c.work_cluster_id)).length;
    const trNoScan = subset.filter((c) => !scanned.has(c.work_cluster_id) && priorSet.has(c.work_cluster_id)).length;
    const neither = subset.filter((c) => !scanned.has(c.work_cluster_id) && !priorSet.has(c.work_cluster_id)).length;
    const pc = (x) => Number((100 * x / n).toFixed(2));
    return { clusters: n, scanned_evidence: sc, scanned_pct: pc(sc), scanned_flag: fl, flag_pct: pc(fl),
      translated: tr, translated_pct: pc(tr),
      grid: { scanned_and_translated: both, scanned_not_translated: scanNoTr, translated_not_scanned: trNoScan, neither },
      grid_pct: { scanned_and_translated: pc(both), scanned_not_translated: pc(scanNoTr), translated_not_scanned: pc(trNoScan), neither: pc(neither) } };
  };

  const all = cov(clusters);
  const win = cov(clusters.filter(inWin));
  const report = {
    generated: new Date().toISOString().slice(0, 10),
    method: 'evidence-backed scan coverage: real harvested IIIF manifests (import_candidates) matched to USTC work-clusters via author-anchor + rare-token title containment + Latin u/v,i/j orthography normalization. Flag baseline = has_iiif_scan (provenance-free).',
    candidates_latin_manifests: cands.length,
    full_1400_1700: all,
    window_1480_1620: win,
    caveats: [
      'Evidence-backed coverage is a FLOOR: author-anchored matching misses anonymous works (no surname) and orthography/title variants beyond u-v/i-j; un-harvested manifests (mainland-China-style holes, paywalled libraries) are not counted.',
      'The has_iiif_scan flag is provenance-free (no manifest_url) and not validatable; reported only to quantify the flag-vs-evidence gap.',
      'A scan match means the WORK is digitized somewhere (any edition), not that the specific 1400-1700 cluster edition is the scanned copy.',
    ],
  };
  fs.writeFileSync(path.join(OUT, 'scan-coverage-report.json'), JSON.stringify(report, null, 2));

  const show = (label, c) => {
    console.log(`\n=== ${label} (${c.clusters.toLocaleString()} clusters) ===`);
    console.log(`  SCANNED (evidence-backed): ${c.scanned_evidence.toLocaleString()} (${c.scanned_pct}%)   [flag claims ${c.flag_pct}%]`);
    console.log(`  TRANSLATED (external prior): ${c.translated.toLocaleString()} (${c.translated_pct}%)`);
    console.log(`  2×2:  scanned+translated ${c.grid_pct.scanned_and_translated}%  |  scanned·not-translated ${c.grid_pct.scanned_not_translated}%  (the actionable queue)`);
    console.log(`        translated·not-scanned ${c.grid_pct.translated_not_scanned}%  |  neither ${c.grid_pct.neither}%`);
  };
  show('FULL Latin 1400-1700', all);
  show('WINDOW 1480-1620', win);
  console.log('\nwrote cluster-scan-coverage.jsonl + scan-coverage-report.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
