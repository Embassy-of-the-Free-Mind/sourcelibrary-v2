// PRIOR ART: scripts/eval/estimator/ocr/build-ocr-table-v1.py (the accuracy columns written here) and
// failure-observations.jsonl (the k-of-n columns). This is route-census.mjs's emit stage, split out only for length; it
// reads the census files and writes rows in those two formats plus the correction and throughput tables (#6740).
/**
 * emit — route-census.mjs's last stage. Reads DIR/{books.jsonl, pairs-summary.json, change.jsonl, refs-scored.jsonl,
 * throughput/} and writes DIR/out/:
 *
 *   failures.jsonl     k-of-n rows, failure-observations.jsonl columns (rate, route, script, judge, k, n, unit, books,
 *                      source, file, quote, note) plus stage, language, era, kind, k_refused, k_failed, k_empty.
 *                      rate: failed_read (OCR did not read: refused / failed under the route's own stamp),
 *                      guard_refused (our blank / loop / health gate refused the route's output),
 *                      translation_failed_read (translation refused / blocked / failed / guard-refused).
 *   ocr-table.jsonl    build-ocr-table-v1 columns, one row per benchmark page x production engine (its first stored read)
 *   corrections.jsonl  draft engine x corrector x language x kind: pairs, books, change rate (sampled), and where a
 *                      reference exists, corrected better / same / worse
 *   throughput.jsonl   field x route x day: pages delivered, active hours
 *   coverage.json      cells with production rows but no experiment rows, and the reverse
 *   summary.json       the counts the write-up quotes
 */
