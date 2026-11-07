#!/usr/bin/env node
// PRIOR ART: route-judge-6740/defect-rate.mjs inventory — the same counts and words(), but a one-off over packets in job
// scratch on the box that ran them, so it cannot be rerun and its rates stopped at 2026-10-30 (+ two hand-pooled sources).
// lane-judge-sampler.mjs export — live rows only, k/n only, and it is what the k/n floor already reads.
// backfill-test-verdicts.mjs — test verdict FILES into the store; this adds what it never read (QA verdicts that live
// only in book_checks) through the same testRow, and reads the whole store back out.
// maintenance/judge-verdicts-to-book-checks.mjs — the opposite direction (store to book_checks): its judged-pages rows
// are skipped here, because their verdicts are already in the store.
/**
 * route-evidence (#8283): every judged page, from a lane, a test or a QA draw, as defects per 1,000 words per router cell
 * and route, the one input of the router's decision (build.py decide_defects).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-evidence.mjs ingest [--apply]
 *        book_checks QA verdicts that carry a severity per defect and the hash of the text read, as origin: 'test' rows
 *        of lane_judge_verdicts. Dry run by default. ADDITIVE ONLY: deterministic _id, insert, no update, no delete.
 *        A method that stores defects: [] on a page it calls serious has no severities and is skipped whole.
 *   ... route-evidence.mjs export [--out=DIR] [--no-rates]
 *        the store to DIR/rows.jsonl.gz and DIR/coverage.json, then defect-rate.py --store-rows writes defect-rates.json.
 *        Read-only on Mongo.
 *
 * A row counts when (reasons are counted in coverage.json, never silently dropped):
 *   - it is a judged item on the route judge's scale: accept, and defects with a severity (Step T's scale has no mapping);
 *   - selection is random (test rows) and it is not the sampler's flagged stratum;
 *   - it can be tied to the text judged (judgedHash);
 *   - routerKey finds its cell and route in rules.json.
 * The same text judged twice for a route is one page.
 *
 * Words come from the page's current text, so a row whose text was since rewritten is counted at the page's size now
 * (words_src: page); defect-rate.mjs made the same approximation for 168K of its 896K words.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testRow, verdictQuery, COLLECTION, SELECTIONS } from './lib/judge-rows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULES_PATH = 'scripts/eval/estimator/router-table/rules.json';
const SEV = ['cosmetic', 'misleads', 'wrong_text'];
const QA_INSTRUMENT = 'book_checks:';
const sha16 = (t) => crypto.createHash('sha256').update(String(t ?? '').trim()).digest('hex').slice(0, 16);
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';

/**
 * What ties a verdict to the text it judged, or null. text_hash is the store's own. write.text_sha / write.text_hash
 * on an ITEM are the text the lane wrote and the judge read (#7866, judged-pages.md). A route judge id commits to the
 * text as a hash does, j + sha256(`cell:page:sha256(text.trim())`) (judge.mjs); so does a `<page>:<sha16>` id.
 */
