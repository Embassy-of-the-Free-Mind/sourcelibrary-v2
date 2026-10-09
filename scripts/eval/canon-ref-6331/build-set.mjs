#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/units.mjs builds production's one-page request (prompt v13) for the
// #6182 page sets, and scripts/eval/audit-pareto-samples.mjs (#6304) checks whether a panel's pages suit the
// measure — but only after the arms and judges ran, from the judges' own reference_fit. #6331 needs a NEW set
// (typed Chinese canon passages, plus Sanskrit/Pali held pages) checked BEFORE any arm exists, so this reuses
// both: the #6304 page checks (lib/page-fitness.mjs), units.mjs's request, and an independent fit read in
// place of the judges' reference_fit. Records follow the #5695 harness format (translation-vs-reference/README.md).
/**
 * build-set.mjs — #6331 test 2 (Chinese canon) and test 5 (Sanskrit/Pali extension). $0: no model call; Mongo read only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/canon-ref-6331/build-set.mjs --assemble
 *     reads the builders' units ($JOB_SCRATCH/build/*.jsonl, cache/kr2/units/*.jsonl); fills each held page's
 *     source_text from Mongo (pages.ocr.data, exactly what production translates) and its stored English (arm FP);
 *     writes $JOB_SCRATCH/assembled.jsonl and the fit-read packets $JOB_SCRATCH/fit/in-NN.jsonl.
 *   node ... build-set.mjs --finalize
 *     reads the fit reads ($JOB_SCRATCH/fit/out-*.jsonl), runs the checks, drops what fails, and writes
 *     $JOB_SCRATCH/records.jsonl (harness input, holds reference text: NEVER committed),
 *     /root/cli-set-6331/units.jsonl + prompts/<set>__<uid>.txt (+ arms/FP.jsonl for held pages with stored English),
 *     and scripts/eval/results/canon-ref-6331/summary.json (ids, sources, licences, verdicts; no text).
 *
 * Checks (drop = hard): source length 600–2,500 chars; #6304 checks 1–2 (pageChecks: near-empty, wrong script or
 * language); one unit per work, across the new units and, for Sanskrit/Pali, the #6182 set's own texts; the fit
 * read: `wrong`, `offset`, `cant_tell`, `narrower` or `wider` drop (the set's rule is the SAME span), `minor` keeps;
 * a held page with a printed English translation on it. Soft (reported): #6304 check 3 (reference/source length
 * ratio against the language median, numbers unmatched), page-type, mixed script. Famous = builder's flag, the
 * #6304 title list, or the fit reader's `memorisation: high` (not `canonical`: the builders set it on every canon text).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { pageChecks, stripTags, FAMOUS } from '../lib/page-fitness.mjs';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, getTranslateModelForBook } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const S = process.env.JOB_SCRATCH || '/mnt/HC_Volume_105839809/jobs/zh-set-6331';
const OUT = '/root/cli-set-6331';
const RESULTS = path.join(__dirname, '..', 'results', 'canon-ref-6331');
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const wjl = (f, rs) => fs.writeFileSync(f, rs.map((r) => JSON.stringify(r)).join('\n') + (rs.length ? '\n' : ''));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const SET_OF = { Chinese: 'zh-canon', Sanskrit: 'sa-ext', Pali: 'pi-ext' };

if (process.argv.includes('--assemble')) {
  const files = [...fs.readdirSync(path.join(S, 'build')).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(S, 'build', f)),
    ...(fs.existsSync(path.join(S, 'cache/kr2/units')) ? fs.readdirSync(path.join(S, 'cache/kr2/units')).map((f) => path.join(S, 'cache/kr2/units', f)) : [])];
  const units = files.flatMap((f) => jl(f).map((u) => ({ ...u, builder_file: path.basename(f) })));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const held = units.filter((u) => u.source?.kind === 'page');
  const bookIds = [...new Set(held.map((u) => u.source.book_id))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, work_id: 1, image_source: 1 } }).toArray()).map((b) => [b.id, b]));
  for (const u of held) {
    const p = await db.collection('pages').findOne({ book_id: u.source.book_id, page_number: Number(u.source.page_number) }, { projection: { _id: 0, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, page_type: 1 } });
    u.source_text = p?.ocr?.data || null; u.book = books.get(u.source.book_id) || null;
    u.stored_english = p?.translation?.data || null; u.stored_english_model = p?.translation?.model || null;
    u.page_type = p?.page_type || (u.source_text?.match(/<page-type>([^<]*)<\/page-type>/) || [])[1] || null;
  }
  await c.close();
  for (const u of units) {
    if (u.source?.kind === 'page') continue;
    const year = Number((String(u.date || '').match(/\d{3,4}/) || [])[0]) || undefined;
    u.book = { id: u.work_id, title: u.work_title, display_title: u.work_title, author: u.author || undefined, year, language: u.lang };
  }
  const seen = new Set();
  for (const u of units) { if (seen.has(u.uid)) throw new Error(`duplicate uid ${u.uid}`); seen.add(u.uid); }
  wjl(path.join(S, 'assembled.jsonl'), units);
  // Fit-read packets: source + reference only, in a seeded order, ≤ 24 units per packet.
  const h = (u) => crypto.createHash('sha256').update('6331:' + u.uid).digest('hex');
  const done = new Set(fs.existsSync(path.join(S, 'fit')) ? fs.readdirSync(path.join(S, 'fit')).filter((f) => f.startsWith('out-')).flatMap((f) => jl(path.join(S, 'fit', f)).map((o) => o.uid)) : []);
  const todo = units.filter((u) => !done.has(u.uid) && u.source_text).sort((a, b) => h(a).localeCompare(h(b)));
  fs.mkdirSync(path.join(S, 'fit'), { recursive: true });
  const existing = fs.readdirSync(path.join(S, 'fit')).filter((f) => f.startsWith('in-')).length;
  for (let i = 0; i < todo.length; i += 24) {
    wjl(path.join(S, 'fit', `in-${String(existing + i / 24 + 1).padStart(2, '0')}.jsonl`), todo.slice(i, i + 24).map((u) => ({ uid: u.uid, lang: u.lang, work: u.work_title || u.book?.title,
      reference_title: u.reference_meta?.title, translator: u.reference_meta?.translator, source_text: u.source_text, reference_text: u.reference_text })));
  }
  const by = {}; for (const u of units) by[u.stratum] = (by[u.stratum] || 0) + 1;
  console.log('assembled', units.length, by, 'no source text', units.filter((u) => !u.source_text).length, 'fit packets to read', Math.ceil(todo.length / 24));
  process.exit(0);
}

if (!process.argv.includes('--finalize')) { console.error('usage: build-set.mjs --assemble | --finalize'); process.exit(1); }

const units = jl(path.join(S, 'assembled.jsonl'));
const fit = new Map(fs.readdirSync(path.join(S, 'fit')).filter((f) => f.startsWith('out-')).flatMap((f) => jl(path.join(S, 'fit', f))).map((o) => [o.uid, o]));
const prior = jl('/root/pareto-6182/xl/records.jsonl').filter((r) => ['Sanskrit', 'Pali'].includes(r.lang));
const priorBooks = new Set(prior.map((r) => r.book_id));
const rows = [];
const workSeen = new Map();
for (const u of units) {
  const src = u.source_text || '';
  const row = { uid: u.uid, set: SET_OF[u.lang], lang: u.lang, stratum: u.stratum, work_id: u.work_id, work_title: u.work_title || u.book?.title,
    source: { kind: u.source?.kind, corpus: u.source?.corpus, url: u.source?.url, licence: u.source?.licence, locator: u.source?.locator, book_id: u.source?.book_id, page_number: u.source?.page_number },
    reference: { title: u.reference_meta?.title, translator: u.reference_meta?.translator, year: u.reference_meta?.year, licence: u.reference_meta?.licence, private: !!u.reference_meta?.private,
      style: u.reference_meta?.style, url: u.reference_meta?.url, located: u.reference_meta?.located },
    src_chars: src.length, alignment_confidence: u.alignment_confidence, hard: [], soft: [] };
  const famous = u.famous ? 'builder' : FAMOUS.test(`${row.work_title} ${u.reference_meta?.title || ''}`) ? 'famous title' : null;
  row.famous = !!famous; row.famous_basis = famous ? (u.famous_basis || famous) : null;
  if (!src) row.hard.push('no-source-text');
  if (src.length < 600) row.hard.push('under-600');
  if (src.length > 2500) row.hard.push('over-2500');
  const pc = pageChecks(src, u.lang, { pageType: u.page_type });
  row.letters = pc.m.letters; row.expected_script_share = pc.m.expected_script_share; row.latin_share = pc.m.latin_share;
  row.hard.push(...pc.hard); row.soft.push(...pc.soft);
  // a printed English translation on a held page (bilingual editions): English stopwords in the OCR
  if (u.source?.kind === 'page' && (pc.m.lang_hits?.English || 0) >= 10) row.hard.push('english-on-page');
  // one unit per work
  const wk = `${u.lang}|${u.work_id}`;
  if (workSeen.has(wk)) row.hard.push(`same-work-as:${workSeen.get(wk)}`); else workSeen.set(wk, u.uid);
  if (u.source?.kind === 'page' && priorBooks.has(u.source.book_id) && !/nikaya-sutta/.test(u.builder_note || '')) row.soft.push('book-in-6182-set');
  // check 3: reference/source length and numbers
  const refChars = (u.reference_text || '').replace(/\s/g, '').length;
  row.ref_chars = refChars; row.len_ratio = row.letters ? r3(refChars / row.letters) : null;
  const nums = (s) => new Set(stripTags(s || '').match(/\d{2,}/g) || []);
  const sn = nums(src), rn = nums(u.reference_text);
  row.numbers = { source: sn.size, in_reference: [...sn].filter((x) => rn.has(x)).length };
  // the fit read (independent of the builder), in place of the judges' reference_fit
  const f = fit.get(u.uid);
  row.fit = f ? f.fit : null; row.fit_note = f ? f.note : null;
  if (!f) row.hard.push('no-fit-read');
  else if (!['same', 'minor'].includes(f.fit)) row.hard.push(`fit:${f.fit}`);
  if (f?.memorisation === 'high' && !row.famous) { row.famous = true; row.famous_basis = 'fit reader: widely reproduced'; }
  rows.push(row);
}
for (const lang of ['Chinese', 'Sanskrit', 'Pali']) {
  const rs = rows.filter((r) => r.lang === lang); const med = median(rs.map((r) => r.len_ratio));
  for (const r of rs) {
    r.len_ratio_vs_lang = med && r.len_ratio != null ? r3(r.len_ratio / med) : null;
    if (r.len_ratio_vs_lang != null && (r.len_ratio_vs_lang < 0.4 || r.len_ratio_vs_lang > 2.5)) r.soft.push('len-ratio');
    if (r.numbers.source >= 3 && r.numbers.in_reference === 0) r.soft.push('numbers-unmatched');
  }
}
const keep = rows.filter((r) => !r.hard.length);
const keepIds = new Set(keep.map((r) => r.uid));

// Production's one-page request, as pareto-6182/units.mjs builds it (pinned v13 prompt document).
const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
if (Number(state.prompt_ref.version) !== 13) throw new Error('base prompt is not v13');
fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'arms'), { recursive: true });
for (const f of fs.readdirSync(path.join(OUT, 'prompts'))) fs.unlinkSync(path.join(OUT, 'prompts', f));
const out = [], fp = [], records = [];
for (const u of units.filter((x) => keepIds.has(x.uid))) {
  const set = SET_OF[u.lang];
  const prompt = buildTranslationPrompt({ prompts: state.prompts, book: u.book, ocrText: u.source_text, pageBreak: PAGE_BREAK_SCOPED }).prompt;
  const unit = { uid: u.uid, set, lang: u.lang, prompt, max_out: maxOutputTokensFor([{ ocr: { data: u.source_text } }]), src_chars: u.source_text.length,
    stratum: u.stratum, prod_model: getTranslateModelForBook(u.book), page_id: u.source?.kind === 'page' ? `${u.source.book_id}_${String(u.source.page_number).padStart(5, '0')}` : null };
  out.push(unit);
  fs.writeFileSync(path.join(OUT, 'prompts', `${set}__${u.uid}.txt`), prompt);
  if (u.stored_english) fp.push({ uid: u.uid, arm: 'FP', model: u.stored_english_model || 'stored production English', set, lang: u.lang, text: u.stored_english });
  records.push({ track: '6331', id: u.uid, set, stratum: u.stratum, book_id: u.source?.book_id || u.work_id, page_number: u.source?.page_number ?? null, lang: u.lang,
    ocr_text: u.source_text, reference_text: u.reference_text, reference_meta: { ...u.reference_meta, canonical: keep.find((r) => r.uid === u.uid).famous },
    book: u.book, source: u.source, famous: keep.find((r) => r.uid === u.uid).famous });
}
wjl(path.join(OUT, 'units.jsonl'), out);
wjl(path.join(OUT, 'arms', 'FP.jsonl'), fp);
wjl(path.join(S, 'records.jsonl'), records);

const tally = (rs, k) => rs.reduce((m, r) => { m[r[k]] = (m[r[k]] || 0) + 1; return m; }, {});
const reasons = {}; for (const r of rows) for (const h of r.hard) { const k = h.split(':').slice(0, 2).join(':').replace(/same-work-as:.*/, 'same-work'); reasons[k] = (reasons[k] || 0) + 1; }
const summary = {
  issue: 6331, generated_at: new Date().toISOString(), script: 'scripts/eval/canon-ref-6331/build-set.mjs', spend_usd: 0,
  built: rows.length, kept: keep.length, by_stratum_built: tally(rows, 'stratum'), by_stratum_kept: tally(keep, 'stratum'),
  dropped_by_reason: reasons, famous_kept: tally(keep.filter((r) => r.famous), 'stratum'),
  famous_share_kept: Object.fromEntries(['Chinese', 'Sanskrit', 'Pali'].map((l) => { const rs = keep.filter((r) => r.lang === l); return [l, rs.length ? r3(rs.filter((r) => r.famous).length / rs.length) : null]; })),
  fp_rows: fp.length, prompts_dir: path.join(OUT, 'prompts'),
  units: rows.map(({ letters, latin_share, expected_script_share, ...r }) => ({ ...r, kept: !r.hard.length })),
};
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log('built', rows.length, 'kept', keep.length, summary.by_stratum_kept, 'dropped', reasons, 'famous share', summary.famous_share_kept, 'FP', fp.length);
