#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/spot-check/overview-score.mjs and review-agreement.py score ONE review run and compare two
 * runs page by page; neither plants errors, matches findings across readers, adjudicates them blind or weights pages
 * back to a frame. This is the offline half of the second-reader calibration (#6338); draw.mjs is the Mongo half and
 * run-readers.sh launches the readers. Design and decision rule: the preregistration in scripts/eval/experiments/
 * (2026-10-08-second-reader-calibration-prereg-6338.md). Run dir layout and the full sequence: RUNBOOK.md.
 *
 *   node scripts/eval/second-reader/second-reader.mjs packets --run R [--share 0.28] [--per-packet 5] [--seed N]
 *   node scripts/eval/second-reader/second-reader.mjs collect --run R --reader NAME [--role read|adjudicate]
 *   node scripts/eval/second-reader/second-reader.mjs cluster --run R --readers a,b,c,d [--seed N]
 *   node scripts/eval/second-reader/second-reader.mjs score   --run R --primary a --control b --candidates c,d
 *          --adjudicators x,y [--retest c=c2] [--interim]
 *   node scripts/eval/second-reader/second-reader.mjs flagged --run R --from <page-integrity out dir>
 *   node scripts/eval/second-reader/second-reader.mjs exclude --run R
 *   node scripts/eval/second-reader/second-reader.mjs export  [--results DIR] [--out FILE] [--check]
 *   node scripts/eval/second-reader/second-reader.mjs dataset [--results DIR] [--out DIR]
 *
 * export / dataset read every committed run under scripts/eval/results/second-reader-6338/<script>/ that has a
 * report.json, and write the site's data file (src/data/second-reader-6338.json) and the published dataset.
 *
 * No network, no database. Everything under R/private/ is what the readers must never see; the run directory is
 * committed only after every read and adjudication is done.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import {
  keyOf, plantErrors, redactRecord, validateOutput, extractIssues, clusterIssues, caughtSeed, krippendorffAlpha,
  weightedMeanCI, wilson, yieldOn, blockOf, signTestOneSided, recoverJson, OMISSION_RE, OMISSION_CLASSES, SEED_CLASSES, recoverArray, auditTranscript,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const R = opt('run');
const J = (...p) => path.join(R, ...p);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(x, null, 1) + '\n'); };
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(0)}%`);
const f2 = (x) => (x == null ? '—' : x.toFixed(2));
const ci = (c, k = 100) => (c ? `[${(c[0] * k).toFixed(1)}, ${(c[1] * k).toFixed(1)}]` : '—');

if (!R && !['help', 'export', 'dataset'].includes(cmd)) { console.error('--run DIR required (see the header of this file)'); process.exit(2); }
const RESULTS = opt('results', path.join(REPO, 'scripts/eval/results/second-reader-6338'));
/** The committed run directories (one per script) that carry a final report. */
const scoredRuns = () => (fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).sort().map((d) => path.join(RESULTS, d)).filter((d) => fs.existsSync(path.join(d, 'report.json'))) : []);

// The texts the readers saw, keyed by page: the planted text where an error was planted.
function packetTexts() {
  const texts = new Map(), records = new Map();
  for (const f of fs.readdirSync(J('packets')).filter((x) => x.endsWith('.json')).sort()) {
    const recs = read(J('packets', f));
    records.set(f.replace(/\.json$/, ''), recs);
    for (const r of recs) for (const p of r.pages) texts.set(keyOf(r.book_id, p.page_number), { ocr: p.ocr ?? '', translation: p.translation ?? '', image_file: p.image_file });
  }
  return { texts, records };
}

/** The reader's validated output across all its packets. */
function loadReader(name, records) {
  const all = { pages: new Map(), missing: [], extra: [], errors: [], fabricated: [], unread: [] };
  for (const [packet, recs] of records) {
    const f = J('readers', name, 'reviews', `${packet}.json`);
    let out = null;
    try { out = read(f); } catch { /* missing or unparsable: every page of the packet is missing */ }
    const v = validateOutput(out, recs);
    for (const [k, p] of v.pages) all.pages.set(k, p);
    all.missing.push(...v.missing); all.extra.push(...v.extra); all.fabricated.push(...v.fabricated); all.unread.push(...(v.unread || []));
    all.errors.push(...v.errors.map((e) => `${packet}: ${e}`));
  }
  return all;
}

const seriousFlag = (p) => (p ? Number([...(p.ocr_errors || []), ...(p.tr_errors || []), ...(p.other || [])].some((e) => e.severity === 'serious') || p.right_page === 'no') : null);

// ── flagged / exclude: the draw's two inputs, built by rule ─────────────────────────────────────────────────
// flagged: page-level flags from scripts/audit/page-integrity.mjs shard files (rows { kind, book, p }), restricted
// to the kinds that mark a defect ON the page (not a neighbour relation). exclude: every book in any earlier
// spot-check / shelf-overview packet — those reviews led to hides and fixes, so the books are no longer typical.
if (cmd === 'flagged') {
  const KINDS = new Set(['trunc', 'echo', 'repeat', 'vocab', 'meta', 'ocrleak', 'dup', 'pnmis']);
  const seen = new Set(), out = [], byKind = {};
  for (const d of list(opt('from'))) for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!KINDS.has(o.kind) || !o.book || !(o.p > 0)) continue;
      byKind[o.kind] = (byKind[o.kind] || 0) + 1;
      const k = keyOf(o.book, o.p);
      if (!seen.has(k)) { seen.add(k); out.push({ book_id: o.book, page_number: o.p, kind: o.kind }); }
    }
  }
  write(J('flagged.json'), out);
  console.log(`flagged: ${out.length} pages in ${new Set(out.map((x) => x.book_id)).size} books ${JSON.stringify(byKind)} → ${J('flagged.json')}`);
}
else if (cmd === 'exclude') {
  const ids = new Set();
  const root = opt('from', path.join(REPO, 'scripts/eval/results/spot-check'));
  for (const d of fs.readdirSync(root)) {
    const pk = path.join(root, d, 'packets');
    if (!fs.existsSync(pk)) continue;
    for (const f of fs.readdirSync(pk).filter((x) => x.endsWith('.json'))) for (const r of read(path.join(pk, f))) if (r.book_id) ids.add(r.book_id);
  }
  write(J('exclude.json'), [...ids].sort());
  console.log(`exclude: ${ids.size} books reviewed in earlier runs under ${root} → ${J('exclude.json')}`);
}

// ── packets ─────────────────────────────────────────────────────────────────────────────────────────────────
else if (cmd === 'packets') {
  const draw = read(J('private', 'draw.json'));
  if (fs.existsSync(J('packets'))) throw new Error(`${J('packets')} exists — refusing to plant over a run`);
  const seed = Number(opt('seed', draw.meta.seed + 1));
  const perPacket = Number(opt('per-packet', 5));
  const units = draw.picks.map((p) => ({ key: keyOf(p.book_id, p.page_number), book_id: p.book_id, script: p.script, ocr: p.record.pages[0].ocr, translation: p.record.pages[0].translation }));
  const { pages: planted, key } = plantErrors(units, { share: Number(opt('share', 0.28)), seed });
  const byKey = new Map(planted.map((u) => [u.key, u]));
  const ordered = [...draw.picks].sort((a, b) => a.order - b.order);
  const n = ordered.length;
  const unitMeta = [];
  let slot = 0;
  for (let i = 0; i < n; i += perPacket) {
    const chunk = ordered.slice(i, i + perPacket);
    const name = `p${String(i / perPacket + 1).padStart(3, '0')}`;
    const recs = chunk.map((pick) => {
      const k = keyOf(pick.book_id, pick.page_number), u = byKey.get(k);
      const rec = structuredClone(pick.record);
      rec.slot = ++slot;
      rec.pages[0].ocr = u.ocr; rec.pages[0].translation = u.translation;
      unitMeta.push({ key: k, packet: name, order: pick.order, block: blockOf(pick.order, n), weight: pick.weight, stratum: pick.stratum, script: pick.script, planted: key.find((s) => s.key === k)?.class ?? null });
      return redactRecord(rec);
    });
    write(J('packets', `${name}.json`), recs);
  }
  write(J('private', 'key.json'), { seed, share: Number(opt('share', 0.28)), planted: key });
  write(J('private', 'units.json'), unitMeta);
  const counts = Object.fromEntries(SEED_CLASSES.map((c) => [c, key.filter((s) => s.class === c).length]));
  console.log(`packets: ${Math.ceil(n / perPacket)} × ≤${perPacket} pages; ${key.length} of ${n} pages planted ${JSON.stringify(counts)}`);
}

// ── collect: recover a JSON array from stdout when no file was written; audit what the reader opened ───────
else if (cmd === 'collect') {
  const name = opt('reader'), role = opt('role', 'read');
  const base = role === 'adjudicate' ? J('adjudication', name) : J('readers', name);
  const packets = role === 'adjudicate'
    ? fs.readdirSync(J('adjudication', 'chunks')).filter((x) => x.endsWith('.json')).map((x) => x.replace(/\.json$/, ''))
    : fs.readdirSync(J('packets')).filter((x) => x.endsWith('.json')).map((x) => x.replace(/\.json$/, ''));
  const report = { reader: name, role, recovered: [], missing: [], audit: {} };
  for (const p of packets.sort()) {
    const out = path.join(base, 'reviews', `${p}.json`);
    const metaDir = path.join(base, 'meta');
    const logs = fs.existsSync(metaDir) ? fs.readdirSync(metaDir).filter((x) => x.startsWith(p + '.') || x.startsWith(p + '-')).map((x) => path.join(metaDir, x)) : [];
    if (!fs.existsSync(out) || !fs.statSync(out).size) {
      const arr = logs.map((l) => recoverArray(fs.readFileSync(l, 'utf8'))).find(Boolean);
      if (arr) { write(out, arr); report.recovered.push(p); } else report.missing.push(p);
    }
    report.audit[p] = logs.filter((l) => l.endsWith('.jsonl')).map((l) => auditTranscript(fs.readFileSync(l, 'utf8')))
      .reduce((a, b) => ({ audited: a.audited || b.audited, outside: [...a.outside, ...b.outside], outside_writes: [...a.outside_writes, ...b.outside_writes] }), { audited: false, outside: [], outside_writes: [] });
  }
  write(path.join(base, 'collect.json'), report);
  const outside = Object.entries(report.audit).filter(([, a]) => a.outside.length);
  const unaudited = Object.entries(report.audit).filter(([, a]) => !a.audited).length;
  console.log(`${name}: ${packets.length} packets, ${report.recovered.length} recovered from stdout, ${report.missing.length} missing; ` +
    `${outside.length} with READS outside the sealed folder${outside.length ? ': ' + outside.map(([p]) => p).join(', ') : ''}; ${unaudited} unaudited (no claude transcript)`);
}

// ── cluster: match findings across readers; build the blind adjudication set ──────────────────────────────
else if (cmd === 'cluster') {
  const readers = list(opt('readers'));
  const { texts, records } = packetTexts();
  const units = new Map(read(J('private', 'units.json')).map((u) => [u.key, u]));
  const issues = readers.flatMap((r) => extractIssues(r, loadReader(r, records), texts));
  const clusters = clusterIssues(issues);
  const rng = makeRng(Number(opt('seed', 6338)));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hex = () => Array.from({ length: 10 }, () => Math.floor(rng() * 16).toString(16)).join('');

  // Adjudicate every cluster on an UNPLANTED page that some reader called serious, except those all readers called
  // serious; of those, a sample of up to 10 is adjudicated as a check and the rest are taken as confirmed.
  const natural = clusters.filter((c) => !units.get(c.key)?.planted);
  const anySerious = natural.filter((c) => Object.values(c.by).includes('serious'));
  const allSerious = anySerious.filter((c) => readers.every((r) => c.by[r] === 'serious'));
  const allCheck = shuffle([...allSerious]).slice(0, 10);
  const toJudge = [...anySerious.filter((c) => !allSerious.includes(c)), ...allCheck];
  const classNames = taxonomyNames();
  const laneOf = (kind) => (kind === 'ocr' ? 'transcription' : kind === 'leaf' ? 'page' : 'translation');
  const item = (key, claim) => ({ item_id: hex(), key, image_file: texts.get(key).image_file, ocr: texts.get(key).ocr, translation: texts.get(key).translation, claim });
  const items = [], adjKey = [];
  for (const c of toJudge) {
    const it = item(c.key, { lane: laneOf(c.kind), class: c.cls, class_name: classNames[c.cls] ?? null, quote: c.kind === 'leaf' ? '' : (c.quote ?? '') });
    items.push(it); adjKey.push({ item_id: it.item_id, type: 'cluster', cluster: c.id, all_serious_check: allCheck.includes(c) });
  }
  // Planted claims measure the adjudicator. TRUE: planted errors with a span. FALSE: a sentence of an unplanted page
  // no reader flagged at all, claimed as an inverted sense (a lower bound: such a page may still hold a real error).
  const nDecoy = Math.max(5, Math.round(items.length / 10));
  const planted = read(J('private', 'key.json')).planted.filter((s) => s.span);
  for (const s of shuffle([...planted]).slice(0, nDecoy)) {
    const t = texts.get(s.key).translation;
    items.push(item(s.key, { lane: 'translation', class: 'T8', class_name: classNames.T8 ?? null, quote: t.slice(s.span[0], s.span[1]).trim() }));
    adjKey.push({ item_id: items.at(-1).item_id, type: 'decoy_true', planted: s.class });
  }
  const flaggedKeys = new Set(clusters.map((c) => c.key));
  const quiet = shuffle([...units.values()].filter((u) => !u.planted && !flaggedKeys.has(u.key)).map((u) => u.key));
  for (const k of quiet.slice(0, nDecoy)) {
    const sents = texts.get(k).translation.split(/(?<=[.!?;])\s+/).filter((x) => x.length >= 30 && !/[<>]/.test(x));
    if (!sents.length) continue;
    items.push(item(k, { lane: 'translation', class: 'T8', class_name: classNames.T8 ?? null, quote: sents[Math.floor(rng() * sents.length)].trim() }));
    adjKey.push({ item_id: items.at(-1).item_id, type: 'decoy_false' });
  }
  shuffle(items);
  // The by-eye work: every item two adjudicators split on (known only after they run) plus a random 20 items, and
  // 20 unplanted pages no reader called serious (the shared-miss check).
  const eyeItems = shuffle(items.map((x) => x.item_id)).slice(0, 20);
  const cleanPages = shuffle([...units.values()].filter((u) => !u.planted && !anySerious.some((c) => c.key === u.key)).map((u) => u.key)).slice(0, 20);

  write(J('clusters.json'), { readers, n_issues: issues.length, clusters: clusters.map(({ members, ...c }) => ({ ...c, members: members.map((m) => ({ reader: m.reader, kind: m.kind, severity: m.severity, cls: m.cls, quote: m.quote, fabricated: m.fabricated })) })) });
  fs.rmSync(J('adjudication', 'chunks'), { recursive: true, force: true });
  for (let i = 0; i < items.length; i += 10) write(J('adjudication', 'chunks', `a${String(i / 10 + 1).padStart(3, '0')}.json`), items.slice(i, i + 10));
  write(J('private', 'adjudication-key.json'), { items: adjKey, by_eye_items: eyeItems, clean_pages: cleanPages });
  write(J('adjudication', 'by-eye-todo.json'), {
    note: 'Fill by-eye.json: { items: [{ item_id, real, serious, note, who }], clean_pages: [{ key, serious_found, note, who }] }. The item list grows by every item the adjudicators split on; `score` lists them.',
    items: eyeItems, clean_pages: cleanPages.map((k) => ({ key: k, image_file: texts.get(k).image_file })),
  });
  console.log(`${issues.length} issues → ${clusters.length} clusters (${natural.length} on unplanted pages; ${anySerious.length} called serious by someone, ${allSerious.length} by all). ` +
    `Adjudication: ${toJudge.length} clusters + ${adjKey.filter((x) => x.type !== 'cluster').length} planted claims = ${items.length} items in ${Math.ceil(items.length / 10)} chunks.`);
}

// ── score ───────────────────────────────────────────────────────────────────────────────────────────────────
else if (cmd === 'score') {
  const P = opt('primary'), C = opt('control'), cands = list(opt('candidates')), adjs = list(opt('adjudicators'));
  const retest = Object.fromEntries(list(opt('retest')).map((x) => x.split('=')));
  const readers = [P, C, ...cands, ...Object.values(retest)];
  const { texts, records } = packetTexts();
  const units = read(J('private', 'units.json'));
  const plantedKey = read(J('private', 'key.json')).planted;
  const R_ = Object.fromEntries(readers.map((r) => [r, loadReader(r, records)]));
  const issues = Object.fromEntries(readers.map((r) => [r, extractIssues(r, R_[r], texts)]));
  if (!cands.length || !P || !C) throw new Error('--primary, --control and --candidates are required');
  const { clusters, readers: clusterReaders } = read(J('clusters.json'));
  const notClustered = readers.filter((r) => !clusterReaders.includes(r));
  if (notClustered.length) throw new Error(`readers not in clusters.json (re-run cluster with them): ${notClustered.join(', ')}`);
  const interim = flag('interim');

  // Adjudication: both adjudicators agreeing settles an item; a split, or any item in the by-eye sample, needs the
  // by-eye verdict, which wins. 'unsure' never confirms.
  const ak = read(J('private', 'adjudication-key.json'));
  const adj = Object.fromEntries(adjs.map((a) => [a, new Map(readArrays(J('adjudication', a, 'reviews')).map((v) => [v.item_id, v]))]));
  const eye = fs.existsSync(J('adjudication', 'by-eye.json')) ? read(J('adjudication', 'by-eye.json')) : { items: [], clean_pages: [] };
  const eyeBy = new Map((eye.items || []).map((v) => [v.item_id, v]));
  const verdictOf = new Map(), needEye = [], adjStats = Object.fromEntries(adjs.map((a) => [a, { decoy_true: [0, 0], decoy_false: [0, 0], vs_eye: [0, 0] }]));
  for (const it of ak.items) {
    const vs = adjs.map((a) => adj[a].get(it.item_id)).filter(Boolean);
    const conf = (v) => v && v.real === 'yes' && v.serious === true;
    const agree = vs.length === adjs.length && vs.every((v) => v.real === vs[0].real && !!v.serious === !!vs[0].serious) && vs[0].real !== 'unsure';
    const e = eyeBy.get(it.item_id);
    if ((!agree || ak.by_eye_items.includes(it.item_id)) && !e) needEye.push(it.item_id);
    const final = e ? conf(e) : agree ? conf(vs[0]) : false;
    // Whether the claimed error is there at all (amendment 2): settled by the eye, else by agreeing adjudicators; a split
    // with no eye verdict is unsettled (null) and counts neither as a false alarm nor as a real error.
    const realFinal = e ? e.real === 'yes' : agree ? vs[0].real === 'yes' : null;
    for (const a of adjs) {
      const v = adj[a].get(it.item_id); if (!v) continue;
      if (it.type === 'decoy_true') { adjStats[a].decoy_true[1]++; if (conf(v)) adjStats[a].decoy_true[0]++; }
      if (it.type === 'decoy_false') { adjStats[a].decoy_false[1]++; if (v.real === 'no') adjStats[a].decoy_false[0]++; }
      if (e) { adjStats[a].vs_eye[1]++; if (conf(v) === conf(e)) adjStats[a].vs_eye[0]++; }
    }
    if (it.type === 'cluster') verdictOf.set(it.cluster, { confirmedSerious: final, real: realFinal, by: e ? 'eye' : agree ? 'adjudicators' : 'unsettled' });
  }
  // Clusters every clustered reader called serious, on natural pages, not sampled for a check: taken as confirmed.
  const judged = new Set(ak.items.filter((x) => x.type === 'cluster').map((x) => x.cluster));
  const plantedKeys = new Set(units.filter((u) => u.planted).map((u) => u.key));
  for (const c of clusters) if (!judged.has(c.id) && !plantedKeys.has(c.key) && clusterReaders.every((r) => c.by[r] === 'serious')) verdictOf.set(c.id, { confirmedSerious: true, real: true, by: 'all_readers' });

  const byKey = new Map(); for (const c of clusters) { if (!byKey.has(c.key)) byKey.set(c.key, []); byKey.get(c.key).push(c); }
  const natural = units.filter((u) => !u.planted);
  const plantedUnits = units.filter((u) => u.planted);

  // Per reader: returned pages, recall on planted errors, false alarms and confirmed finds on natural pages.
  const perReader = {};
  for (const r of readers) {
    const recall = {};
    for (const cls of ['all', ...SEED_CLASSES]) recall[cls] = { n: 0, detected: 0, serious: 0 };
    for (const u of plantedUnits) {
      const s = plantedKey.find((x) => x.key === u.key);
      const res = caughtSeed(s, issues[r], R_[r].pages.get(u.key), texts.get(u.key).translation);
      for (const cls of ['all', s.class]) { recall[cls].n++; recall[cls].detected += res.detected; recall[cls].serious += res.serious; }
    }
    const omissionBackground = natural.filter((u) => issues[r].some((x) => x.key === u.key && x.kind === 'tr' && (OMISSION_CLASSES.has(x.cls) || OMISSION_RE.test(x.problem ?? '')))).length;
    const mineSerious = natural.flatMap((u) => (byKey.get(u.key) || []).filter((c) => c.by[r] === 'serious'));
    const settled = mineSerious.filter((c) => verdictOf.has(c.id));
    // Amendment 2 (the pilot: Gemini called 15 of 16 pages serious where Opus called 6): a FALSE ALARM is a serious
    // claim adjudicated NOT REAL. A real error the reader graded serious and the adjudication did not is SEVERITY
    // INFLATION: reported, but it does not count against the reader's false-alarm cap.
    const isFalse = (c) => verdictOf.get(c.id)?.real === false;
    const isInflated = (c) => verdictOf.get(c.id)?.real === true && !verdictOf.get(c.id).confirmedSerious;
    const falseAlarms = settled.filter(isFalse).length;
    perReader[r] = {
      returned: units.filter((u) => R_[r].pages.has(u.key)).length, missing: R_[r].missing.length, unread: R_[r].unread.length, fabricated_quotes: R_[r].fabricated.length, schema_errors: R_[r].errors.length,
      printed_marker_filled: [...R_[r].pages.values()].filter((p) => typeof p.printed_marker === 'string' && p.printed_marker.trim()).length,
      recall, omission_background: [omissionBackground, natural.length],
      serious_raised: mineSerious.length, serious_settled: settled.length, false_alarms: falseAlarms, severity_inflation: settled.filter(isInflated).length,
      false_alarms_per100: weightedMeanCI(natural.map((u) => (byKey.get(u.key) || []).filter((c) => c.by[r] === 'serious' && isFalse(c)).length), natural.map((u) => u.weight)),
      confirmed_per100: weightedMeanCI(natural.map((u) => yieldOn(byKey.get(u.key) || [], verdictOf, [r])), natural.map((u) => u.weight)),
    };
  }

  // The decision (preregistration, amended 2026-10-08 after the power simulation in power.mjs, before any data).
  // Error-level test: among confirmed serious issues the PRIMARY missed, b = found by the candidate and not the
  // control, c = found by the control and not the candidate; one-sided exact sign test, alpha 0.025 per candidate
  // (Bonferroni over two). Practical yardstick: the weighted gain (primary ∪ candidate) − (primary ∪ control) per
  // page, point estimate ≥ GAIN_BAR. False alarms at most FA_MARGIN per page above the primary's.
  const GAIN_BAR = 0.03, FA_MARGIN = 0.03, ALPHA = 0.025;
  const gain = (cand, us) => weightedMeanCI(us.map((u) => yieldOn(byKey.get(u.key) || [], verdictOf, [P, cand]) - yieldOn(byKey.get(u.key) || [], verdictOf, [P, C])), us.map((u) => u.weight));
  const missedByP = natural.flatMap((u) => (byKey.get(u.key) || []).filter((c) => verdictOf.get(c.id)?.confirmedSerious && !c.by[P]));
  const faP = perReader[P].false_alarms_per100.est ?? 0;
  const tests = cands.map((cand) => {
    const b = missedByP.filter((c) => c.by[cand] && !c.by[C]).length, c = missedByP.filter((x) => x.by[C] && !x.by[cand]).length;
    const g = gain(cand, natural), fa = perReader[cand].false_alarms_per100.est ?? 0;
    const p = signTestOneSided(b, c);
    return { candidate: cand, b, c, p, gain: g, fa, passes: p < ALPHA && g.est != null && g.est >= GAIN_BAR && fa <= faP + FA_MARGIN };
  });
  const passing = tests.filter((t) => t.passes).sort((x, y) => (Math.abs(x.gain.est - y.gain.est) > 0.01 ? y.gain.est - x.gain.est : 0));
  // Does a second Opus read earn its place? yield(primary ∪ control) − yield(primary) on the same pages.
  const o2 = weightedMeanCI(natural.map((u) => yieldOn(byKey.get(u.key) || [], verdictOf, [P, C]) - yieldOn(byKey.get(u.key) || [], verdictOf, [P])), natural.map((u) => u.weight));
  let decision;
  if (interim) {
    const futile = tests.every((t) => t.b <= t.c);
    decision = { stage: 'interim (after the first script)', tests, verdict: futile ? 'STOP — futility: no candidate found more of the primary\'s misses than the control did' : 'CONTINUE to the other scripts' };
  } else {
    decision = { stage: 'final (this script; the pooled decision across scripts is made by `export`)', tests, chosen: passing[0]?.candidate ?? null, gain_all: passing[0]?.gain ?? null,
      fa_primary: faP, second_opus_gain: o2, missed_by_primary: missedByP.length,
      verdict: passing.length ? `ADOPT ${passing[0].candidate} for this script` : 'NOT SHOWN for this script' };
  }

  // Agreement on natural pages: Krippendorff's alpha (missing pages allowed).
  const alpha = (rs, field, level) => krippendorffAlpha(natural.map((u) => rs.map((r) => { const p = R_[r].pages.get(u.key); return field === 'serious' ? seriousFlag(p) : (p?.[field] ?? null); })), level);
  const pairs = [[P, C, 'within-family floor'], ...cands.map((c) => [P, c, 'cross-family']), ...Object.entries(retest).map(([a, b]) => [a, b, 'candidate retest floor'])];
  const agreement = pairs.map(([a, b, what]) => ({ pair: `${a}–${b}`, what, serious: alpha([a, b], 'serious', 'nominal'), ocr: alpha([a, b], 'ocr_score', 'ordinal'), tr: alpha([a, b], 'tr_score', 'ordinal') }));

  // Table 4 (UpSet): confirmed serious clusters on natural pages, by the exact set of readers that raised them.
  const naturalKeys = new Set(natural.map((u) => u.key));
  const confirmed = clusters.filter((c) => naturalKeys.has(c.key) && verdictOf.get(c.id)?.confirmedSerious);
  const upset = {};
  for (const c of confirmed) { const sig = readers.filter((r) => c.by[r]).join('+') || '(none)'; upset[sig] = (upset[sig] || 0) + 1; }

  // Table 7: cost per confirmed serious issue found (claude: total_cost_usd from the transcript; agy: $0, seconds).
  for (const r of readers) {
    const meta = J('readers', r, 'meta');
    let usd = 0, seconds = 0;
    if (fs.existsSync(meta)) for (const f of fs.readdirSync(meta)) {
      const p = path.join(meta, f);
      if (f.endsWith('.jsonl')) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { try { const o = JSON.parse(line); if (o.type === 'result') usd += o.total_cost_usd || 0; } catch { /* not JSON */ } }
      if (f.endsWith('.time.json')) { try { seconds += read(p).seconds || 0; } catch { /* unreadable */ } }
    }
    const found = confirmed.filter((c) => c.by[r]).length;
    perReader[r].cost = { usd_equivalent: +usd.toFixed(2), seconds, confirmed_found: found, usd_per_confirmed: found ? +(usd / found).toFixed(2) : null };
  }

  // Table 8. H2: the lane of each candidate's confirmed finds the primary missed, and the primary's the candidate
  // missed. H3: recall on planted TRANSLATION errors, and the English score against the primary's on the same pages.
  const lane = (c) => (c.kind === 'ocr' ? 'transcription' : c.kind === 'leaf' ? 'page' : 'translation');
  const laneCount = (list) => list.reduce((o, c) => ({ ...o, [lane(c)]: (o[lane(c)] || 0) + 1 }), {});
  const TR_CLASSES = ['negation', 'number', 'invented', 'dropped'];
  const hypotheses = Object.fromEntries(cands.map((c) => {
    const paired = natural.filter((u) => R_[c].pages.get(u.key)?.tr_score != null && R_[P].pages.get(u.key)?.tr_score != null);
    return [c, {
      h2_unique_to_candidate: laneCount(confirmed.filter((x) => x.by[c] && !x.by[P])),
      h2_unique_to_primary: laneCount(confirmed.filter((x) => x.by[P] && !x.by[c])),
      h3_translation_recall: Object.fromEntries([P, c].map((r) => { const n = TR_CLASSES.reduce((s, k) => s + perReader[r].recall[k].n, 0), k = TR_CLASSES.reduce((s, x) => s + perReader[r].recall[x].serious, 0); return [r, { serious: k, n, ci95: wilson(k, n) }]; })),
      h3_en_score_minus_primary: weightedMeanCI(paired.map((u) => R_[c].pages.get(u.key).tr_score - R_[P].pages.get(u.key).tr_score), paired.map((u) => u.weight)),
    }];
  }));

  const cleanEye = eye.clean_pages || [];
  const report = {
    issue: 6338, interim, readers, adjudicators: adjs, n_units: units.length, n_natural: natural.length, n_planted: plantedUnits.length,
    incomplete: needEye.length ? { by_eye_needed: needEye } : null,
    decision, per_reader: perReader, agreement, upset, hypotheses,
    scored_at: new Date().toISOString().slice(0, 10), script: units[0]?.script ?? null,
    adjudicators_measured: adjStats,
    shared_miss: { pages_read: cleanEye.length, serious_found: cleanEye.filter((x) => x.serious_found).length, ci95: wilson(cleanEye.filter((x) => x.serious_found).length, cleanEye.length) },
    settled_by: [...verdictOf.values()].reduce((o, v) => ({ ...o, [v.by]: (o[v.by] || 0) + 1 }), {}),
  };
  write(J(interim ? 'report-interim.json' : 'report.json'), report);
  fs.writeFileSync(J(interim ? 'report-interim.md' : 'report.md'), markdown(report));
  console.log(markdown(report));
}

// ── cli-requests / cli-assemble: the Gemini readers, through scripts/eval/run-cli-arm.py (amendment 2) ─────────
// The #6338 pilot (scripts/eval/experiments/2026-10-09-second-reader-pilot-gemini-cli-6338.md) ran Gemini this way:
// plan mode, no tools, one PAGE per call (a four-image call found about half the errors), the frozen brief inline, the
// image attached, and the CLI's own nudge when the model asks for a tool. These two commands turn the sealed packets
// into that runner's requests and its replies back into review files, so the calibration uses the pilot's tested path.
else if (cmd === 'cli-requests') {
  const name = opt('reader'), role = opt('role', 'read');
  const body = (f) => fs.readFileSync(f, 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  const taxo = Object.entries(taxonomyNames()).map(([k, v]) => `- ${k} · ${v}`).join('\n');
  const rows = [];
  if (role === 'read') {
    const brief = `${body(path.join(REPO, 'scripts/eval/spot-check/REVIEWER.md')).trim()}\n\n${body(path.join(HERE, 'CALIBRATION-ADDENDUM.md')).trim()}`;
    const wrapper = '## How this request is run (not part of the brief)\n\nYou cannot open files, run commands or write files here; do not try. The class codes are listed below instead of the taxonomy file. PACKET_FILE is given inline below and holds ONE book with ONE page. The page image is the file attached at the end of this message; it is the image the packet\'s `image_file` names. Do steps 3 and 4 for this page. OUTPUT_FILE is your reply: reply with ONLY one JSON object, the page entry from the schema with the addendum\'s two fields (`page_number`, `right_page`, `ocr_score`, `ocr_errors`, `tr_score`, `tr_errors`, `other`, `confidence`, `printed_marker`, `layout`), with no prose and no markdown fence.';
    for (const f of fs.readdirSync(J('packets')).filter((x) => x.endsWith('.json')).sort()) {
      const recs = read(J('packets', f));
      if (recs.length !== 1 || recs[0].pages.length !== 1) throw new Error(`${f}: ${recs.length} books / ${recs[0]?.pages.length} pages — Gemini reads one page per call (pilot, #6338); cut packets with --per-packet 1`);
      rows.push({ uid: f.replace(/\.json$/, ''), image: path.resolve(R, recs[0].pages[0].image_file), prompt: `${brief}\n\nThe error classes (the headings of page-error-taxonomy.md):\n${taxo}\n\n${wrapper}\n\nPACKET_FILE:\n${JSON.stringify(recs, null, 1)}` });
    }
  } else {
    const brief = body(path.join(HERE, 'ADJUDICATOR.md')).trim();
    const wrapper = '## How this request is run (not part of the brief)\n\nYou cannot open files, run commands or write files here; do not try. ITEMS_FILE is given inline below and holds ONE item; its image is the file attached at the end of this message. OUTPUT_FILE is your reply: reply with ONLY one JSON object (`item_id`, `real`, `serious`, `note`), with no prose and no markdown fence.';
    for (const f of fs.readdirSync(J('adjudication', 'chunks')).filter((x) => x.endsWith('.json')).sort()) for (const it of read(J('adjudication', 'chunks', f)))
      rows.push({ uid: it.item_id, image: path.resolve(R, it.image_file), prompt: `${brief}\n\n${wrapper}\n\nITEMS_FILE:\n${JSON.stringify([it], null, 1)}` });
  }
  const base = role === 'read' ? J('readers', name) : J('adjudication', name);
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'requests.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // The packet must carry none of the fields redaction removes (a page's own text may legitimately contain a URL).
  const leak = rows.filter((r) => /"(ocr_model|ocr_engine|translation_model|translation_source|image_url|book_url|page_id|image_source)"\s*:/.test(r.prompt.slice(r.prompt.indexOf(role === 'read' ? 'PACKET_FILE:' : 'ITEMS_FILE:'))));
  if (leak.length) throw new Error(`${leak.length} requests carry a model or URL field in the packet: redaction failed`);
  console.log(`${rows.length} requests → ${path.join(base, 'requests.jsonl')}\nnext: python3 scripts/eval/run-cli-arm.py --requests ${path.join(base, 'requests.jsonl')} --out ${path.join(base, 'cli-out.jsonl')} --arm sr6338-${name} --model <model> --job second-reader-6338 --kind review --parallel 2 --attempts 4`);
}

