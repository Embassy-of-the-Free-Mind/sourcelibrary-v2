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
 *
 * No network, no database. Everything under R/private/ is what the readers must never see; the run directory is
 * committed only after every read and adjudication is done.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import {
  keyOf, plantErrors, redactRecord, validateOutput, extractIssues, clusterIssues, caughtSeed, krippendorffAlpha,
  weightedMeanCI, wilson, yieldOn, blockOf, OMISSION_RE, OMISSION_CLASSES, SEED_CLASSES, recoverArray, auditTranscript,
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

if (!R && cmd !== 'help') { console.error('--run DIR required (see the header of this file)'); process.exit(2); }

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
  const all = { pages: new Map(), missing: [], extra: [], errors: [], fabricated: [] };
  for (const [packet, recs] of records) {
    const f = J('readers', name, 'reviews', `${packet}.json`);
    let out = null;
    try { out = read(f); } catch { /* missing or unparsable: every page of the packet is missing */ }
    const v = validateOutput(out, recs);
    for (const [k, p] of v.pages) all.pages.set(k, p);
    all.missing.push(...v.missing); all.extra.push(...v.extra); all.fabricated.push(...v.fabricated);
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
    for (const a of adjs) {
      const v = adj[a].get(it.item_id); if (!v) continue;
      if (it.type === 'decoy_true') { adjStats[a].decoy_true[1]++; if (conf(v)) adjStats[a].decoy_true[0]++; }
      if (it.type === 'decoy_false') { adjStats[a].decoy_false[1]++; if (v.real === 'no') adjStats[a].decoy_false[0]++; }
      if (e) { adjStats[a].vs_eye[1]++; if (conf(v) === conf(e)) adjStats[a].vs_eye[0]++; }
    }
    if (it.type === 'cluster') verdictOf.set(it.cluster, { confirmedSerious: final, by: e ? 'eye' : agree ? 'adjudicators' : 'unsettled' });
  }
  // Clusters every clustered reader called serious, on natural pages, not sampled for a check: taken as confirmed.
  const judged = new Set(ak.items.filter((x) => x.type === 'cluster').map((x) => x.cluster));
  const plantedKeys = new Set(units.filter((u) => u.planted).map((u) => u.key));
  for (const c of clusters) if (!judged.has(c.id) && !plantedKeys.has(c.key) && clusterReaders.every((r) => c.by[r] === 'serious')) verdictOf.set(c.id, { confirmedSerious: true, by: 'all_readers' });

  const byKey = new Map(); for (const c of clusters) { if (!byKey.has(c.key)) byKey.set(c.key, []); byKey.get(c.key).push(c); }
  const natural = units.filter((u) => !u.planted && (!interim || u.block === 1));
  const plantedUnits = units.filter((u) => u.planted && (!interim || u.block === 1));

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
    const falseAlarms = settled.filter((c) => !verdictOf.get(c.id).confirmedSerious).length;
    perReader[r] = {
      returned: units.filter((u) => R_[r].pages.has(u.key)).length, missing: R_[r].missing.length, fabricated_quotes: R_[r].fabricated.length, schema_errors: R_[r].errors.length,
      printed_marker_filled: [...R_[r].pages.values()].filter((p) => typeof p.printed_marker === 'string' && p.printed_marker.trim()).length,
      recall, omission_background: [omissionBackground, natural.length],
      serious_raised: mineSerious.length, serious_settled: settled.length, false_alarms: falseAlarms,
      false_alarms_per100: weightedMeanCI(natural.map((u) => (byKey.get(u.key) || []).filter((c) => c.by[r] === 'serious' && verdictOf.has(c.id) && !verdictOf.get(c.id).confirmedSerious).length), natural.map((u) => u.weight)),
      confirmed_per100: weightedMeanCI(natural.map((u) => yieldOn(byKey.get(u.key) || [], verdictOf, [r])), natural.map((u) => u.weight)),
    };
  }

  // The decision quantity: (primary ∪ candidate) − (primary ∪ control), confirmed serious issues per page.
  const gain = (cand, us) => weightedMeanCI(us.map((u) => yieldOn(byKey.get(u.key) || [], verdictOf, [P, cand]) - yieldOn(byKey.get(u.key) || [], verdictOf, [P, C])), us.map((u) => u.weight));
  const b1 = natural.filter((u) => u.block === 1), b2 = natural.filter((u) => u.block === 2);
  const b1Recall = (r) => { const us = plantedUnits.filter((u) => u.block === 1); let k = 0; for (const u of us) k += caughtSeed(plantedKey.find((x) => x.key === u.key), issues[r], R_[r].pages.get(u.key), texts.get(u.key).translation).serious; return us.length ? k / us.length : 0; };
  const choice = cands.map((c) => ({ c, recall: b1Recall(c), gain: gain(c, b1).est ?? 0, fa: perReader[c].false_alarms_per100.est ?? 0 }))
    .sort((a, b) => (Math.abs(a.recall - b.recall) > 0.05 ? b.recall - a.recall : Math.abs(a.gain - b.gain) > 0.01 ? b.gain - a.gain : a.fa - b.fa));
  const chosen = choice[0]?.c;
  let decision;
  if (interim) {
    const futile = cands.every((c) => { const g = gain(c, b1); return g.ci99 && g.ci99[1] * 100 < 5; });
    decision = { stage: 'interim (block 1)', verdict: futile ? 'STOP — futility: no candidate can reach +5 per 100 pages (99% interval)' : 'CONTINUE to block 2', gains: Object.fromEntries(cands.map((c) => [c, gain(c, b1)])) };
  } else {
    const g = gain(chosen, b2);
    const faC = perReader[chosen].false_alarms_per100.est, faP = perReader[P].false_alarms_per100.est;
    // False alarms: no more than FA_MARGIN per 100 pages above the primary's (preregistered; a false alarm costs a
    // minute of adjudication, a missed serious error misleads a reader).
    const FA_MARGIN = 0.03;
    const adopt = g.est != null && g.est * 100 >= 5 && g.ci95[0] > 0 && faC <= faP + FA_MARGIN;
    // If Gemini does not earn its place, does a second Opus read? yield(primary ∪ control) − yield(primary), block 2.
    const o2 = weightedMeanCI(b2.map((u) => yieldOn(byKey.get(u.key) || [], verdictOf, [P, C]) - yieldOn(byKey.get(u.key) || [], verdictOf, [P])), b2.map((u) => u.weight));
    const o2meets = o2.est != null && o2.est * 100 >= 5 && o2.ci95[0] > 0;
    decision = { stage: 'final (model chosen on block 1, reported on block 2)', chosen, choice, gain_block2: g, gain_all: gain(chosen, natural), fa_candidate: faC, fa_primary: faP,
      second_opus_gain_block2: o2,
      verdict: adopt ? `ADOPT ${chosen} as a second reader` : `DO NOT ADOPT ${chosen}${o2meets ? `; a second ${C} read meets the bar instead` : ''}` };
  }

  // Agreement on natural pages: Krippendorff's alpha (missing pages allowed).
  const alpha = (rs, field, level) => krippendorffAlpha(natural.map((u) => rs.map((r) => { const p = R_[r].pages.get(u.key); return field === 'serious' ? seriousFlag(p) : (p?.[field] ?? null); })), level);
  const pairs = [[P, C, 'within-family floor'], ...cands.map((c) => [P, c, 'cross-family']), ...Object.entries(retest).map(([a, b]) => [a, b, 'candidate retest floor'])];
  const agreement = pairs.map(([a, b, what]) => ({ pair: `${a}–${b}`, what, serious: alpha([a, b], 'serious', 'nominal'), ocr: alpha([a, b], 'ocr_score', 'ordinal'), tr: alpha([a, b], 'tr_score', 'ordinal') }));

  const cleanEye = eye.clean_pages || [];
  const report = {
    issue: 6338, interim, readers, adjudicators: adjs, n_units: units.length, n_natural: natural.length, n_planted: plantedUnits.length,
    incomplete: needEye.length ? { by_eye_needed: needEye } : null,
    decision, per_reader: perReader, agreement,
    adjudicators_measured: adjStats,
    shared_miss: { pages_read: cleanEye.length, serious_found: cleanEye.filter((x) => x.serious_found).length, ci95: wilson(cleanEye.filter((x) => x.serious_found).length, cleanEye.length) },
    settled_by: [...verdictOf.values()].reduce((o, v) => ({ ...o, [v.by]: (o[v.by] || 0) + 1 }), {}),
  };
  write(J(interim ? 'report-interim.json' : 'report.json'), report);
  fs.writeFileSync(J(interim ? 'report-interim.md' : 'report.md'), markdown(report));
  console.log(markdown(report));
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
  if (r.decision.gain_block2) {
    const g = r.decision.gain_block2;
    L.push(`- Gain of ${r.decision.chosen} over the control reader, block 2: **${g.est == null ? '—' : (100 * g.est).toFixed(1)} confirmed serious issues per 100 pages** ${ci(g.ci95)} (95%, by book, weighted to the frame; n = ${g.n}). Rule: ≥ 5 with the interval above 0.`);
    L.push(`- False alarms per 100 pages: ${r.decision.chosen} ${f2(r.decision.fa_candidate * 100)}, primary ${f2(r.decision.fa_primary * 100)}. Rule: candidate ≤ primary + 3.`);
    const o2 = r.decision.second_opus_gain_block2;
    L.push(`- For comparison, what the control reader adds to the primary, block 2: ${o2.est == null ? '—' : (100 * o2.est).toFixed(1)} per 100 pages ${ci(o2.ci95)}.`);
    L.push(`- Model choice on block 1: ${r.decision.choice.map((c) => `${c.c} (recall ${pct(c.recall)}, gain ${(100 * c.gain).toFixed(1)}, false alarms ${(100 * c.fa).toFixed(1)})`).join('; ')}.`, '');
  } else if (r.decision.gains) {
    for (const [c, g] of Object.entries(r.decision.gains)) L.push(`- ${c}: gain ${g.est == null ? '—' : (100 * g.est).toFixed(1)} per 100 pages, 99% ${ci(g.ci99)}`);
    L.push('');
  }
  L.push('| reader | pages returned | missing | fabricated quotes | recall, planted (detected / serious) | omission rule on natural pages | serious raised | false alarms / settled | confirmed per 100 pages | marker filled |');
  L.push('|---|---:|---:|---:|---|---:|---:|---:|---|---:|');
  for (const [name, x] of Object.entries(r.per_reader)) {
    const a = x.recall.all;
    L.push(`| ${name} | ${x.returned} | ${x.missing} | ${x.fabricated_quotes} | ${a.detected}/${a.n} (${pct(a.n ? a.detected / a.n : null)}) / ${a.serious}/${a.n} ${ci(wilson(a.serious, a.n))} | ${x.omission_background[0]}/${x.omission_background[1]} | ${x.serious_raised} | ${x.false_alarms}/${x.serious_settled} | ${x.confirmed_per100.est == null ? '—' : (100 * x.confirmed_per100.est).toFixed(1)} ${ci(x.confirmed_per100.ci95)} | ${x.printed_marker_filled} |`);
  }
  L.push('', '**Recall by planted class (serious / n):** ' + Object.entries(r.per_reader).map(([n, x]) => `${n}: ` + SEED_CLASSES.map((c) => `${c} ${x.recall[c].serious}/${x.recall[c].n}`).join(', ')).join(' · '), '');
  L.push('| pair | what | α serious (nominal) | α OCR score (ordinal) | α English score (ordinal) |', '|---|---|---:|---:|---:|');
  for (const a of r.agreement) L.push(`| ${a.pair} | ${a.what} | ${f2(a.serious)} | ${f2(a.ocr)} | ${f2(a.tr)} |`);
  L.push('', '**Adjudicators measured:** ' + Object.entries(r.adjudicators_measured).map(([a, s]) => `${a}: planted-true confirmed ${s.decoy_true[0]}/${s.decoy_true[1]}, planted-false rejected ${s.decoy_false[0]}/${s.decoy_false[1]}, agrees with by-eye ${s.vs_eye[0]}/${s.vs_eye[1]}`).join(' · '));
  L.push(`**Shared misses:** of ${r.shared_miss.pages_read} pages no reader called serious, read by eye, ${r.shared_miss.serious_found} carried a serious error ${ci(r.shared_miss.ci95)}.`);
  L.push(`**How clusters were settled:** ${JSON.stringify(r.settled_by)}.`, '');
  return L.join('\n') + '\n';
}
