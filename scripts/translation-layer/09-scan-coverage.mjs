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
 *
 * --lang <latin|german|french|italian|spanish|dutch|english> (#7751): the same matcher against the WORKS of phase 11
 * (work-graph[-<lang>].jsonl) instead of the phase-2 clusters, any language. Each USTC edition of a work is a target,
 * so a manifest titled like any edition marks the work. Manifests are those whose `language` names the language
 * (code, word or a `;`-list containing it; 1,256 spellings in import_candidates) plus the untagged ones (Unknown, und,
 * null, Multiple). Anonymous editions, which the author anchor cannot reach (59% of German works), match an
 * authorless manifest only on an identical first-6-token title (orthography folded, >= 4 tokens) within 2 years.
 * Reads work-graph[-<lang>].jsonl + ustc-<lang>-editions.jsonl (phase 11's cache). Writes
 * work-scan-coverage-<lang>.jsonl, scan-queue-<lang>.jsonl (scanned AND ext=false AND no SL book) and
 * scan-coverage-report-<lang>.json.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { surnameStems, distinctiveTokens, normTitle, supa } from './lib.mjs';

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
  ).batchSize(1000);
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

// ---- --lang: works of phase 11, any language (#7751) ----
const LANG_ARG = process.argv.includes('--lang') ? String(process.argv[process.argv.indexOf('--lang') + 1]).toLowerCase() : null;
const LANG_TOKENS = {
  latin: ['lat', 'latin', 'latino', 'latín', 'lalat'],
  german: ['ger', 'deu', 'gmh', 'goh', 'german', 'deutsch', 'gerger', 'deger', 'dger', 'tedesco', 'niem'],
  french: ['fre', 'fra', 'frm', 'fro', 'frc', 'frd', 'fr', 'french', 'français', 'francese', 'franz', 'frfre', 'franco'],
  italian: ['ita', 'italian', 'italiano'],
  spanish: ['spa', 'esp', 'spanish', 'español', 'espanol', 'spagnolo', 'castellano'],
  dutch: ['dut', 'nld', 'dum', 'nl', 'dutch', 'nederlands', 'nll'],
  english: ['eng', 'enm', 'english'],
};
const UNTAGGED = new Set(['unknown', 'und', 'undetermined', 'multiple', 'mul', 'multilingual', 'x-unknown', '']);
// The language tokens of one import_candidates.language value: "pol;ger;lat", "Latin & Greek", "englat" (glued codes).
function langTokens(v) {
  const toks = String(v ?? '').toLowerCase().split(/[^a-zà-ÿ-]+/).filter(Boolean);
  return toks.flatMap((t) => (/^[a-z]{6,}$/.test(t) && t.length % 3 === 0 && !Object.values(LANG_TOKENS).flat().includes(t)) ? t.match(/.{3}/g) : [t]);
}
const langPool = (v, lang) => {
  if (v == null || UNTAGGED.has(String(v).trim().toLowerCase())) return 'untagged';
  return langTokens(v).some((t) => LANG_TOKENS[lang].includes(t)) ? 'tagged' : null;
};

async function pullCandidatesLang(lang) {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const col = c.db('bookstore').collection('import_candidates');
  const values = await col.distinct('language', { manifest_url: { $ne: null } });
  const pool = new Map(values.map((v) => [v, langPool(v, lang)]).filter(([, p]) => p));
  const out = [];
  const cur = col.find({ manifest_url: { $ne: null }, language: { $in: [...pool.keys(), null] } },
    { projection: { title: 1, author: 1, author_surname: 1, source: 1, date_earliest: 1, language: 1 } }).batchSize(2000);
  for await (const d of cur) {
    if (!d.title) continue;
    out.push({ title: d.title, author: d.author || d.author_surname || '', source: d.source || 'iiif',
      year: d.date_earliest ? Number(String(d.date_earliest).slice(0, 4)) || null : null, pool: pool.get(d.language) || 'untagged' });
  }
  await c.close();
  return { cands: out, values_tagged: [...pool].filter(([, p]) => p === 'tagged').length };
}

async function mainLang(lang) {
  const sfx = lang === 'latin' ? '' : `-${lang}`;
  const works = readJsonl(`work-graph${sfx}.jsonl`).filter((w) => w.ustc_sns.length);
  const eds = new Map(readJsonl(`ustc-${lang}-editions.jsonl`).map((e) => [e.sn, e]));
  const workOf = new Map();
  for (const w of works) for (const sn of w.ustc_sns) if (sn != null) workOf.set(sn, w.work);
  // Editions with no sn (German: 121K of 340K) cannot be looked up; a work holding them is matched on its own
  // representative title/author too. A floor: the other sn-less members' titles are not in the graph file.
  const selfEds = works.filter((w) => w.ustc_sns.some((sn) => sn == null)).map((w) => [`w${w.work}`, { author_1: w.author, title: w.title, year: w.year_min }]);
  for (const [k] of selfEds) workOf.set(k, Number(k.slice(1)));
  // targets = editions of these works (authored: token set + stems; anonymous: first-6 key + year)
  const targets = [], df = new Map(), byStem = new Map(), anonKey = new Map();
  const key6 = (t) => normTitle(orth(t)).split(' ').slice(0, 6);
  // Phase 11's join (11-work-graph.mjs): the first K=6 distinctive tokens, author-name tokens stripped. The full-title
  // rule above (one STRONG token anywhere) matched 5 of 20 sampled Latin works rightly: a dedicatee, a praeses or a
  // toponym late in a title page is rare, and so it "matched".
  const lead = (title, stems) => [...new Set(distinctiveTokens(orth(title)))].filter((x) => !stems.some((s) => s.length >= 3 && x.startsWith(s))).slice(0, 6);
  for (const [sn, e] of [...eds].filter(([sn]) => sn != null).concat(selfEds)) {
    const wk = workOf.get(sn); if (wk == null) continue;
    const stems = surnameStems(orth(e.author_1 || ''));
    if (!stems.length) {
      const k = key6(e.title || '');
      if (k.length >= 4) { const kk = k.join(' '); if (!anonKey.has(kk)) anonKey.set(kk, []); anonKey.get(kk).push({ wk, year: e.year }); }
      continue;
    }
    const t = { wk, tok: new Set(lead(e.title, stems)), stems };
    targets.push(t);
    for (const x of t.tok) df.set(x, (df.get(x) || 0) + 1);
    for (const st of stems) { if (!byStem.has(st)) byStem.set(st, []); byStem.get(st).push(t); }
  }
  const N = targets.length;
  const idf = (x) => Math.log((N + 1) / ((df.get(x) || 0) + 1));
  console.log(`${lang}: ${works.length} works, ${targets.length} authored editions, ${anonKey.size} anonymous title keys`);

  const { cands, values_tagged } = await pullCandidatesLang(lang);
  const byPool = { tagged: 0, untagged: 0 };
  for (const c of cands) byPool[c.pool]++;
  console.log(`  manifests: ${cands.length} (tagged ${byPool.tagged} over ${values_tagged} spellings, untagged ${byPool.untagged})`);

  const scanned = new Map(); // work -> { sources:Set, n, via:Set }
  const hit = (wk, c, via) => { let p = scanned.get(wk); if (!p) { p = { sources: new Set(), n: 0, via: new Set(), pools: new Set() }; scanned.set(wk, p); } p.example ??= { title: String(c.title).slice(0, 200), author: c.author, source: c.source, via }; p.sources.add(c.source); p.n++; p.via.add(via); p.pools.add(c.pool); };
  const matchedBy = { author: 0, anon: 0 };
  let i = 0;
  for (const c of cands) {
    if (++i % 200000 === 0) console.log(`  ${i}/${cands.length}…`);
    const stems = surnameStems(orth(c.author));
    if (!stems.length) {
      const k = key6(c.title); if (k.length < 4) continue;
      const arr = anonKey.get(k.join(' ')); if (!arr) continue;
      let any = false;
      for (const a of arr) if (c.year && a.year && Math.abs(c.year - a.year) <= 2) { hit(a.wk, c, 'anon_title_key'); any = true; }
      if (any) matchedBy.anon++;
      continue;
    }
    const cTok = lead(c.title, stems); if (!cTok.length) continue;
    const cW = cTok.reduce((a, x) => a + idf(x), 0);
    const seen = new Set(); let any = false;
    for (const st of stems) {
      for (const t of byStem.get(st) || []) {
        if (seen.has(t.wk) || !t.tok.size) continue;
        let nStrong = 0, nMid = 0, shared = 0, tW = 0;
        for (const x of t.tok) tW += idf(x);
        for (const x of cTok) {
          if (!t.tok.has(x) || t.stems.some((s) => s.length >= 3 && x.startsWith(s))) continue;
          const v = idf(x); shared += v; if (v >= 6.0) nStrong++; if (v >= 5.0) nMid++;
        }
        // IDF-weighted containment >= 0.6 plus the specificity gate, as a phase-11 leader join
        if ((nStrong >= 1 || nMid >= 2) && shared / Math.min(cW, tW) >= 0.6) { seen.add(t.wk); hit(t.wk, c, 'author_title'); any = true; }
      }
    }
    if (any) matchedBy.author++;
  }

  const w1 = fs.createWriteStream(path.join(OUT, `work-scan-coverage-${lang}.jsonl`));
  const q = fs.createWriteStream(path.join(OUT, `scan-queue-${lang}.jsonl`));
  let queue = 0, scannedExt = 0, scannedSl = 0, anonOnly = 0, periodical = 0, scannedPeriodical = 0;
  const byCentury = {};
  for (const w of works) {
    const p = scanned.get(w.work);
    const isIssue = w.ustc_sns.every((sn) => sn == null); // a USTC newspaper issue, one "work" per issue in phase 11
    if (isIssue) { periodical++; if (p) scannedPeriodical++; }
    const cent = `${Math.floor((w.year_min || 0) / 100)}00s`;
    byCentury[cent] ??= { works: 0, scanned: 0 }; byCentury[cent].works++;
    if (!p) continue;
    byCentury[cent].scanned++;
    if (p.via.size === 1 && p.via.has('anon_title_key')) anonOnly++;
    const row = { work: w.work, author: w.author, title: w.title, year_min: w.year_min, n_editions: w.ustc_sns.length,
      scan_sources: [...p.sources].sort(), n_manifests: p.n, via: [...p.via], pools: [...p.pools], example_manifest: p.example };
    w1.write(JSON.stringify(row) + '\n');
    if (w.ext) scannedExt++;
    if (w.sl_books.length) scannedSl++;
    if (!w.ext && !w.sl_books.length) { queue++; q.write(JSON.stringify(row) + '\n'); }
  }
  w1.end(); q.end();
  const pc = (x) => Number((100 * x / works.length).toFixed(2));
  const report = { generated: new Date().toISOString().slice(0, 10), issue: '#7751', lang, unit: 'phase-11 work (>=1 USTC edition 1400-1700)',
    works: works.length, manifests: { total: cands.length, tagged: byPool.tagged, untagged: byPool.untagged, tagged_spellings: values_tagged },
    manifests_matched: matchedBy, periodical_issue_works: periodical, works_excl_periodical_issues: works.length - periodical,
    works_scanned_excl_periodical_issues_pct: Number((100 * (scanned.size - scannedPeriodical) / (works.length - periodical)).toFixed(2)), works_scanned: scanned.size, works_scanned_pct: pc(scanned.size), works_scanned_anon_channel_only: anonOnly,
    scanned_and_ext: scannedExt, scanned_and_sl: scannedSl, queue_scanned_not_ext_not_sl: queue, queue_pct: pc(queue), by_century: byCentury,
    caveats: ['FLOOR: a manifest is counted only if its first six distinctive title tokens meet those of an edition (IDF-weighted containment >= 0.6, phase-11 join) under the author anchor, or (anonymous) an identical first-6-token title within 2 years.',
      'ext is the catalogued external side of phase 11 (curated series + catalogs), itself a floor outside Latin: the queue overstates what is untranslated.',
      'A scanned work means some edition of the work has a harvested manifest, not every edition.'] };
  fs.writeFileSync(path.join(OUT, `scan-coverage-report-${lang}.json`), JSON.stringify(report, null, 2));
  console.log(`  works scanned: ${scanned.size} (${pc(scanned.size)}%), anon-channel only ${anonOnly}; queue ${queue} (${pc(queue)}%)`);
}

(LANG_ARG ? mainLang(LANG_ARG) : main()).catch((e) => { console.error(e); process.exit(1); });
