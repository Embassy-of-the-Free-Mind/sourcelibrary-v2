// PRIOR ART: scripts/eval/estimator/ocr/route-census-emit.mjs — the same three parts (did-not-read cells, accuracy on
// the references, superseded reads) keyed on the engine name only. This is its provenance twin: the same cell rules,
// with the route keyed engine x prompt x read mode (provenance.mjs routeKey), and a report of which engine-only cells
// pooled reads made under different prompts (#6740). Split out so the committed engine-only rows stay byte-identical.
/**
 * emit-prov — route-census.mjs --stage=emit-prov. Reads DIR/{books.jsonl, refs-scored.jsonl, revisions-prov.json}
 * written by a census run whose books / refs stages record provenance, and writes DIR/out-prov/:
 *
 *   failures-prov.jsonl   failures.jsonl's did-not-read rows, one per engine-only cell x route key; every row carries
 *                         `provenance` (estimator-provenance/1, instrument: mechanical) and `legacy_cell`, the
 *                         failures.jsonl cell it was pooled into before.
 *   ocr-table-prov.jsonl  ocr-table.jsonl's accuracy rows, one per reference page x route key (the first stored read
 *                         under that key), with the read's own provenance (instrument: reference-scorer).
 *   reads-prov.jsonl      pages per field x engine x route key, live and superseded: the prompt mix of each route.
 *   splits.json.gz        the report: routes that split, engine-only cells that mixed prompts, legacy share per cell.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { provenanceFromRaw, mergeProvenance, routeKey, promptRecorded, validateRow, NOT_RECORDED, NA } from '../provenance.mjs';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const INPUT_GUARD = /leaf-unmarked|illegible|source|unmarked|no-ocr|empty-source/i;
const TEXT_NOT_ENGINE = /corpus|cbeta|sefaria|xml-p5|etcsl|oraec|esukhia|wikisource|gutenberg|perseus|kanripo/i;
const MECHANICAL = { class: 'mechanical', model: NA, prompt_hash: NA };
const SCORER = { class: 'reference-scorer', model: 'scorePage@en-ocr-reference-5124', prompt_hash: NA };
const COUNT_ONLY = { class: 'none', model: NA, prompt_hash: NA };
/** A key's share of a cell must reach this for the cell to count as MATERIALLY mixed (any mix is listed too). */
const MATERIAL = 0.05;

/** One census group's provenance block, weighted by its pages. */
function blockOf(prov, field, n) {
  const { jobs, codes, sent_distinct, ...raw } = prov ?? {};
  const b = provenanceFromRaw(raw, field, { jobs: Object.entries(jobs ?? {}), codes: Object.entries(codes ?? {}) });
  if (b.sent_hash !== NA) b.sent_hash = sent_distinct > 0 ? `recorded:${sent_distinct}-distinct` : NOT_RECORDED;
  b._pages = n;
  return b;
}
/** Merge the sent-hash tallies by summing distinct counts (the census keeps counts, not the hashes). */
function mergeCell(blocks) {
  const sent = blocks.reduce((a, b) => a + (+(String(b.sent_hash).match(/^recorded:(\d+)/)?.[1] ?? 0)), 0);
  const allNa = blocks.every((b) => b.sent_hash === NA);
  const m = mergeProvenance(blocks);
  m.sent_hash = allNa ? NA : sent > 0 ? `recorded:${sent}-distinct` : NOT_RECORDED;
  return m;
}
/** failures.jsonl's cell identity (its row writes script ?? 'unknown'). */
const cellId = (m) => JSON.stringify([m.stage, m.route, m.chart, m.script ?? 'unknown', m.language, m.era, m.kind]);
const share = (a, b) => (b ? +(a / b).toFixed(4) : null);