import fs from 'node:fs';
import path from 'node:path';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const q = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
/** Output guards (the model wrote something bad) vs input refusals (our gate declined to send the page). */
const INPUT_GUARD = /leaf-unmarked|illegible|source|unmarked|no-ocr|empty-source/i;
/** A stored text whose `model` names a corpus or a public edition, not an engine (CBETA XML, ORAEC, Sefaria, ETCSL). */
const TEXT_NOT_ENGINE = /corpus|cbeta|sefaria|xml-p5|etcsl|oraec|esukhia|wikisource|gutenberg|perseus|kanripo/i;
/** Production model id -> the Pareto engine id, so coverage can be compared. */
const paretoKey = (m) => {
  const s = String(m ?? '').toLowerCase();
  if (/^paddleocr-vl-1\.6/.test(s)) return 'paddleocr-vl-1.6';
  if (s === 'ia-ocr' || /^ia-ocr\//.test(s)) return 'ia-djvu';
  return s;
};

export async function emit({ OUT, NOW, DAYS, helpers }) {
  const { chartOf, familyOf, routeName, READ_SOURCES, NOT_MODEL, GEMINI } = helpers;
  const F = (...p) => path.join(OUT, ...p);
  fs.mkdirSync(F('out'), { recursive: true });
  const books = readJsonl(F('books.jsonl'));
  const kindOf = (b) => (b.book_class === 'handwritten' ? 'manuscript' : b.book_class === 'printed' ? 'print' : 'unknown');
  const summary = { generated: new Date().toISOString(), books: books.length };

  // ------------------------------------------------ part 1: did not read (live state)
  const cells = new Map();
  const unattributed = new Map();
  const add = (key, meta, field, cnt, bookId) => {
    if (!cells.has(key)) cells.set(key, { ...meta, n: 0, k_refused: 0, k_failed: 0, k_empty: 0, k_guard: 0, read_after_refusal: 0, read_after_failure: 0, books: new Set(), kbooks: new Set() });
    const c = cells.get(key);
    c.books.add(bookId);
    for (const [f, v] of Object.entries(field)) c[f] += v * cnt;
    if (field.k_refused || field.k_failed || field.k_guard) c.kbooks.add(bookId);
  };
  let pagesSeen = 0;
  for (const b of books) {
    const kind = kindOf(b);
    const script = b.script_family ?? b.script;
    const chart = chartOf(b.language, b.script, kind);
    for (const [m0, s, , , st, rm, n] of b.ocr) {
      pagesSeen += n;
      if (st === 'none' || st === 'unreadable' || NOT_MODEL.test(s ?? '')) continue;
      const stampModel = (st === 'refused' || st === 'failed') && rm ? rm : m0;
      const route = routeName(stampModel);
      if (st === 'read_after_refusal' && !GEMINI.test(m0 ?? '')) {
        // RECITATION is a Gemini refusal: a non-Gemini engine read the page after an unrecorded Gemini route refused it.
        const k = `${b.language}|${b.era}`; unattributed.set(k, (unattributed.get(k) ?? 0) + n);
      }
      if (!route || TEXT_NOT_ENGINE.test(route)) continue;
      const meta = { stage: 'ocr', route, chart, script, language: b.language ?? 'unknown', era: b.era, kind };
      const key = JSON.stringify(meta);
      const f = { n: 1 };
      if (st === 'refused') f.k_refused = 1;
      else if (st === 'failed') f.k_failed = 1;
      else if (st === 'empty') f.k_empty = 1;
      else if (st === 'read_after_refusal') f.read_after_refusal = 1;
      else if (st === 'read_after_failure') f.read_after_failure = 1;
      add(key, meta, f, n, b.id);
    }
    for (const [m, s, , st, hb, n] of b.tr) {
      if (st === 'none') continue;
      if (st === 'guard_refused' && INPUT_GUARD.test(hb ?? '')) continue;      // our gate declined the input: not a read
      if (NOT_MODEL.test(s ?? '') && st === 'read') continue;
      const route = routeName(m) ?? 'not recorded';
      const meta = { stage: 'translation', route, chart, script, language: b.language ?? 'unknown', era: b.era, kind };
      const f = { n: 1 };
      if (st === 'refused' || st === 'safety_blocked') f.k_refused = 1;
      else if (st === 'failed' || st === 'quarantined') f.k_failed = 1;
      else if (st === 'guard_refused') f.k_guard = 1;
      else if (st === 'empty') f.k_empty = 1;
      add(JSON.stringify(meta), meta, f, n, b.id);
    }
  }
  // A route whose writer never stamps a refusal or failure on the page (cli-ocr and the specialist lanes write nothing
  // when a read fails; only the Gemini API writers, batch-collector and realtime-ocr, stamp) reads 0 of n here by
  // construction. The absence of the stamp is not the absence of the failure: such routes get no failed_read row.
  const stamped = new Map();
  for (const c of cells.values()) { const k = `${c.stage}|${c.route}`;
    stamped.set(k, (stamped.get(k) ?? 0) + c.k_refused + c.k_failed + c.k_guard + c.read_after_failure
      + (GEMINI.test(c.route) ? c.read_after_refusal : 0)); }   // a RECITATION stamp under a non-Gemini engine is Gemini's
  const unstamped = new Map();
  const failures = [];
  const FILE = 'route-census.mjs --stage=books (live pages); run DIR named in the write-up';
  for (const c of cells.values()) {
    const k = c.k_refused + c.k_failed + c.k_guard;
    if (!stamped.get(`${c.stage}|${c.route}`)) { const u = `${c.stage}|${c.route}`; unstamped.set(u, (unstamped.get(u) ?? 0) + c.n); continue; }
    if (c.n < 20) continue;
    failures.push({ rate: c.stage === 'ocr' ? 'failed_read' : 'translation_failed_read', route: `${c.route} (production, live)`, raw_route: c.route,
      stage: c.stage, chart: c.chart, script: c.script ?? 'unknown', language: c.language, era: c.era, kind: c.kind, judge: 'mechanical',
      k, n: c.n, unit: 'pages', books: c.books.size, k_books: c.kbooks.size, one_page_per_book: false,
      k_refused: c.k_refused, k_failed: c.k_failed, k_guard: c.k_guard, k_empty: c.k_empty, read_after_refusal: c.read_after_refusal, read_after_failure: c.read_after_failure,
      // refused at least once (refusal-census.mjs's measure): the stamp survives a later successful read. The refusing
      // attempt may have been another Gemini route's; the stamp does not name it.
      k_ever_refused: c.k_refused + c.read_after_refusal,
      source: 'route census 6740 (production)', file: FILE,
      quote: `${k} of ${c.n} live pages under ${c.route}'s own stamp left refused/failed (${c.k_refused} refused, ${c.k_failed} failed${c.k_guard ? `, ${c.k_guard} guard-refused` : ''}); ${c.k_empty} empty pages not counted`,
      note: 'production assignment: the router chose this route for this kind of page (not random). Empty stored fields (often blank leaves) are k_empty, not k.' });
  }
  // Guard refusals: page_revisions (a refused output was replaced). Denominator: distinct pages the route ever wrote.
  const pairs = fs.existsSync(F('pairs-summary.json')) ? JSON.parse(fs.readFileSync(F('pairs-summary.json'), 'utf8')) : { cells: [], guard: [], delivered_superseded: [] };
  const bmeta = new Map(books.map((b) => [b.language, b]));
  const gcell = new Map();
  for (const g of pairs.guard) {
    if (!g.model || g.model === 'none') continue;
    const b = bmeta.get(g.language) ?? {};
    const key = [g.field, g.model, g.language, g.era].join('|');
    if (!gcell.has(key)) gcell.set(key, { field: g.field, route: g.model, language: g.language, era: g.era, script: b.script_family ?? b.script ?? 'unknown', k: 0, n: 0, books: 0, kb: 0 });
    const c = gcell.get(key); c.k += g.guard_refused_pages; c.n += g.guard_refused_pages + g.pages_written; c.books += g.books; c.kb += g.refused_books;
  }
  for (const c of gcell.values()) {
    if (c.k === 0 || c.n < 20) continue;
    failures.push({ rate: c.field === 'ocr' ? 'guard_refused' : 'translation_guard_refused', route: `${c.route} (production, page_revisions)`, raw_route: c.route,
      stage: c.field, script: c.script, language: c.language, era: c.era, kind: 'all', judge: 'mechanical', k: c.k, n: c.n, unit: 'pages',
      books: c.books, k_books: c.kb, one_page_per_book: false, source: 'route census 6740 (production)', file: 'route-census.mjs --stage=pairs (page_revisions)',
      quote: `${c.k} of ${c.n} pages that have a page_revisions history: ${c.route}'s output refused by a blank / loop / health gate and replaced`,
      note: 'denominator is pages WITH a revision history only (pages never rewritten are not in page_revisions), so this overstates the rate; books summed over kinds may double count' });
  }
  fs.writeFileSync(F('out', 'failures.jsonl'), failures.map((r) => JSON.stringify(r)).join('\n') + '\n');
  summary.part1 = { rows: failures.length, ocr_rows: failures.filter((r) => r.rate === 'failed_read').length,
    translation_rows: failures.filter((r) => r.rate === 'translation_failed_read').length, guard_rows: failures.filter((r) => /guard/.test(r.rate)).length,
    pages_walked: pagesSeen, unstamped_routes: Object.fromEntries([...unstamped].sort((a, b) => b[1] - a[1])), unattributed_refusals: [...unattributed].sort((a, b) => b[1] - a[1]).slice(0, 15),
    unattributed_refusals_total: [...unattributed.values()].reduce((a, x) => a + x, 0) };

  // ------------------------------------------------ part 2: accuracy against free references
  const refs = readJsonl(F('refs-scored.jsonl'));
  const bookById = new Map(books.map((b) => [b.id, b]));
  const table = [];
  const refPairs = [];
  for (const r of refs) {
    if (!r.versions?.length) continue;
    // #5124's rows carry their own S1-S4 stratum; a first run of the refs stage wrote it over the file's name.
    if (/^S[1-4]$/.test(r.stratum)) { r.substratum = r.stratum; r.stratum = 'english-ia-5124'; }
    const dense = /^S[24]$/.test(r.substratum ?? '') ? 1 : 0;
    const b = bookById.get(r.book_id) ?? {};
    const seen = new Set();
    const kind = r.kind === 'manuscript' || b.book_class === 'handwritten' ? 'manuscript' : 'print';
    const chart = chartOf(r.language, b.script, kind);
    const scoredV = r.versions.filter((v) => v.cer != null);
    for (const v of r.versions) {
      const eng = routeName(v.model);
      if (!eng || NOT_MODEL.test(v.source ?? '') || v.model === 'human' || TEXT_NOT_ENGINE.test(eng)) continue;
      if (seen.has(eng)) continue;   // the engine's FIRST stored read only; later versions are sweeps or re-reads of it
      seen.add(eng);
      const scored = v.cer != null;
      if (!scored && !(v.empty && r.recitation)) continue;
      table.push({ chart: r.stratum === 'volunteer-correction' ? 'volunteer' : chart, panel: `production:${r.stratum}`,
        page: `${r.stratum}|${r.slug}`, work: `book:${r.book_id}`, engine: eng, engine_family: familyOf(eng), kind,
        period: r.year == null ? 'unknown' : `${Math.floor(r.year / 100) * 100}s`, year: r.year ?? null,
        cer: scored ? Math.min(1, v.cer) : null, scored, failure: scored ? null : 'did_not_read', n_ref: scored ? Math.max(20, v.ref_chars) : 20,
        n_ref_source: 'reference', era: helpers.era(r.year ?? null), fame_web: r.fame_web, dense, stratum: r.substratum ?? r.stratum, editions_held: null,
        num_ref: v.num_ref ?? null, num_sub: v.num_sub ?? null, num_drop: v.num_drop ?? null, num_ins: v.num_ins ?? null,
        source: 'route-census-6740', stored_version: v.version,
        // scorePage (en-ocr-reference-5124) on every chart. The Pareto's CJK and Greek strata were scored by
        // benchmark-score.mjs (variant folding, Greek letters only), so those rows are not on the Pareto's scale.
        scorer: 'scorePage@en-ocr-reference-5124', pareto_scale: /^(english|latin|latin-script-other|volunteer)$/.test(chart) || r.stratum === 'volunteer-correction' ? 1 : 0, stored_source: v.source ?? null, language: r.language ?? null,
        ref_kind: r.ref_kind ?? (/Perseus|First1K|el\.wikisource|Kanripo|CBETA/i.test(r.ref_source ?? '') ? 'edition-e-text' : null), ref_source: r.ref_source, anchored: r.anchored ? 1 : 0,
        // a modern edition of the work, not a transcription of this leaf (build-ocr-pareto.mjs STRATA `edition`)
        edition: /Perseus|First1K|el\.wikisource|Kanripo|CBETA/i.test(r.ref_source ?? '') || /same-edition/.test(r.ref_kind ?? '') ? 1 : 0,
        // Volunteer corrections fix only the spans the volunteer saw: CER against them is a LOWER BOUND on the draft's error.
        lower_bound: r.stratum === 'volunteer-correction' ? 1 : 0 });
    }
    // Draft -> corrector pairs on a referenced page (consecutive scored versions, different engine family or a correction)
    for (let i = 0; i + 1 < scoredV.length; i++) {
      const a = scoredV[i], c = scoredV[i + 1];
      if (TEXT_NOT_ENGINE.test(a.model ?? '') || TEXT_NOT_ENGINE.test(c.model ?? '')) continue;
      if (routeName(a.model) === routeName(c.model) && !/\bcorrect|\breview|adjudic/i.test(a.reason ?? '')) continue;
      refPairs.push({ slug: r.slug, stratum: r.stratum, language: r.language, kind: r.kind || 'unknown', draft: routeName(a.model), next: routeName(c.model), reason: a.reason ?? null,
        draft_cer: a.cer, next_cer: c.cer, verdict: c.cer < a.cer - 0.005 ? 'better' : c.cer > a.cer + 0.005 ? 'worse' : 'same', fame_web: r.fame_web });
    }
  }
  fs.writeFileSync(F('out', 'ocr-table.jsonl'), table.map((r) => JSON.stringify(r)).join('\n') + '\n');
  summary.part2 = { reference_pages: refs.length, pages_with_page: refs.filter((r) => !r.missing).length, rows: table.length,
    scored: table.filter((r) => r.scored).length, by_ref_kind: count(table, (r) => r.ref_kind), by_engine: count(table, (r) => r.engine),
    by_chart: count(table, (r) => r.chart), fame_web: count(table, (r) => String(r.fame_web)), anchored: count(table, (r) => String(r.anchored)) };

  // ------------------------------------------------ part 3: correction pairs
  const change = readJsonl(F('change.jsonl')).filter((r) => !r.missing);
  const byCell = new Map();
  for (const r of change) { if (!byCell.has(r.cell)) byCell.set(r.cell, []); byCell.get(r.cell).push(r); }
  const corrections = [];
  for (const c of pairs.cells) {
    if (!['model_correction', 'human_correction', 'reread', 'guard_refused'].includes(c.cls)) continue;
    if (c.pairs < 5 && c.cls !== 'human_correction') continue;
    const ck = [c.cls, c.field, c.draft, c.next, c.language, c.kind].join('|');
    const ch = byCell.get(ck) ?? [];
    const withRef = refPairs.filter((p) => p.draft === c.draft && p.next === c.next && p.language === c.language && p.kind === c.kind);
    corrections.push({ cls: c.cls, field: c.field, draft: c.draft, corrector: c.next, language: c.language, kind: c.kind, pairs: c.pairs, books: c.books,
      top_reasons: c.top_reasons,
      change_measure: 'change (scorePage of the draft against the text that replaced it): NOT accuracy',
      change_sampled: ch.length, change_books: new Set(ch.map((x) => x.book_id)).size,
      change_cer_median: median(ch.map((x) => x.change_cer)), change_cer_p90: q(ch.map((x) => x.change_cer), 0.9),
      // 'correct' when the writer was handed the draft (cli-ocr CORRECT MODE, opus_correct_6561, twopass-review);
      // 'fresh_read' when the later text is an independent read that merely replaced the draft (most reocr_cli rows).
      lane_mode: !ch.length ? null : ch.every((x) => x.mode === 'correct') ? 'correct' : ch.every((x) => x.mode !== 'correct') ? 'fresh_read' : 'mixed',
      mode_correct_share: ch.length ? +(ch.filter((x) => x.mode === 'correct').length / ch.length).toFixed(3) : null,
      share_identical: ch.length ? +(ch.filter((x) => x.identical).length / ch.length).toFixed(3) : null,
      share_changed_over_1pct: ch.length ? +(ch.filter((x) => (x.change_cer ?? 0) > 0.01).length / ch.length).toFixed(3) : null,
      numbers_changed_per_number: sum(ch, 'num_ref') ? +(sum(ch, 'num_changed') / sum(ch, 'num_ref')).toFixed(4) : null,
      with_reference: withRef.length, better: withRef.filter((p) => p.verdict === 'better').length, same: withRef.filter((p) => p.verdict === 'same').length,
      worse: withRef.filter((p) => p.verdict === 'worse').length });
  }
  corrections.sort((a, b) => b.pairs - a.pairs);
  fs.writeFileSync(F('out', 'corrections.jsonl'), corrections.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(F('out', 'reference-pairs.jsonl'), refPairs.map((r) => JSON.stringify(r)).join('\n') + (refPairs.length ? '\n' : ''));
  summary.part3 = { cells: corrections.length, by_class: count(corrections, (r) => r.cls, (r) => r.pairs), sampled: change.length,
    reference_pairs: refPairs.length, reference_verdicts: count(refPairs, (r) => r.verdict),
    pair_classes_all: count(pairs.cells, (r) => `${r.field}:${r.cls}`, (r) => r.pairs) };

  // ------------------------------------------------ part 4: throughput
  const tdir = F('throughput');
  const tp = new Map();
  for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir).filter((x) => x.endsWith('.json')) : []) {
    const [field, ...d] = f.replace(/\.json$/, '').split('-'); const day = d.join('-');
    for (const r of JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8'))) {
      if (!r.text) continue;
      const src = READ_SOURCES.has(r.s ?? '') ? r.s : NOT_MODEL.test(r.s ?? '') ? 'not-model' : 'sweep';
      const key = [field, routeName(r.m) ?? 'none', src, day].join('|');
      if (!tp.has(key)) tp.set(key, { n: 0, hours: new Set(), superseded: 0, call_sites: new Map() });
      const t = tp.get(key); t.n += r.n; t.hours.add(r.h); t.call_sites.set(r.cs ?? '', (t.call_sites.get(r.cs ?? '') ?? 0) + r.n);
    }
  }
  for (const d of pairs.delivered_superseded) {
    const key = [d.field, d.route, d.source, d.day].join('|');
    if (!tp.has(key)) tp.set(key, { n: 0, hours: new Set(), superseded: 0, call_sites: new Map() });
    tp.get(key).superseded += d.n;
  }
  const from = new Date(+NOW - DAYS * 864e5).toISOString().slice(0, 10);
  const tpRows = [...tp].map(([k, v]) => { const [field, route, source, day] = k.split('|');
    return { field, route, source, day, pages_live: v.n, pages_superseded: v.superseded, pages: v.n + v.superseded, active_hours: v.hours.size,
      pages_per_active_hour: v.hours.size ? Math.round(v.n / v.hours.size) : null,
      call_sites: [...v.call_sites].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c || '(none)'}:${n}`) }; })
    .filter((r) => r.day >= from && r.day < NOW.toISOString().slice(0, 10)).sort((a, b) => (a.field + a.route + a.day).localeCompare(b.field + b.route + b.day));
  fs.writeFileSync(F('out', 'throughput.jsonl'), tpRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const routes = new Map();
  for (const r of tpRows) { const k = [r.field, r.route, r.source].join('|'); if (!routes.has(k)) routes.set(k, []); routes.get(k).push(r); }
  const nd = DAYS;
  const capacity = [...routes].map(([k, rows]) => { const [field, route, source] = k.split('|');
    const per = rows.map((r) => r.pages); const all = [...per, ...Array(Math.max(0, nd - per.length)).fill(0)];
    return { field, route, source, days_active: rows.length, pages_total: per.reduce((a, x) => a + x, 0), pages_per_day_median_all_days: median(all),
      pages_per_day_median_active: median(per), pages_per_day_p90: q(per, 0.9), pages_per_day_max: Math.max(...per),
      pages_per_active_hour_median: median(rows.map((r) => r.pages_per_active_hour)) }; })
    .filter((r) => r.pages_total >= 100).sort((a, b) => b.pages_total - a.pages_total);
  fs.writeFileSync(F('out', 'capacity.json'), JSON.stringify(capacity, null, 1));
  summary.part4 = { rows: tpRows.length, routes: capacity.length, window: `${from}..${NOW.toISOString().slice(0, 10)} (exclusive)` };

  // ------------------------------------------------ part 5: coverage against the experiments
  const pareto = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../../../src/data/ocr-pareto.json'), 'utf8'));
  const expCells = new Set();
  for (const ch of pareto.charts) for (const p of ch.panels) for (const e of [...(p.placed ?? []), ...(p.no_cost ?? [])]) expCells.add(`${ch.id}|${paretoKey(e.engine)}`);
  const prodFail = new Map();
  for (const r of failures.filter((x) => x.rate === 'failed_read')) { const k = `${r.chart}|${paretoKey(r.raw_route)}`; prodFail.set(k, (prodFail.get(k) ?? 0) + r.n); }
  const prodAcc = new Map();
  for (const r of table.filter((x) => x.scored)) { const k = `${r.chart}|${paretoKey(r.engine)}`; prodAcc.set(k, (prodAcc.get(k) ?? 0) + 1); }
  const coverage = {
    note: 'experiment cells = chart x engine placed on src/data/ocr-pareto.json; production cells = chart x stored engine with >= 20 live pages (did-not-read) or >= 1 scored reference page (accuracy). Engine ids mapped by paretoKey().',
    did_not_read_production_only: [...prodFail].filter(([k]) => !expCells.has(k)).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ cell: k, pages: n })),
    did_not_read_both: [...prodFail].filter(([k]) => expCells.has(k)).map(([k, n]) => ({ cell: k, pages: n })),
    accuracy_production_only: [...prodAcc].filter(([k]) => !expCells.has(k)).map(([k, n]) => ({ cell: k, pages: n })),
    accuracy_both: [...prodAcc].filter(([k]) => expCells.has(k)).map(([k, n]) => ({ cell: k, pages: n })),
    experiment_only: [...expCells].filter((k) => !prodFail.has(k)).sort(),
  };
  fs.writeFileSync(F('out', 'coverage.json'), JSON.stringify(coverage, null, 1));
  summary.part5 = { did_not_read_production_only: coverage.did_not_read_production_only.length, did_not_read_both: coverage.did_not_read_both.length,
    accuracy_production_only: coverage.accuracy_production_only.length, accuracy_both: coverage.accuracy_both.length, experiment_only: coverage.experiment_only.length };
  fs.writeFileSync(F('out', 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1).slice(0, 4000));
}
function count(rows, key, w = () => 1) { const m = {}; for (const r of rows) { const k = key(r); m[k] = (m[k] ?? 0) + w(r); } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); }
function sum(rows, k) { return rows.reduce((a, r) => a + (r[k] ?? 0), 0); }