else if (cmd === 'cli-assemble') {
  const name = opt('reader'), role = opt('role', 'read');
  const base = role === 'read' ? J('readers', name) : J('adjudication', name);
  const last = new Map();
  for (const line of fs.readFileSync(opt('from', path.join(base, 'cli-out.jsonl')), 'utf8').split('\n')) { try { const o = JSON.parse(line); if (o.uid) last.set(o.uid, o); } catch { /* not a row */ } }
  const want = fs.readFileSync(path.join(base, 'requests.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).uid);
  const report = { reader: name, role, requests: want.length, written: 0, no_reply: [], unparsable: [], nudged: 0 };
  fs.mkdirSync(path.join(base, 'reviews'), { recursive: true }); fs.mkdirSync(path.join(base, 'meta'), { recursive: true });
  for (const uid of want) {
    const row = last.get(uid);
    if (!row || !row.text) { report.no_reply.push(uid); continue; }
    if (row.nudged) report.nudged++;
    let obj = recoverJson(row.text);
    if (Array.isArray(obj)) obj = obj[0]?.pages ? obj[0].pages[0] : obj[0];
    else if (obj?.pages) obj = obj.pages[0];
    if (!obj || typeof obj !== 'object') { report.unparsable.push(uid); continue; }
    if (role === 'read') {
      const [rec] = read(J('packets', `${uid}.json`));
      obj.page_number ??= rec.pages[0].page_number;
      write(path.join(base, 'reviews', `${uid}.json`), [{ book_id: rec.book_id, pages: [obj] }]);
    } else write(path.join(base, 'reviews', `${uid}.json`), [{ ...obj, item_id: uid }]);
    write(path.join(base, 'meta', `${uid}.time.json`), { packet: uid, seconds: row.secs ?? null, attempts: row.attempts ?? null });
    report.written++;
  }
  write(path.join(base, 'assemble.json'), report);
  console.log(`${name}: ${report.written}/${report.requests} written; ${report.no_reply.length} without a reply, ${report.unparsable.length} unparsable, ${report.nudged} nudged`);
}

// ── export: the ONE file the site and the paper read (preregistration, "Reporting plan") ─────────────────────
// Every number on /research/quality and in the paper comes from here. `--check` rebuilds it in memory and exits 1
// if the committed file differs, so a typed or stale number cannot survive.
else if (cmd === 'export') {
  const OUT = opt('out', path.join(REPO, 'src/data/second-reader-6338.json'));
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const per100 = (m) => ({ est: m?.est == null ? null : r1(100 * m.est), ci95: m?.ci95 ? m.ci95.map((v) => r1(100 * v)) : null, n: m?.n ?? null });
  const rate = (k, n) => ({ k, n, est: n ? r1(100 * k / n) : null, ci95: n ? wilson(k, n).map((v) => r1(100 * v)) : null });
  const scripts = scoredRuns().map((d) => {
    const r = read(path.join(d, 'report.json'));
    return {
      script: r.script, scored_at: r.scored_at, complete: !r.incomplete,
      pages: r.n_units, natural_pages: r.n_natural, planted_pages: r.n_planted,
      verdict: r.decision.verdict, chosen: r.decision.chosen ?? null, missed_by_primary: r.decision.missed_by_primary,
      tests: r.decision.tests.map((t) => ({ candidate: t.candidate, b: t.b, c: t.c, p: +t.p.toFixed(4), gain_per100: per100(t.gain), false_alarms_per100: r1(100 * t.fa), passes: t.passes })),
      second_opus_gain_per100: per100(r.decision.second_opus_gain),
      readers: Object.fromEntries(Object.entries(r.per_reader).map(([name, x]) => [name, {
        returned: x.returned, missing: x.missing, fabricated_quotes: x.fabricated_quotes,
        recall_serious: rate(x.recall.all.serious, x.recall.all.n), recall_detected: rate(x.recall.all.detected, x.recall.all.n),
        recall_by_class: Object.fromEntries(SEED_CLASSES.map((c) => [c, rate(x.recall[c].serious, x.recall[c].n)])),
        false_alarms_per100: per100(x.false_alarms_per100), confirmed_per100: per100(x.confirmed_per100), cost: x.cost,
      }])),
      agreement: r.agreement.map((a) => ({ pair: a.pair, what: a.what, alpha_serious: a.serious == null ? null : +a.serious.toFixed(2), alpha_ocr: a.ocr == null ? null : +a.ocr.toFixed(2), alpha_tr: a.tr == null ? null : +a.tr.toFixed(2) })),
      adjudicators: r.adjudicators_measured, shared_miss: { ...r.shared_miss, ci95: r.shared_miss.ci95 ? r.shared_miss.ci95.map((v) => r1(100 * v)) : null },
      upset: r.upset, hypotheses: r.hypotheses,
    };
  });
  // The PRIMARY decision, pooled over the scored scripts (preregistration, amended): per candidate, the summed b and
  // c, the one-sided sign test, the mean of the scripts' weighted gains (each script counts once), and every script
  // within the false-alarm margin. Final only when all three scripts are scored and complete.
  const cands = [...new Set(scripts.flatMap((s) => s.tests.map((t) => t.candidate)))];
  const pooledTests = cands.map((cand) => {
    const ts = scripts.map((s) => s.tests.find((t) => t.candidate === cand)).filter(Boolean);
    const b = ts.reduce((x, t) => x + t.b, 0), c = ts.reduce((x, t) => x + t.c, 0), p = signTestOneSided(b, c);
    const gains = ts.map((t) => t.gain_per100.est).filter((x) => x != null);
    const gain = gains.length ? r1(gains.reduce((x, y) => x + y, 0) / gains.length) : null;
    const faOk = scripts.every((s) => { const t = s.tests.find((x) => x.candidate === cand); const pr = Object.values(s.readers)[0]; return !t || t.false_alarms_per100 <= (pr.false_alarms_per100.est ?? 0) + 3; });
    return { candidate: cand, scripts: ts.length, b, c, p: +p.toFixed(4), gain_per100_mean: gain, false_alarms_within_margin: faOk, passes: p < 0.025 && gain != null && gain >= 3 && faOk };
  });
  const final = scripts.length >= 3 && scripts.every((s) => s.complete);
  const winner = pooledTests.filter((t) => t.passes).sort((x, y) => y.gain_per100_mean - x.gain_per100_mean)[0];
  const pooled = { final, tests: pooledTests, verdict: !scripts.length ? 'not yet run' : `${final ? '' : 'PROVISIONAL (not all scripts scored): '}${winner ? `ADOPT ${winner.candidate} as a second reader` : 'NOT SHOWN: no candidate passes'}` };
  const data = {
    issue: 6338, schema: 2, pooled,
    measure: 'AI reviewers (Claude Opus, Gemini) reading page images; recall on planted errors; serious issues confirmed by blind adjudication and by eye',
    preregistration: 'scripts/eval/PREREGISTRATION-second-reader-6338.md',
    status: !scripts.length ? 'not yet run' : scripts.every((s) => s.complete) && scripts.length >= 3 ? 'complete' : 'in progress',
    scripts,
  };
  const text = JSON.stringify(data, null, 1) + '\n';
  if (flag('check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== text) { console.error(`${path.relative(REPO, OUT)} is stale or hand-edited: run \`second-reader.mjs export\``); process.exit(1); }
    console.log(`${path.relative(REPO, OUT)} matches the committed reports (${scripts.length} scripts)`);
  } else { write(OUT, data); console.log(`wrote ${OUT}: ${scripts.length} scripts, status ${data.status}`); }
}

// ── dataset: second-reader-v1, built from the committed run directories only ────────────────────────────────
else if (cmd === 'dataset') {
  const { CANARY_TEXT, assertCanary } = await import('../../lib/dataset-canary.mjs');
  const OUT = opt('out', path.join(REPO, 'scripts/eval/dataset/second-reader-v1'));
  const runs = scoredRuns();
  if (!runs.length) { console.error(`no scored run under ${RESULTS}: nothing to publish`); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const rows = { pages: [], reviews: [], clusters: [], adjudication: [] };
  for (const d of runs) {
    const draw = read(path.join(d, 'private', 'draw.json')), units = read(path.join(d, 'private', 'units.json'));
    const planted = new Map(read(path.join(d, 'private', 'key.json')).planted.map((s) => [s.key, s]));
    const pick = new Map(draw.picks.map((p) => [keyOf(p.book_id, p.page_number), p]));
    for (const f of fs.readdirSync(path.join(d, 'packets')).filter((x) => x.endsWith('.json')).sort()) for (const rec of read(path.join(d, 'packets', f))) {
      const k = keyOf(rec.book_id, rec.pages[0].page_number), u = units.find((x) => x.key === k), p = pick.get(k).record.pages[0];
      rows.pages.push({ canary: CANARY_TEXT, script: u.script, key: k, book_id: rec.book_id, page_number: rec.pages[0].page_number, stratum: u.stratum, weight: u.weight, block: u.block,
        image_url: p.image_url, image_sha256: p.image_sha256, ocr_model: p.ocr_model, translation_model: p.translation_model,
        shown_ocr: rec.pages[0].ocr, shown_translation: rec.pages[0].translation, planted: planted.get(k) ?? null });
    }
    for (const reader of fs.existsSync(path.join(d, 'readers')) ? fs.readdirSync(path.join(d, 'readers')).sort() : []) {
      const dir = path.join(d, 'readers', reader, 'reviews');
      const run = fs.existsSync(path.join(d, 'readers', reader, 'meta', 'run.json')) ? read(path.join(d, 'readers', reader, 'meta', 'run.json')) : {};
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) for (const b of (() => { try { return read(path.join(dir, f)); } catch { return []; } })())
        for (const pg of b.pages || []) rows.reviews.push({ canary: CANARY_TEXT, script: units[0].script, reader, engine: run.engine ?? null, model: run.model ?? null, key: keyOf(b.book_id, pg.page_number), review: pg });
    }
    for (const c of read(path.join(d, 'clusters.json')).clusters) rows.clusters.push({ canary: CANARY_TEXT, script: units[0].script, ...c });
    const ak = read(path.join(d, 'private', 'adjudication-key.json'));
    const eye = fs.existsSync(path.join(d, 'adjudication', 'by-eye.json')) ? read(path.join(d, 'adjudication', 'by-eye.json')) : { items: [] };
    const verdicts = {};
    for (const a of fs.readdirSync(path.join(d, 'adjudication')).filter((x) => fs.existsSync(path.join(d, 'adjudication', x, 'reviews'))))
      verdicts[a] = new Map(readArrays(path.join(d, 'adjudication', a, 'reviews')).map((v) => [v.item_id, v]));
    for (const it of ak.items) rows.adjudication.push({ canary: CANARY_TEXT, script: units[0].script, ...it,
      verdicts: Object.fromEntries(Object.entries(verdicts).map(([a, m]) => [a, m.get(it.item_id) ?? null])), by_eye: (eye.items || []).find((e) => e.item_id === it.item_id) ?? null });
    fs.copyFileSync(path.join(d, 'report.json'), path.join(OUT, `report-${units[0].script}.json`));
  }
  for (const [name, list] of Object.entries(rows)) fs.writeFileSync(path.join(OUT, `${name}.jsonl`), list.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'CANARY.txt'), CANARY_TEXT + '\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Second-reader calibration (#6338), dataset v1\n\n${CANARY_TEXT}\n\n` +
    `AI reviewers (Claude Opus, Gemini) read the same pages of a digital library of historical sources, some with a planted error; ` +
    `findings were matched across readers and adjudicated blind. Method and decision rule: \`scripts/eval/PREREGISTRATION-second-reader-6338.md\`. ` +
    `Built by \`scripts/eval/second-reader/second-reader.mjs dataset\` from the committed run directories only.\n\n` +
    `| file | one row per |\n|---|---|\n| pages.jsonl | page read: the text as shown (with the planted error, if any), the planted-error key, the draw weight, the image URL and sha256 |\n` +
    `| reviews.jsonl | reader × page: the reader's page object as returned |\n| clusters.jsonl | issue after matching across readers |\n` +
    `| adjudication.jsonl | adjudication item: its kind (cluster, planted true, planted false), each adjudicator's verdict and the by-eye verdict |\n| report-<script>.json | the scored report |\n\n` +
    `Licences: see LICENSES.md. Integrity: checksums.txt.\n`);
  fs.writeFileSync(path.join(OUT, 'LICENSES.md'), '# Licences\n\nTranscriptions, translations, reviews and adjudications made by Source Library: CC BY-SA 4.0. ' +
    'Page images are not included: each row gives the URL and the sha256 of the bytes the readers saw; the images keep the terms of their holding library.\n');
  const files = fs.readdirSync(OUT).filter((f) => f !== 'checksums.txt').sort();
  fs.writeFileSync(path.join(OUT, 'checksums.txt'), files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex')}  ${f}`).join('\n') + '\n');
  assertCanary(OUT);
  console.log(`wrote ${OUT}: ${Object.entries(rows).map(([k, v]) => `${v.length} ${k}`).join(', ')}`);
}

else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
function readArrays(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((x) => x.endsWith('.json')).flatMap((f) => { try { const a = read(path.join(dir, f)); return Array.isArray(a) ? a : []; } catch { return []; } });
}

function taxonomyNames() {
  const out = {};
  try {
    for (const m of fs.readFileSync(path.join(REPO, '.claude/docs/page-error-taxonomy.md'), 'utf8').matchAll(/^### ([IOTDE]\d{1,2}) · (.+?)(?: — .*)?$/gm)) out[m[1]] = m[2].trim();
  } catch { /* taxonomy absent: claims go without a name */ }
  return out;
}

function markdown(r) {
  const L = [];
  L.push(`# Second-reader calibration${r.interim ? ' — interim (block 1)' : ''} (#6338)`, '');
  if (r.incomplete) L.push(`**INCOMPLETE:** ${r.incomplete.by_eye_needed.length} adjudication items still need a by-eye verdict (listed in report.json). Numbers below treat them as not confirmed.`, '');
  L.push(`${r.n_units} pages (one per book): ${r.n_natural} natural pages scored for yield, ${r.n_planted} with a planted error scored for recall.`, '');
  L.push(`**Decision (${r.decision.stage}):** ${r.decision.verdict}`, '');
  for (const t of r.decision.tests) {
    L.push(`- **${t.candidate}**: of the confirmed serious issues the primary missed, ${t.b} found by ${t.candidate} and not the control, ${t.c} by the control and not ${t.candidate} (one-sided sign test p = ${t.p.toFixed(3)}; rule < 0.025). ` +
      `Gain over the control: ${t.gain.est == null ? '—' : (100 * t.gain.est).toFixed(1)} per 100 pages ${ci(t.gain.ci95)} (weighted, 95% by book; rule ≥ 3). False alarms ${(100 * t.fa).toFixed(1)} per 100 (rule ≤ primary + 3). ${t.passes ? '**Passes.**' : 'Does not pass.'}`);
  }
  if (r.decision.second_opus_gain) L.push(`- What the control (a second ${r.readers[1]} read) adds to the primary: ${r.decision.second_opus_gain.est == null ? '—' : (100 * r.decision.second_opus_gain.est).toFixed(1)} per 100 pages ${ci(r.decision.second_opus_gain.ci95)}.`);
  L.push('');
  L.push('| reader | pages returned | missing (of which unread) | fabricated quotes | recall, planted (detected / serious) | omission rule on natural pages | serious raised | false alarms (not real) / settled | severity inflation (real, not serious) | confirmed per 100 pages | marker filled |');
  L.push('|---|---:|---:|---:|---|---:|---:|---:|---:|---|---:|');
  for (const [name, x] of Object.entries(r.per_reader)) {
    const a = x.recall.all;
    L.push(`| ${name} | ${x.returned} | ${x.missing} (${x.unread}) | ${x.fabricated_quotes} | ${a.detected}/${a.n} (${pct(a.n ? a.detected / a.n : null)}) / ${a.serious}/${a.n} ${ci(wilson(a.serious, a.n))} | ${x.omission_background[0]}/${x.omission_background[1]} | ${x.serious_raised} | ${x.false_alarms}/${x.serious_settled} | ${x.severity_inflation} | ${x.confirmed_per100.est == null ? '—' : (100 * x.confirmed_per100.est).toFixed(1)} ${ci(x.confirmed_per100.ci95)} | ${x.printed_marker_filled} |`);
  }
  L.push('', '**Recall by planted class (serious / n):** ' + Object.entries(r.per_reader).map(([n, x]) => `${n}: ` + SEED_CLASSES.map((c) => `${c} ${x.recall[c].serious}/${x.recall[c].n}`).join(', ')).join(' · '), '');
  L.push('| pair | what | α serious (nominal) | α OCR score (ordinal) | α English score (ordinal) |', '|---|---|---:|---:|---:|');
  for (const a of r.agreement) L.push(`| ${a.pair} | ${a.what} | ${f2(a.serious)} | ${f2(a.ocr)} | ${f2(a.tr)} |`);
  L.push('', '**Adjudicators measured:** ' + Object.entries(r.adjudicators_measured).map(([a, s]) => `${a}: planted-true confirmed ${s.decoy_true[0]}/${s.decoy_true[1]}, planted-false rejected ${s.decoy_false[0]}/${s.decoy_false[1]}, agrees with by-eye ${s.vs_eye[0]}/${s.vs_eye[1]}`).join(' · '));
  L.push(`**Shared misses:** of ${r.shared_miss.pages_read} pages no reader called serious, read by eye, ${r.shared_miss.serious_found} carried a serious error ${ci(r.shared_miss.ci95)}.`);
  L.push(`**How clusters were settled:** ${JSON.stringify(r.settled_by)}.`);
  L.push(`**Confirmed serious issues by the readers that raised them:** ${Object.entries(r.upset).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}.`);
  L.push(`**Cost per confirmed serious issue found:** ${Object.entries(r.per_reader).map(([n, x]) => `${n} ${x.cost.usd_per_confirmed == null ? '—' : '$' + x.cost.usd_per_confirmed} (${x.cost.confirmed_found} found, ${Math.round(x.cost.seconds / 60)} min)`).join(' · ')}.`);
  for (const [c, h] of Object.entries(r.hypotheses)) {
    L.push(`**H2 (${c}):** lanes of confirmed finds only ${c} made ${JSON.stringify(h.h2_unique_to_candidate)}; only the primary made ${JSON.stringify(h.h2_unique_to_primary)}. ` +
      `**H3:** recall on planted translation errors ${Object.entries(h.h3_translation_recall).map(([n, v]) => `${n} ${v.serious}/${v.n}`).join(', ')}; English score ${c} − primary ${h.h3_en_score_minus_primary.est == null ? '—' : h.h3_en_score_minus_primary.est.toFixed(2)} ${ci(h.h3_en_score_minus_primary.ci95, 1)}.`);
  }
  L.push('');
  return L.join('\n') + '\n';
}