export function judgedHash(r) {
  if (r.text_hash) return { hash: r.text_hash, by: 'text_hash' };
  if (r.kind === 'item' && (r.write?.text_sha || r.write?.text_hash)) return { hash: r.write.text_sha ?? r.write.text_hash, by: 'write' };
  const id = String(r.test?.verdict_id ?? '');
  if (/^j[0-9a-f]{10}$/.test(id)) return { hash: id, by: 'verdict_id' };
  const m = id.match(/:([0-9a-f]{16})(#|$)/);
  return m ? { hash: m[1], by: 'verdict_id' } : null;
}

/** Router cell ids and routes, with the evidence entries read backwards (as backfill-test-verdicts routerIndex). */
export function routerIndex(rules) {
  const cells = new Map(rules.cells.map((c) => [c.id, new Set(c.routes.map((r) => r.id))]));
  const ix = new Map();
  for (const c of rules.cells) for (const r of c.routes) {
    if (r.pilot && c.pilot) ix.set(`${rules.inputs.pilot}|${c.pilot}|${r.pilot}`, { cell: c.id, route: r.id });
    for (const e of r.evidence || []) ix.set(`${e.score}|${e.cell}|${e.route}`, { cell: c.id, route: r.id });
  }
  return { cells, ix, E: rules.route_evidence ?? {} };
}

/** The stored model of a Gemini-read Chinese page: its own row's, else another arm's on the same page. Map(page_id → model). */
export function zhStoredModels(rows) {
  const out = new Map();
  for (const r of rows) {
    const m = [r.settings?.model, r.settings?.draft_source, r.draft_model].find((x) => /flash/.test(x ?? ''));
    if (m && r.page_id) out.set(r.page_id, m);
  }
  return out;
}

/** A Gemini-read Chinese page's cell follows from its stored model (backfill-test-verdicts zhReocr). */
function geminiZh(r, I) {
  const m = I.zhStored?.get(r.page_id) ?? '';
  const base = /flash-lite/.test(m) ? { cell: 'zh-lite', d: 'lite' } : /3-flash/.test(m) ? { cell: 'chinese-flash3', d: '3flash' } : null;
  if (!base) return null;
  const route = String(r.route).replace(/^gemini-stored$/, base.d).replace(/^gemini>/, `${base.d}>`);
  return { cell: base.cell, route, basis: `stored model ${m}` };
}

/**
 * The (base cell, route) a row informs, or null. In order: the writer's hint; rules.json's own evidence entries; the row's
 * cell when it is a router cell; a served-text draw (#7866 study-7866/<cell>, #7263 study:<Language>/<script>), whose
 * route is the stored read; Gemini-read Chinese. Only a route rules.json lists, under rules.json route_evidence.aliases.
 */
export function routerKey(r, I) {
  const known = (cell, route, basis) => {
    const c = I.E.cell_aliases?.[cell] ?? cell, rt = I.E.aliases?.[route] ?? route, routes = I.cells.get(c);
    // a first-read cell's live routes are the `-written` ones: what the lane wrote, of the arm the test judged
    const id = routes?.has(`${rt}-written`) ? `${rt}-written` : rt;
    return routes?.has(id) ? { cell: c, route: id, basis } : null;
  };
  if (r.router && known(r.router.cell, r.router.route)) return known(r.router.cell, r.router.route, 'the writer');
  const qa = I.E.qa_lanes?.[`${r.route}|${r.lang}`];
  if (qa && String(r.cell).startsWith('qa:')) return known(qa.cell, qa.route, 'QA lane, rules.json qa_lanes');
  const viaRules = r.test?.evidence && I.ix.get(`${r.test.evidence}|${r.cell}|${r.route}`);
  if (viaRules) return { ...viaRules, basis: 'rules.json evidence entry' };
  const cell = String(r.cell ?? '');
  const own = known(cell.replace(/\/(print|manuscript|unknown)$/, ''), r.route, 'the row\'s cell');
  if (own) return own;
  const study = cell.match(/^study-7866\/(.+)$/);
  if (study) return known(study[1], r.route, '#7866 served draw');
  const lang = cell.match(/^study:([^/]+)\//);
  if (lang) {
    const name = I.E.study_language?.[lang[1]] ?? lang[1].toLowerCase();
    const engine = { lite: `${name}-lite`, '3flash': `${I.E.study_flash3?.[lang[1]] ?? name}-flash3`, yigdzin: 'tibetan-yigdzin' }[r.route];
    return engine ? known(engine, r.route, 'served draw, by language and stored read') : null;
  }
  if (r.cell_real === 'chinese-gemini/print' || /^chinese-gemini-(print|siku)/.test(cell)) {
    const g = geminiZh(r, I);
    return g && known(g.cell, g.route, g.basis);
  }
  return null;
}

/** Why a row does not count, or null. */
export function excludedBecause(r, I) {
  if (r.kind !== 'item') return 'not an item';
  const v = r.verdict;
  if (typeof v?.accept !== 'boolean' || !Array.isArray(v?.defects)) return 'not the route judge scale';
  if (v.defects.some((d) => !SEV.includes(d?.severity))) return 'a defect with no severity';
  if (r.origin === 'test' && r.selection !== 'random') return 'not a random draw';
  if ((r.test?.rep ?? 0) > 0) return 'a repeat';
  if (r.draw?.stratum === 'flagged') return 'flagged stratum';
  if (!judgedHash(r)) return 'no text hash';
  if (!routerKey(r, I)) return 'no router cell';
  return null;
}

/** One line of rows.jsonl.gz: what defect-rate.py reads. Pure. */
export function evidenceRow(r, I, { words = 0, words_src = null, script = 'unknown' } = {}) {
  const k = routerKey(r, I), { hash, by } = judgedHash(r), ds = r.verdict.defects;
  const count = (s) => ds.filter((d) => d.severity === s).length;
  const classes = {};
  for (const d of ds) { const c = `${cls(d)}:${SEV.includes(d.severity) ? d.severity : 'other'}`; classes[c] = (classes[c] ?? 0) + 1; }
  return { kind: 'item', run: r.lane ?? r.test?.id ?? 'store', source: r.lane ?? 'store', cell: `${k.cell}/${script}`, base: k.cell, script, route: k.route, basis: k.basis, book_id: r.book_id, page_id: r.page_id,
    verdict_id: r._id, text_hash: hash, hash_by: by, task: taskOf(r, k.cell), prompt: r.judge?.prompt_sha ?? null, accept: r.verdict.accept, fidelity: Number(r.verdict.fidelity) || null,
    n_cosmetic: count('cosmetic'), n_misleads: count('misleads'), n_wrong_text: count('wrong_text'), classes, words, words_src, stratum: r.draw?.stratum ?? null };
}
const taskOf = (r, cell) => (/translat/.test(r.task ?? '') || /-tr(-|$)/.test(cell) ? 'translation' : 'ocr');

/**
 * Methods whose readers never recorded severities: a page they call `invented` or `sense-error` carries defects: [], so
 * their rows would read as zero defects. A whole method, because its clean pages alone would be a biased draw.
 */
export function methodsWithoutSeverity(checks) {
  const out = new Set();
  for (const k of checks) for (const n of k.page_notes || []) if (n.outcome && n.outcome !== 'clean' && !n.defects?.length) out.add(k.method_id);
  return out;
}

/** The verdicts one book_checks row holds, as testRow inputs. judged-pages came FROM the store: never read back. */
export function qaVerdicts(check, language = null) {
  if (check.method_id === 'judged-pages' || check.frame?.source === 'lane_judge_verdicts') return [];
  const stage = check.frame?.stages?.includes('translation') ? 'translation' : 'ocr';
  const out = [];
  for (const n of check.page_notes || []) {
    const t = (check.text_provenance || []).find((x) => x.page_number === n.page_number);
    const hash = stage === 'translation' ? t?.translation_hash : t?.ocr_hash;
    const ds = n.defects;
    if (!Array.isArray(ds) || !hash || t?.hash_of !== 'judged text' || !t.page_id) continue;
    if (ds.some((d) => !SEV.includes(d.severity))) continue;
    const accept = n.verdict === 'accepted' ? true : n.verdict === 'not accepted' ? false : n.outcome !== 'serious';
    out.push({ kind: 'item', book_id: check.book_id, page_id: t.page_id, page_number: n.page_number, selection: SELECTIONS.includes(check.frame?.selection) ? check.frame.selection : 'unknown', cell: `qa:${check.frame?.lane ?? check.method_id}`,
      route: check.frame?.lane ?? check.method_id, lang: language, task: stage, test: { id: `qa:${check.method_id}:${check.run_id}`, record: check.evidence_path, arm: check.frame?.lane ?? null, verdict_id: `${check._id}:${n.page_number}` },
      judge: { instrument: `${QA_INSTRUMENT}${check.method_id}@${check.method_version}`, model: check.reader?.model ?? null }, verdict: { accept, fidelity: null, defects: ds, reader_note: n.note ?? null },
      outcome: { accept, wrong_text: ds.some((d) => d.severity === 'wrong_text'), mapped_by: `book_checks page_notes (verdict ${n.verdict}, outcome ${n.outcome})` },
      judged_at: check.checked_at, text_hash: hash, backfilled_at: new Date().toISOString() });
  }
  return out;
}

async function mongo() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, db: c.db('bookstore') };
}

async function ingest() {
  const { c, db } = await mongo();
  try {
    const checks = await db.collection('book_checks').find({ 'page_notes.defects': { $exists: true }, method_id: { $ne: 'judged-pages' } }).toArray();
    const unscored = methodsWithoutSeverity(checks);
    const scored = checks.filter((k) => !unscored.has(k.method_id));
    const lang = new Map((await db.collection('books').find({ id: { $in: scored.map((k) => k.book_id) } }, { projection: { _id: 0, id: 1, language: 1 } }).toArray()).map((b) => [b.id, b.language]));
    const rows = scored.flatMap((k) => qaVerdicts(k, lang.get(k.book_id) ?? null).map((f) => testRow(f)));
    // all origins: an _id dedupe before insert, not a read of evidence (as lane-judge-sampler)
    const have = new Set((await db.collection(COLLECTION).find(verdictQuery({ _id: { $in: rows.map((r) => r._id) } }, { tests: true }), { projection: { _id: 1 } }).toArray()).map((r) => r._id));
    const fresh = rows.filter((r) => !have.has(r._id));
    const by = {}; for (const r of fresh) by[r.test.id] = (by[r.test.id] ?? 0) + 1;
    console.log(`methods with no severities, skipped: ${[...unscored].join(', ') || 'none'}`);
    console.log(`book_checks rows with defects: ${scored.length}; verdicts with severity and hash: ${rows.length}; already in the store: ${have.size}; to insert: ${fresh.length}`);
    console.log(JSON.stringify(by, null, 1));
    if (!process.argv.includes('--apply')) { console.log('dry run: --apply inserts'); return; }
    if (fresh.length) await db.collection(COLLECTION).insertMany(fresh, { ordered: false });
    console.log(`inserted ${fresh.length}`);
  } finally { await c.close(); }
}

/** Words of a page's text (defect-rate.mjs words), and whether that text is the one judged. */
async function pageTexts(db, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await db.collection('pages').find({ id: { $in: ids.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray())
      out.set(p.id, { ocr: p.ocr?.data ?? '', translation: p.translation?.data ?? '' });
  }
  return out;
}

async function doExport() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'route-evidence'));
  fs.mkdirSync(OUT, { recursive: true });
  const { words } = await import('./route-judge-6740/defect-rate.mjs');
  const { classifyPages } = await import('./router-next-7263/script-type.mjs');
  const I = routerIndex(JSON.parse(fs.readFileSync(path.join(ROOT, RULES_PATH), 'utf8')));
  const { c, db } = await mongo();
  try {
    // tests: true — every origin is evidence for the route it judged; that is this file's purpose (judge-rows.mjs)
    const all = await db.collection(COLLECTION).find(verdictQuery({ kind: 'item' }, { tests: true }), { projection: { usage: 0 } }).toArray();
    I.zhStored = zhStoredModels(all);
    const reasons = {}, why = {}, kept = [];
    for (const r of all) {
      const e = excludedBecause(r, I);
      if (e) { reasons[e] = (reasons[e] ?? 0) + 1; (why[e] ??= {}); const k = `${r.lane}|${r.cell}|${r.route}`; why[e][k] = (why[e][k] ?? 0) + 1; } else kept.push(r);
    }
    const seen = new Map();
    for (const r of kept.sort((a, b) => String(a.judged_at ?? a.test?.judged_at).localeCompare(String(b.judged_at ?? b.test?.judged_at)))) {
      const k = routerKey(r, I);
      seen.set(`${r.page_id}|${k.cell}|${k.route}|${judgedHash(r).hash}`, r);
    }
    const rows = [...seen.values()];
    const ids = [...new Set(rows.map((r) => r.page_id).filter(Boolean))];
    const texts = await pageTexts(db, ids), scripts = await classifyPages(db, ids);
    const out = rows.map((r) => {
      const k = routerKey(r, I), field = taskOf(r, k.cell) === 'translation' ? 'translation' : 'ocr', t = texts.get(r.page_id)?.[field] ?? '';
      const raw = { printed: 'print', handwritten: 'manuscript', typescript: 'print', mixed: 'print' }[r.script_type] ?? r.script_type;
      const script = ['print', 'manuscript'].includes(raw) ? raw : scripts.get(r.page_id)?.cls ?? 'unknown';
      const own = sha16(t) === judgedHash(r).hash;
      return evidenceRow(r, I, { words: words(t), words_src: t ? (own ? 'candidate' : 'page') : null, script });
    });
    const gz = path.join(OUT, 'rows.jsonl.gz');
    fs.writeFileSync(gz, zlib.gzipSync(out.map((x) => JSON.stringify(x)).join('\n') + '\n'));
    const tally = (f) => out.reduce((m, x) => { m[f(x)] = (m[f(x)] ?? 0) + 1; return m; }, {});
    const coverage = { generated_at: new Date().toISOString(), store_items: all.length, counted_rows: kept.length, one_per_text: out.length, excluded: reasons, by_lane: tally((x) => x.source), hash_by: tally((x) => x.hash_by), router_basis: tally((x) => x.basis), words_src: tally((x) => x.words_src), script: tally((x) => x.script) };
    fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(coverage, null, 1));
    fs.writeFileSync(path.join(OUT, 'excluded-detail.json'), JSON.stringify(why, null, 1));
    console.log(JSON.stringify(coverage, null, 1));
    if (!process.argv.includes('--no-rates')) {
      const py = spawnSync('python3', ['scripts/eval/route-judge-6740/defect-rate.py', '--store-rows', gz, '--coverage', path.join(OUT, 'coverage.json')], { cwd: process.env.ROUTE_EVIDENCE_CWD || ROOT, stdio: 'inherit' });
      if (py.status !== 0) throw new Error('defect-rate.py --store-rows failed');
    }
  } finally { await c.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === 'ingest') await ingest();
  else if (cmd === 'export') await doExport();
  else { console.error('usage: route-evidence.mjs ingest [--apply] | export [--out=DIR] [--no-rates]'); process.exit(2); }
}
