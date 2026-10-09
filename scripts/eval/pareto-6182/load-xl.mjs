// PRIOR ART: scripts/eval/reocr-lift-5700/load-tracks.mjs — it keeps only corrected/low pages and carries no book metadata or prior arm texts
// Also mirrored: scripts/eval/build-translation-pareto.mjs (which arm is an engine, which packet counts per track).
/**
 * load-xl.mjs — one row per page of the five #5695 reference tracks (T1 Latin, T2 Greek, T3 vernaculars,
 * T4 Hebrew/Aramaic/Arabic/Persian, T5 Sanskrit/Pali/Chinese) and of the #5873 top-up (T4-topup, T5-topup),
 * with the exact OCR the track's engine arms translated, the reference, the book fields buildTranslationPrompt
 * reads, and the prior arm texts — the input set for #6182.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pareto-6182/load-xl.mjs \
 *        [--out /root/pareto-6182/xl] [--summary scripts/eval/results/pareto-6182/xl-pages.json] [--no-mongo]
 *
 * Writes
 *   <out>/records.jsonl  PRIVATE (reference texts, some withheld from the repo under #5488) — never commit
 *   <summary>            commit-safe: ids, track, lang, book, reference title/translator/licence, char counts,
 *                        verification of ocr_text against what the arms recorded. No reference or source text.
 * Reads committed files under scripts/eval/results/ and, unless --no-mongo, READ-ONLY `books` (by id) and
 * `pages.ocr.data` (to report whether the stored OCR has drifted since the arms ran). No writes, no model calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getTranslateModelForBook } from '../../lib/translate-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..', '..');
const RES = path.join(REPO, 'scripts', 'eval', 'results');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/root/pareto-6182/xl');
const SUMMARY = path.resolve(REPO, opt('summary', 'scripts/eval/results/pareto-6182/xl-pages.json'));
const NO_MONGO = args.includes('--no-mongo');

const rl = (f) => fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const rj = (f) => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
const idOf = (b, p) => `${b}_${String(p).padStart(5, '0')}`;
const sha16 = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 16);
const maxOutFor = (n) => Math.min(32768, Math.max(4096, Math.ceil(n) + 1200)); // the arms' maxOutputTokensFor
const LITE = 'gemini-3.1-flash-lite', FLASH = 'gemini-3-flash-preview', OPUS = 'claude-opus';
const PARETO_LANG = { 'Ancient Greek': 'Greek', 'Byzantine Greek': 'Greek' };
const prodEngine = (lang) => getTranslateModelForBook({ language: lang });
const eitherRev = (byJudge) => Object.values(byJudge || {}).some((j) => { const v = j?.reversal; return Array.isArray(v) ? v.length > 0 : !!v; });

// ── in_track_judged: the build-translation-pareto.mjs TRACKS table (engine map, keep, packet), recomputed ──
// A page is judged when the engine production routes its language to has a numeric fidelity in the packet the
// pareto chart uses for that language (the packet with the most production-engine pages).
const PARETO = {
  T1: { file: 'xlref-t1-2026-10/rows.jsonl', engine: { 'prod-A': LITE, 'flash-0': FLASH, opus: OPUS }, row: (r) => ({ id: idOf(r.book_id, r.page_number), lang: r.lang, packet: r.pass, fidelity: r.fidelity }) },
  T2: { file: 'xlref-t2-2026-10/pages.jsonl', engine: { 'lite-a': LITE, flash: FLASH, opus: OPUS }, keep: (r) => r.arms_packet && !r.source_is_corrected_transcription, row: (r) => ({ id: r.id, lang: 'Greek', packet: 'arms', fidelity: r.arms_packet.fidelity }) },
  T3: { file: 'xlref-t3-2026-10/pages.jsonl', engine: { L1: LITE, F0: FLASH, O: OPUS }, row: (r) => ({ id: r.id, lang: r.lang, packet: 'main', fidelity: r.fidelity }) },
  T4: { file: 'xlref-t4-2026-10/pages.jsonl', engine: { 'prod-A': LITE, 'flash-0': FLASH, opus: OPUS }, keep: (r) => r.packet === 1, row: (r) => ({ id: r.id, lang: r.lang, packet: `p${r.packet}`, fidelity: r.fidelity }) },
  T5: { file: 'xlref-t5-2026-10/pages.jsonl', engine: { lite: LITE, flash: FLASH, opus: OPUS }, row: (r) => ({ id: r.id, lang: r.lang, packet: 'main', fidelity: r.fidelity }) },
  'T4-topup': { file: 'ref-topup-5873-2026-10/pages.jsonl', engine: { lite: LITE, flash: FLASH }, row: (r) => ({ id: r.id, lang: r.lang, packet: 'topup', fidelity: r.fidelity }) },
};
PARETO['T5-topup'] = PARETO['T4-topup'];
const judgedCache = {};
function judged(track) {
  if (judgedCache[track]) return judgedCache[track];
  const t = PARETO[track]; const rows = [];
  for (const r of rl(t.file)) {
    if (track.endsWith('-topup') && r.track !== track) continue;
    const engine = t.engine[r.arm]; if (!engine || (t.keep && !t.keep(r))) continue;
    const x = t.row(r); if (typeof x.fidelity !== 'number') continue;
    rows.push({ ...x, engine, arm: r.arm });
  }
  const out = {}; // lang -> { packet, ids:Set, arm }
  for (const lang of new Set(rows.map((r) => r.lang))) {
    const prod = prodEngine(lang); const lr = rows.filter((r) => r.lang === lang && r.engine === prod);
    const cnt = {}; for (const r of lr) cnt[r.packet] = (cnt[r.packet] || 0) + 1;
    const packet = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    out[lang] = { production_engine: prod, packet, arm: lr[0]?.arm ?? null, ids: new Set(lr.filter((r) => r.packet === packet).map((r) => r.id)) };
  }
  return (judgedCache[track] = out);
}

const rows = [];
const verify = {}; // track -> { checked, match, mismatch:[], unverifiable, method }
const V = (track, method) => (verify[track] ??= { method, checked: 0, match: 0, mismatch: [], unverifiable: 0 });
const arm = (text, model, extra = {}) => (text && String(text).trim() ? { text, model: model ?? null, ...extra } : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ── T1 Latin ── records.jsonl; arms/<arm>.jsonl packed {file, data}; arms ran on r.source_text (arms.mjs: ocrText = r.source_text)
{
  const rec = rl('xlref-t1-2026-10/records.jsonl');
  const armFiles = ['prod-A', 'prod-B', 'flash-0', 'flash-think', 'flash-dyn', 'lite-noctx', 'opus'];
  const arms = {};
  for (const a of armFiles) for (const { file, data } of rl(`xlref-t1-2026-10/arms/${a}.jsonl`)) {
    const [b, p] = file.replace(/\.(json|txt)$/, '').split(/_(?=\d+$)/); const id = idOf(b, p);
    (arms[id] ??= {})[a] = typeof data === 'string'
      ? arm(data, 'claude-opus (subagent, subscription)', { prompt_version: 13 })
      : arm(data.text, data.model, { prompt_version: data.prompt_ref?.version, context: data.context?.previous_translation ? 'prev translation + prev/next OCR' : 'none', ocr_chars: data.ocr_chars });
  }
  const v = V('T1', 'arms/*.jsonl ocr_chars === source_text.length (prod-A, flash-0, lite-noctx)');
  for (const r of rec) {
    const id = idOf(r.book_id, r.page_number); const a = arms[id] || {};
    for (const k of ['prod-A', 'flash-0', 'lite-noctx']) { const n = a[k]?.ocr_chars; if (n == null) { v.unverifiable++; continue; } v.checked++; if (n === r.source_text.length) v.match++; else v.mismatch.push(`${id} ${k} ${n}≠${r.source_text.length}`); }
    const served = r.candidates?.find((c) => c.arm === 'served');
    const prior = clean({ served: arm(served?.text, served?.model, { note: 'what readers saw (chained lane, not a v13 single-page arm)' }), ...Object.fromEntries(Object.entries(a).map(([k, x]) => { if (!x) return [k, undefined]; const { ocr_chars, ...rest } = x; return [k, rest]; })) });
    rows.push({ track: 'T1', id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, ocr_text: r.source_text,
      reference_text: r.reference_text ?? null, reference_meta: r.reference_meta, source_prev_tail: r.source_prev_tail, source_next_head: r.source_next_head, prior_arms: prior });
  }
}
// ── T2 Greek ── pages.jsonl, one row per page × arm; each arm row carries the exact source_text it translated
{
  const pages = rl('xlref-t2-2026-10/pages.jsonl'); const by = {};
  for (const p of pages) (by[p.id] ??= {})[p.arm] = p;
  const v = V('T2', 'source_text on each engine arm row (lite-a, lite-b, flash, opus) === served row source_text');
  for (const [id, a] of Object.entries(by)) {
    const s = a.served; const ref = s.reference || {};
    for (const k of ['lite-a', 'lite-b', 'flash', 'opus']) { if (!a[k]) continue; v.checked++; if (a[k].source_text === s.source_text && !a[k].source_is_corrected_transcription) v.match++; else v.mismatch.push(`${id} ${k}`); }
    const { text: refText, text_withheld, ...meta } = ref;
    const prior = clean(Object.fromEntries(['served', 'lite-a', 'lite-b', 'flash', 'opus'].map((k) => [k, a[k] ? arm(a[k].text, a[k].model, { prompt_version: a[k].prompt_version, ...(k === 'served' ? { note: 'what readers saw' } : {}) }) : undefined])));
    rows.push({ track: 'T2', id, book_id: s.book_id, page_number: s.page_number, lang: PARETO_LANG[s.lang] || s.lang, lang_track: s.lang, ocr_text: s.source_text,
      reference_text: refText ?? null, reference_withheld_reason: refText ? null : (typeof text_withheld === 'string' ? text_withheld : 'withheld: in-copyright reference (#5488)'), reference_meta: meta, prior_arms: prior });
  }
}
// ── T3 vernaculars ── records.jsonl; raw/<arm>.jsonl carry source_sha = sha16(the text the arm translated)
{
  const rec = rl('xlref-t3-2026-10/records.jsonl');
  const arms = {}; const shas = {};
  for (const a of ['L1', 'L2', 'F0', 'FT', 'FT2048', 'NC', 'O']) for (const x of rl(`xlref-t3-2026-10/raw/${a}.jsonl`)) {
    (arms[x.id] ??= {})[a] = arm(x.text, x.model, { prompt_version: x.prompt_version, context: x.context ? 'prev translation + prev/next OCR' : 'none' });
    if (x.source_sha) (shas[x.id] ??= {})[a] = x.source_sha;
  }
  const v = V('T3', 'raw/<arm>.jsonl source_sha === sha16(source_text) (every Gemini arm)');
  for (const r of rec) {
    const id = idOf(r.book_id, r.page_number); const h = sha16(r.source_text);
    for (const [k, s] of Object.entries(shas[id] || {})) { v.checked++; if (s === h) v.match++; else v.mismatch.push(`${id} ${k}`); }
    const served = r.candidates?.find((c) => c.arm === 'served');
    rows.push({ track: 'T3', id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, ocr_text: r.source_text,
      reference_text: r.reference_text ?? null, reference_meta: r.reference_meta, source_prev_tail: r.source_prev_tail, source_next_head: r.source_next_head,
      prior_arms: clean({ served: arm(served?.text, served?.model, { note: 'what readers saw' }), ...(arms[id] || {}) }) });
  }
}
// ── T4 Hebrew/Aramaic, Arabic, Persian ── references.jsonl (source_text_ocr); arm texts in pages.jsonl (packet 1)
{
  const refs = rl('xlref-t4-2026-10/references.jsonl'); const pages = rl('xlref-t4-2026-10/pages.jsonl');
  const by = {}; for (const p of pages) { const slot = (by[p.id] ??= {}); if (!slot[p.arm] || p.packet === 1) slot[p.arm] = p; }
  const v = V('T4', 'generationConfig.maxOutputTokens === min(32768,max(4096,len+1200)) + thinkingBudget (prod-A, prod-B, flash-0, lite-noctx; floor 4096 = unverifiable)');
  for (const r of refs) {
    const a = by[r.id] || {};
    for (const k of ['prod-A', 'prod-B', 'flash-0', 'lite-noctx']) {
      const g = a[k]?.generationConfig; if (!g) { v.unverifiable++; continue; }
      const want = maxOutFor(r.source_text_ocr.length) + (g.thinkingConfig?.thinkingBudget || 0);
      if (want - (g.thinkingConfig?.thinkingBudget || 0) === 4096) { v.unverifiable++; continue; }
      v.checked++; if (g.maxOutputTokens === want) v.match++; else v.mismatch.push(`${r.id} ${k} ${g.maxOutputTokens}≠${want}`);
    }
    const prior = clean(Object.fromEntries(['served', 'prod-A', 'prod-B', 'flash-0', 'flash-think8k', 'lite-noctx', 'opus'].map((k) => [k, a[k] ? arm(a[k].text, a[k].model, { prompt_version: a[k].prompt_version, ...(a[k].context ? { context: a[k].context.previous_translation ? 'prev translation + prev/next OCR' : 'none' } : {}), ...(k === 'served' ? { note: 'what readers saw' } : {}) }) : undefined])));
    rows.push({ track: 'T4', id: r.id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, ocr_text: r.source_text_ocr,
      reference_text: r.reference_text ?? null, reference_withheld_reason: r.reference_text ? null : (r.reference_text_withheld || 'reference_text absent (in-copyright, #5488)'), reference_meta: r.reference_meta, prior_arms: prior });
  }
}
// ── T5 Sanskrit, Pali, Chinese ── work/records-arms.jsonl (candidates hold lite/flash/lite2/served/flash-think/lite-ctx/opus)
// 57 pages' lite/flash/lite2 were run in #5606 (tibetan-mt-ab/batch-arms.mjs, which records src_chars); 11 by xlref-t5/run-arms.mjs.
{
  const rec = rl('xlref-t5-2026-10/work/records-arms.jsonl');
  const src5606 = {};
  for (const d of ['lite-batch', 'flash-batch', 'lite-rerun-batch']) {
    const dir = path.join(RES, 'translation-ab-5606-2026-10-02/arms/gemini', d);
    for (const f of fs.readdirSync(dir)) { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); (src5606[j.id] ??= {})[d] = j.src_chars; }
  }
  const t5arm = {}; for (const a of ['lite', 'flash', 'lite2', 'flash-thinkon']) for (const x of rl(`xlref-t5-2026-10/arms/${a}.jsonl`)) (t5arm[x.id] ??= {})[a] = x;
  const v = V('T5', '#5606 batch-arms src_chars === source_text.length (57 pages); xlref-t5 run-arms maxOutputTokens (11 pages; floor 4096 = unverifiable)');
  for (const r of rec) {
    const id = idOf(r.book_id, r.page_number); const len = r.source_text.length;
    if (src5606[id]) for (const [k, n] of Object.entries(src5606[id])) { v.checked++; if (n === len) v.match++; else v.mismatch.push(`${id} ${k} ${n}≠${len}`); }
    else for (const k of ['lite', 'flash', 'lite2']) {
      const g = t5arm[id]?.[k]?.generation_config; if (!g) { v.unverifiable++; continue; }
      const want = maxOutFor(len); if (want === 4096) { v.unverifiable++; continue; }
      v.checked++; if (g.maxOutputTokens === want) v.match++; else v.mismatch.push(`${id} ${k} ${g.maxOutputTokens}≠${want}`);
    }
    const prior = {};
    for (const c of r.candidates || []) {
      if (c.arm === 'lite-check') continue; // a check-and-fix pass over Lite, not a translation of the OCR
      const extra = c.arm === 'served' ? { note: 'what readers saw' } : c.arm === 'lite-ctx' ? { context: 'served translation of page N-1' } : { prompt_version: 13, context: src5606[id] && ['lite', 'flash', 'lite2'].includes(c.arm) ? 'prev/next OCR (page-break lookahead), no prev translation' : 'none (single page, page-break lookahead only)' };
      prior[c.arm] = arm(c.text, c.model, extra);
    }
    const ton = t5arm[id]?.['flash-thinkon']; if (ton) prior['flash-thinkon'] = arm(ton.text, ton.model, { prompt_version: 13 });
    rows.push({ track: 'T5', id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, ocr_text: r.source_text,
      reference_text: r.reference_text ?? null, reference_meta: r.reference_meta, source_prev_tail: r.source_prev_tail, source_next_head: r.source_next_head, prior_arms: clean(prior) });
  }
}
// ── #5873 top-up ── references.jsonl (source_text, reference_text unless withheld); arm texts in pages.jsonl
{
  const refs = rl('ref-topup-5873-2026-10/references.jsonl'); const pages = rl('ref-topup-5873-2026-10/pages.jsonl');
  const by = {}; for (const p of pages) (by[p.id] ??= {})[p.arm] = p;
  V('T4-topup', 'no committed per-arm source length/hash; checked against current pages.ocr.data only'); V('T5-topup', 'as T4-topup');
  for (const r of refs) {
    const a = by[r.id] || {}; const track = a.served?.track || Object.values(a)[0]?.track;
    if (!track) throw new Error(`top-up page ${r.id} has no pages.jsonl row`);
    verify[track].unverifiable++;
    const prior = clean(Object.fromEntries(['served', 'lite', 'lite2', 'flash'].map((k) => [k, a[k] ? arm(a[k].text, a[k].model, { prompt_version: a[k].prompt_version, ...(k === 'served' ? { note: 'what readers saw' } : { context: 'prev/next OCR (page-break lookahead), no prev translation' }) }) : undefined])));
    rows.push({ track, id: r.id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, ocr_text: r.source_text,
      reference_text: r.reference_text ?? null, reference_withheld_reason: r.reference_text ? null : (r.reference_withheld ? 'withheld: in-copyright reference (#5488)' : 'reference_text absent'), reference_meta: r.reference_meta, prior_arms: prior });
  }
}

// ── in_track_judged ──
for (const r of rows) {
  const j = judged(r.track)[r.lang];
  r.production_engine = j?.production_engine ?? prodEngine(r.lang);
  r.in_track_judged = !!j?.ids.has(r.id);
  r.in_track_judged_basis = j ? `${r.track} arm ${j.arm} (${j.production_engine}), packet ${j.packet}` : 'no production-engine fidelity rows for this language';
}

// ── books (READ-ONLY) and current OCR drift ──
const BOOK_FIELDS = { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, 'image_source.provider': 1 };
if (!NO_MONGO) {
  const { MongoClient, ObjectId } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  try {
    const db = c.db('bookstore');
    const ids = [...new Set(rows.map((r) => r.book_id))];
    const books = new Map((await db.collection('books').find({ id: { $in: ids } }, { projection: { _id: 0, ...BOOK_FIELDS } }).toArray()).map((b) => [b.id, b]));
    for (const id of ids.filter((i) => !books.has(i) && ObjectId.isValid(i))) { // re-minted ids: look up by _id too
      const b = await db.collection('books').findOne({ _id: new ObjectId(id) }, { projection: BOOK_FIELDS }); if (b) books.set(id, { ...b, _id: undefined });
    }
    const cur = new Map();
    for (const id of ids) {
      const pns = rows.filter((r) => r.book_id === id).map((r) => r.page_number);
      for (const p of await db.collection('pages').find({ book_id: id, page_number: { $in: pns } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray()) cur.set(idOf(id, p.page_number), p.ocr?.data ?? null);
    }
    for (const r of rows) {
      const b = books.get(r.book_id);
      r.book = b ? clean({ id: b.id ?? r.book_id, title: b.title, display_title: b.display_title, author: b.author, year: b.year, published: b.published, language: b.language, image_source: b.image_source?.provider ? { provider: b.image_source.provider } : undefined }) : null;
      r.production_engine_for_book = b ? getTranslateModelForBook(b) : null;
      const now = cur.get(r.id);
      r.ocr_matches_current_mongo = now == null ? null : now === r.ocr_text;
    }
  } finally { await c.close(); }
}

// ── write ──
fs.mkdirSync(OUT, { recursive: true });
const order = ['T1', 'T2', 'T3', 'T4', 'T5', 'T4-topup', 'T5-topup'];
rows.sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track) || a.lang.localeCompare(b.lang) || a.id.localeCompare(b.id));
const seen = new Set(); for (const r of rows) { const k = `${r.track}|${r.id}`; if (seen.has(k)) throw new Error(`duplicate ${k}`); seen.add(k); if (!r.ocr_text) throw new Error(`no ocr_text ${k}`); }
fs.writeFileSync(path.join(OUT, 'records.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const meta = (m) => { const o = typeof m === 'string' ? (() => { try { return JSON.parse(m); } catch { return { title: m }; } })() : (m || {}); return { title: o.title ?? null, translator: o.translator ?? null, year: o.year ?? null, licence: o.licence ?? o.license ?? null }; };
const tally = {};
for (const r of rows) {
  const t = (tally[r.track] ??= { pages: 0, books: new Set(), by_lang: {}, no_reference_text: 0, in_track_judged: 0, opus_prior_arm: 0, ocr_drifted_in_mongo: 0 });
  t.pages++; t.books.add(r.book_id); const l = (t.by_lang[r.lang] ??= { pages: 0, books: new Set() }); l.pages++; l.books.add(r.book_id);
  if (!r.reference_text) t.no_reference_text++; if (r.in_track_judged) t.in_track_judged++; if (r.prior_arms.opus || r.prior_arms.O) t.opus_prior_arm++; if (r.ocr_matches_current_mongo === false) t.ocr_drifted_in_mongo++;
}
const summary = {
  issue: 6182, generated_by: 'scripts/eval/pareto-6182/load-xl.mjs', private_records: `${OUT}/records.jsonl (not committed: holds reference and source texts)`,
  totals: Object.fromEntries(Object.entries(tally).map(([k, t]) => [k, { ...t, books: t.books.size, by_lang: Object.fromEntries(Object.entries(t.by_lang).map(([l, x]) => [l, { pages: x.pages, books: x.books.size }])) }])),
  ocr_text_verification: Object.fromEntries(Object.entries(verify).map(([k, v]) => [k, { ...v, mismatch: v.mismatch.slice(0, 20), mismatches: v.mismatch.length }])),
  pages: rows.map((r) => ({
    track: r.track, id: r.id, book_id: r.book_id, page_number: r.page_number, lang: r.lang, ...(r.lang_track ? { lang_track: r.lang_track } : {}),
    book_title: r.book?.display_title || r.book?.title || null, reference: meta(r.reference_meta),
    ocr_chars: r.ocr_text.length, reference_chars: r.reference_text ? r.reference_text.length : null, reference_withheld_reason: r.reference_text ? undefined : (r.reference_withheld_reason || 'absent'),
    has_prev_tail: !!r.source_prev_tail, has_next_head: !!r.source_next_head,
    in_track_judged: r.in_track_judged, production_engine: r.production_engine, ocr_matches_current_mongo: r.ocr_matches_current_mongo ?? null,
    prior_arms: Object.keys(r.prior_arms),
  })),
};
fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 1) + '\n');
console.table(Object.fromEntries(Object.entries(summary.totals).map(([k, t]) => [k, { pages: t.pages, books: t.books, no_ref: t.no_reference_text, judged: t.in_track_judged, opus: t.opus_prior_arm, ocr_drift: t.ocr_drifted_in_mongo }])));
for (const [k, t] of Object.entries(summary.totals)) console.log(k, JSON.stringify(t.by_lang));
for (const [k, v] of Object.entries(summary.ocr_text_verification)) console.log(`verify ${k}: ${v.match}/${v.checked} match, ${v.mismatches} mismatch, ${v.unverifiable} unverifiable — ${v.method}${v.mismatches ? ` e.g. ${v.mismatch.slice(0, 3).join('; ')}` : ''}`);
console.log(`wrote ${rows.length} rows → ${OUT}/records.jsonl and ${path.relative(REPO, SUMMARY)}`);