export async function emitProv({ OUT, helpers }) {
  const { chartOf, routeName, NOT_MODEL, GEMINI } = helpers;
  const F = (...p) => path.join(OUT, ...p);
  fs.mkdirSync(F('out-prov'), { recursive: true });
  const books = readJsonl(F('books.jsonl'));
  if (books.length && !books.some((b) => b.ocr.some((g) => g.length >= 8))) throw new Error('books.jsonl has no provenance element: rerun --stage=books with this census');
  const kindOf = (b) => (b.book_class === 'handwritten' ? 'manuscript' : b.book_class === 'printed' ? 'print' : 'unknown');

  // ------------------------------------------------ part 1: did not read, per route key
  const cells = new Map();                 // legacy cell + route key -> counts + blocks
  const legacy = new Map();                // legacy cell -> { n, keys: Map(routeKey -> n), unrecorded }
  const routes = new Map();                // field|engine -> Map(routeKey -> {live, superseded, recorded})
  const addRoute = (field, engine, key, n, recorded, part) => {
    const rk = `${field}|${engine}`;
    if (!routes.has(rk)) routes.set(rk, new Map());
    const m = routes.get(rk);
    if (!m.has(key)) m.set(key, { live: 0, superseded: 0, recorded, blocks: [] });
    m.get(key)[part] += n;
    return m.get(key);
  };
  const add = (meta, field, f, n, bookId, block) => {
    const lk = JSON.stringify(meta);
    const key = routeKey(block);
    const ck = `${lk}\u0000${key}`;
    if (!cells.has(ck)) cells.set(ck, { meta, key, n: 0, k_refused: 0, k_failed: 0, k_empty: 0, k_guard: 0, read_after_refusal: 0, read_after_failure: 0,
      books: new Set(), kbooks: new Set(), blocks: [] });
    const c = cells.get(ck);
    c.books.add(bookId); c.blocks.push(block);
    for (const [k, v] of Object.entries(f)) c[k] += v * n;
    if (f.k_refused || f.k_failed || f.k_guard) c.kbooks.add(bookId);
    if (!legacy.has(lk)) legacy.set(lk, { meta, n: 0, keys: new Map(), unrecorded: 0 });
    const L = legacy.get(lk);
    L.n += n; L.keys.set(key, (L.keys.get(key) ?? 0) + n);
    if (!promptRecorded(block)) L.unrecorded += n;
    const r = addRoute(field, meta.route, key, n, promptRecorded(block), 'live');
    if (r.blocks.length < 2000) r.blocks.push(block);
  };
  for (const b of books) {
    const kind = kindOf(b);
    const script = b.script_family ?? b.script;
    const chart = chartOf(b.language, b.script, kind);
    for (const [m0, s, , , st, rm, n, prov] of b.ocr) {
      if (st === 'none' || st === 'unreadable' || NOT_MODEL.test(s ?? '')) continue;
      const stampModel = (st === 'refused' || st === 'failed') && rm ? rm : m0;
      const route = routeName(stampModel);
      if (!route || TEXT_NOT_ENGINE.test(route)) continue;
      // A refusal stamped by another model than the one whose text is stored: the stored text's provenance is not the
      // refusing call's, so the attempt counts with its prompt NOT RECORDED rather than borrowing the reader's.
      const block = stampModel !== m0 ? provenanceFromRaw({ model: stampModel }, 'ocr') : blockOf(prov, 'ocr', n);
      block._pages = n;
      const f = { n: 1 };
      if (st === 'refused') f.k_refused = 1; else if (st === 'failed') f.k_failed = 1; else if (st === 'empty') f.k_empty = 1;
      else if (st === 'read_after_refusal') f.read_after_refusal = 1; else if (st === 'read_after_failure') f.read_after_failure = 1;
      add({ stage: 'ocr', route, chart, script, language: b.language ?? 'unknown', era: b.era, kind }, 'ocr', f, n, b.id, block);
    }
    for (const [m, s, , st, hb, n, prov] of b.tr) {
      if (st === 'none') continue;
      if (st === 'guard_refused' && INPUT_GUARD.test(hb ?? '')) continue;
      if (NOT_MODEL.test(s ?? '') && st === 'read') continue;
      const route = routeName(m) ?? 'not recorded';
      const block = blockOf(prov, 'translation', n);
      const f = { n: 1 };
      if (st === 'refused' || st === 'safety_blocked') f.k_refused = 1; else if (st === 'failed' || st === 'quarantined') f.k_failed = 1;
      else if (st === 'guard_refused') f.k_guard = 1; else if (st === 'empty') f.k_empty = 1;
      add({ stage: 'translation', route, chart, script, language: b.language ?? 'unknown', era: b.era, kind }, 'translation', f, n, b.id, block);
    }
  }
  // The stamped-route rule of route-census-emit.mjs, at the ENGINE level: a writer that never stamps a failure gets
  // no did-not-read row under any prompt.
  const stamped = new Map();
  for (const c of cells.values()) { const k = `${c.meta.stage}|${c.meta.route}`;
    stamped.set(k, (stamped.get(k) ?? 0) + c.k_refused + c.k_failed + c.k_guard + c.read_after_failure + (GEMINI.test(c.meta.route) ? c.read_after_refusal : 0)); }
  const failures = [];
  for (const c of cells.values()) {
    if (!stamped.get(`${c.meta.stage}|${c.meta.route}`) || c.n < 20) continue;
    const k = c.k_refused + c.k_failed + c.k_guard;
    const provenance = { ...mergeCell(c.blocks), instrument: MECHANICAL };
    // the failures.jsonl cell this row was pooled into is (stage, raw_route, chart, script, language, era, kind)
    const row = { rate: c.meta.stage === 'ocr' ? 'failed_read' : 'translation_failed_read', ...c.meta, route: `${c.meta.route} [${c.key}] (production, live)`, raw_route: c.meta.route,
      route_key: c.key, prompt_recorded: promptRecorded(provenance), script: c.meta.script ?? 'unknown', judge: 'mechanical',
      k, n: c.n, unit: 'pages', books: c.books.size, k_books: c.kbooks.size, one_page_per_book: false,
      k_refused: c.k_refused, k_failed: c.k_failed, k_guard: c.k_guard, k_empty: c.k_empty, read_after_refusal: c.read_after_refusal, read_after_failure: c.read_after_failure,
      k_ever_refused: c.k_refused + c.read_after_refusal, source: 'route census 6740 (production, with provenance)',
      file: 'route-census.mjs --stage=books,emit-prov (live pages); run DIR named in the write-up',
      quote: `${k} of ${c.n} live pages under ${c.meta.route} with ${c.key} left refused/failed`,
      note: 'production assignment, not random. The route key is engine x prompt id@version x read mode; job, code and CLI versions are covariates in provenance.',
      provenance };
    validateRow(row, `failures-prov ${c.key}`);
    failures.push(row);
  }
  failures.sort((a, b) => b.n - a.n);

  // ------------------------------------------------ superseded reads (page_revisions)
  const revs = fs.existsSync(F('revisions-prov.json')) ? JSON.parse(fs.readFileSync(F('revisions-prov.json'), 'utf8')) : [];
  for (const r of revs) {
    if (NOT_MODEL.test(r.raw?.src ?? '') || /guard-refused|health-gate-refused/.test(r.raw?.src ?? '')) continue;
    const engine = routeName(r.raw?.model);
    if (!engine || TEXT_NOT_ENGINE.test(engine)) continue;
    const b = provenanceFromRaw(r.raw, r.field, { jobs: Object.entries(r.jobs ?? {}), codes: Object.entries(r.codes ?? {}) });
    b._pages = r.n;
    const x = addRoute(r.field, engine, routeKey(b), r.n, promptRecorded(b), 'superseded');
    if (x.blocks.length < 2000) x.blocks.push(b);
  }
  const reads = [];
  for (const [rk, keys] of routes) {
    const [field, engine] = rk.split('|');
    for (const [key, v] of keys) {
      const provenance = { ...mergeCell(v.blocks), instrument: COUNT_ONLY };
      const row = { field, engine, route_key: key, prompt_recorded: v.recorded, pages_live: v.live, pages_superseded: v.superseded, provenance };
      validateRow(row, `reads-prov ${key}`);
      reads.push(row);
    }
  }
  reads.sort((a, b) => (b.pages_live + b.pages_superseded) - (a.pages_live + a.pages_superseded));

  // ------------------------------------------------ part 2: accuracy on the references, per route key
  const refs = readJsonl(F('refs-scored.jsonl'));
  const bookById = new Map(books.map((b) => [b.id, b]));
  const table = [];
  const accCells = new Map();               // chart|engine -> Map(routeKey -> pages)
  for (const r of refs) {
    if (!r.versions?.length) continue;
    if (/^S[1-4]$/.test(r.stratum)) { r.substratum = r.stratum; r.stratum = 'english-ia-5124'; }
    const b = bookById.get(r.book_id) ?? {};
    const kind = r.kind === 'manuscript' || b.book_class === 'handwritten' ? 'manuscript' : 'print';
    const chart = r.stratum === 'volunteer-correction' ? 'volunteer' : chartOf(r.language, b.script, kind);
    const seen = new Set();
    for (const v of r.versions) {
      const eng = routeName(v.model);
      if (!eng || NOT_MODEL.test(v.source ?? '') || v.model === 'human' || TEXT_NOT_ENGINE.test(eng)) continue;
      if (!v.provenance?.raw) throw new Error(`refs-scored ${r.slug}: a version without its raw provenance — rerun --stage=refs with this census`);
      const prov = provenanceFromRaw(v.provenance.raw, 'ocr', v.provenance.cov);
      const key = routeKey(prov);
      if (seen.has(key)) continue;          // the first stored read under this route key
      seen.add(key);
      const scored = v.cer != null;
      if (!scored && !(v.empty && r.recitation)) continue;
      const ak = `${chart}|${eng}`;
      if (!accCells.has(ak)) accCells.set(ak, new Map());
      accCells.get(ak).set(key, (accCells.get(ak).get(key) ?? 0) + 1);
      const row = { chart, panel: `production:${r.stratum}`, page: `${r.stratum}|${r.slug}`, work: `book:${r.book_id}`, engine: eng, route_key: key,
        prompt_recorded: promptRecorded(prov), kind, year: r.year ?? null, era: helpers.era(r.year ?? null),
        cer: scored ? Math.min(1, v.cer) : null, scored, failure: scored ? null : 'did_not_read', n_ref: scored ? Math.max(20, v.ref_chars) : 20,
        fame_web: r.fame_web, stratum: r.substratum ?? r.stratum, stored_version: v.version, stored_source: v.source ?? null, language: r.language ?? null,
        ref_kind: r.ref_kind ?? null, ref_source: r.ref_source, anchored: r.anchored ? 1 : 0, lower_bound: r.stratum === 'volunteer-correction' ? 1 : 0,
        source: 'route-census-6740-prov', provenance: { ...prov, instrument: SCORER } };
      validateRow(row, `ocr-table-prov ${r.slug}`);
      table.push(row);
    }
  }

  // ------------------------------------------------ the report
  const mixOf = (keys) => {
    const tot = [...keys.values()].reduce((a, x) => a + x, 0);
    const rec = [...keys].filter(([k]) => !/not_recorded|@label:/.test(k.split(' | ').slice(1).join(' | ')));
    const recTot = rec.reduce((a, [, x]) => a + x, 0);
    const material = rec.filter(([, x]) => recTot && x / recTot >= MATERIAL);
    // the same count with the top-level prompt_version LABELS taken at their word (pages with no engine block): a
    // label is not a record of what was sent (write-provenance.mjs rule 2), so this is the looser reading
    const lab = [...keys].filter(([k]) => !/ \| not_recorded@not_recorded \| /.test(` | ${k.split(' | ').slice(1).join(' | ')} | `) && !/^not_recorded@not_recorded$/.test(k.split(' | ')[1]));
    const labTot = lab.reduce((a, [, x]) => a + x, 0);
    const labMaterial = lab.filter(([, x]) => labTot && x / labTot >= MATERIAL);
    return { tot, rec, recTot, material, lab, labMaterial };
  };
  const routeSplits = [...routes].map(([rk, keys]) => {
    const [field, engine] = rk.split('|');
    const m = new Map([...keys].map(([k, v]) => [k, v.live + v.superseded]));
    const { tot, rec, recTot, material, lab, labMaterial } = mixOf(m);
    return { field, engine, pages: tot, keys_recorded: rec.length, keys_material: material.length, keys_with_labels: lab.length, keys_with_labels_material: labMaterial.length,
      unrecorded_share: share(tot - recTot, tot),
      keys: [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ key: k, pages: n, live: keys.get(k).live, superseded: keys.get(k).superseded })) };
  }).filter((r) => r.pages >= 20).sort((a, b) => b.pages - a.pages);
  const cellMix = [...legacy.values()].map((L) => {
    const { tot, rec, recTot, material, lab, labMaterial } = mixOf(L.keys);
    return { legacy_cell: L.meta, pages: tot, keys: L.keys.size, keys_recorded: rec.length, keys_material: material.length,
      keys_with_labels: lab.length, keys_with_labels_material: labMaterial.length,
      legacy_share: share(L.unrecorded, tot), recorded_pages: recTot,
      mix: [...L.keys].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => [k, n]) };
  }).filter((c) => c.pages >= 20);
  const legacyCells = new Set(readJsonl(path.join(path.dirname(new URL(import.meta.url).pathname), 'results/route-census-6740/failures.jsonl'))
    .filter((r) => /\(production, live\)$/.test(r.route))
    .map((r) => cellId({ ...r, route: r.raw_route })));
  const inFailures = (c) => legacyCells.has(cellId(c.legacy_cell));
  const pooled = cellMix.filter(inFailures);
  const accMix = [...accCells].map(([k, keys]) => { const { tot, rec, material } = mixOf(keys);
    return { cell: k, pages: tot, keys: keys.size, keys_recorded: rec.length, keys_material: material.length, mix: [...keys].sort((a, b) => b[1] - a[1]) }; });
  const splits = {
    generated: new Date().toISOString(),
    material_threshold: MATERIAL,
    definitions: {
      route_key: 'engine | prompt_id@prompt_version | read_mode (provenance.mjs routeKey)',
      recorded: 'prompt_version and read_mode both recorded; label:<v> is a top-level prompt_version label with no engine block, counted as NOT recorded',
      split: 'a route (field x engine) or a pooled cell whose recorded pages fall under more than one route key',
      material: `a key holding >= ${MATERIAL * 100}% of the recorded pages`,
      legacy_share: 'pages with the prompt not recorded / pages in the cell',
    },
    routes: { total: routeSplits.length, split_any: routeSplits.filter((r) => r.keys_recorded > 1).length,
      split_material: routeSplits.filter((r) => r.keys_material > 1).length,
      split_any_with_labels: routeSplits.filter((r) => r.keys_with_labels > 1).length,
      split_material_with_labels: routeSplits.filter((r) => r.keys_with_labels_material > 1).length, rows: routeSplits },
    pooled_failure_cells: { total: pooled.length, mixed_any: pooled.filter((c) => c.keys_recorded > 1).length,
      mixed_material: pooled.filter((c) => c.keys_material > 1).length,
      mixed_any_with_labels: pooled.filter((c) => c.keys_with_labels > 1).length,
      mixed_material_with_labels: pooled.filter((c) => c.keys_with_labels_material > 1).length,
      fully_legacy: pooled.filter((c) => c.legacy_share === 1).length, partly_legacy: pooled.filter((c) => c.legacy_share > 0 && c.legacy_share < 1).length,
      rows: pooled.sort((a, b) => b.pages - a.pages) },
    all_cells_with_20_pages: { total: cellMix.length, mixed_any: cellMix.filter((c) => c.keys_recorded > 1).length, mixed_material: cellMix.filter((c) => c.keys_material > 1).length },
    accuracy_cells: { total: accMix.length, mixed_any: accMix.filter((c) => c.keys_recorded > 1).length, rows: accMix.sort((a, b) => b.pages - a.pages) },
    rows: { failures_prov: failures.length, failures_prov_prompt_recorded: failures.filter((r) => r.prompt_recorded).length, reads_prov: reads.length, ocr_table_prov: table.length },
  };
  const w = (f, rows) => fs.writeFileSync(F('out-prov', f), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  w('failures-prov.jsonl', failures);
  w('reads-prov.jsonl', reads);
  w('ocr-table-prov.jsonl', table);
  fs.writeFileSync(F('out-prov', 'splits.json.gz'), zlib.gzipSync(JSON.stringify(splits, null, 1)));
  console.log(JSON.stringify({ routes: { total: splits.routes.total, split_any: splits.routes.split_any, split_material: splits.routes.split_material },
    pooled_failure_cells: { ...splits.pooled_failure_cells, rows: undefined }, accuracy_cells: { ...splits.accuracy_cells, rows: undefined }, rows: splits.rows }, null, 1));
}
