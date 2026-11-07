#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/load-xl.mjs builds the reference panel (every #5695 / #5873 page with its exact
// OCR, reference and book) from committed files — this reads its output and does not rebuild it.
// scripts/eval/plain-6728/build-requests.mjs builds the request exactly as cli-translate.mjs does (seed = stored
// previous page, neighbours' OCR, PAGE_BREAK_SCOPED, + agy TRANSLATE_SUFFIX) — copied here for three arms and three
// engines; the lite rows are in pareto-6182/run-arms.mjs's units shape so that runner submits them unchanged.
/**
 * build.mjs — #7499, $0, read-only (Mongo `books`, `pages`, `prompts`). Two outputs:
 *
 *   scripts/eval/bench-translation/manifest.json   FROZEN, committed. One row per page: id, book, page, language,
 *       group, stratum (print/manuscript, century), ocr_sha16, reference title/translator/licence/style + ref_sha16,
 *       panel membership (p6545, floor). No source or reference text.
 *   $W/req/<engine>-<arm>.jsonl                     the requests (private: they hold page text), and $W/units.jsonl
 *       (the lite rows, `set` = arm) for run-arms.mjs. $W/records.jsonl: the judge's records (reference text, private).
 *
 *   node scripts/eval/pareto-6182/load-xl.mjs --out $JOB_SCRATCH/xl --summary $JOB_SCRATCH/xl/summary.json
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/bench-translation/build.mjs [--check]
 *
 * --check rebuilds and compares with the committed manifest (ocr and reference hashes, page set); exits 1 on drift.
 * W = $BENCH_W, else $JOB_SCRATCH/w.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { armPrompts, seedFor, md5 } from './prompts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = process.env.BENCH_W || `${process.env.JOB_SCRATCH}/w`;
const XL = process.env.BENCH_XL || `${process.env.JOB_SCRATCH}/xl/records.jsonl`;
const MANIFEST = path.join(HERE, 'manifest.json');
const sha16 = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 16);
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

export const GROUP = { Latin: 'latin', Greek: 'greek', Dutch: 'vernacular', French: 'vernacular', German: 'vernacular', Italian: 'vernacular', Spanish: 'vernacular',
  Hebrew: 'hebrew-aramaic', Aramaic: 'hebrew-aramaic', Arabic: 'arabic', Persian: 'persian', Sanskrit: 'sanskrit-pali', Pali: 'sanskrit-pali', Chinese: 'chinese' };
// Which engine reads which pages with which arms (the README's "Arms × engines"; v13b = the A-vs-A floor).
export const PLAN = {
  lite: { pages: 'all', arms: ['v13', 'v20', 'plain'], floor: 'all' },
  flash38: { pages: 'p6545', arms: ['v13', 'v20', 'plain'], floor: 'floor' },
  opus: { pages: 'p6545', arms: ['v13', 'v20', 'plain'], floor: 'floor', batch2: 'rest' },
};

// The #6545 panel and the #6728 noise-floor pages, from #6728's committed judge key.
const key6728 = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'results', 'plain-6728', 'key-G.json'), 'utf8'));
const P6545 = new Set(Object.values(key6728.items).filter((k) => k.kind === 'ARMS').map((k) => k.page_id));
const FLOOR = new Set(Object.values(key6728.items).filter((k) => k.kind === 'ARMS' && Object.values(k.labels).includes('G-CUR2')).map((k) => k.page_id));

function century(y) { const n = parseInt(String(y ?? '').match(/\d{3,4}/)?.[0] ?? '', 10); return Number.isFinite(n) ? `${Math.floor((n - 1) / 100) + 1}c` : 'unknown'; }
function medium(book, ocr) {
  const tag = String(ocr).match(/<script>([^<]*)<\/script>/i)?.[1] || '';
  const f = `${book?.format || ''} ${book?.script_type || ''} ${book?.material || ''} ${tag}`.toLowerCase();
  return /manuscript|handwrit|cursive|codex|autograph/.test(f) ? 'manuscript' : 'print';
}

const recs = jl(XL).filter((r) => r.reference_text && GROUP[r.lang]);
if (new Set(recs.map((r) => r.book_id)).size !== recs.length) throw new Error('panel is not one page per book');
for (const u of P6545) if (!recs.some((r) => r.id === u)) throw new Error(`#6545 page ${u} missing from the xl records`);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const live = await loadTranslationPrompts(db);
const ARMS = ['v13', 'v20', 'plain'];
const P = Object.fromEntries(ARMS.map((a) => [a, armPrompts(a, live)]));
const rows = [], req = {}, units = [];
const PROJ = { id: 1, book_id: 1, page_number: 1, ocr: 1, translation: 1 };
for (const r of recs.sort((a, b) => a.id.localeCompare(b.id))) {
  const book = await db.collection('books').findOne({ id: r.book_id }) || await db.collection('books').findOne({ _id: r.book_id });
  if (!book) throw new Error(`book ${r.book_id} not found`);
  const near = await db.collection('pages').find({ book_id: r.book_id, page_number: { $in: [r.page_number - 1, r.page_number + 1] } }, { projection: PROJ }).toArray();
  const prev = near.find((n) => n.page_number === r.page_number - 1), next = near.find((n) => n.page_number === r.page_number + 1);
  const seed = prev?.translation?.data || null;
  const m = r.reference_meta || {};
  const row = { id: r.id, book_id: r.book_id, page_number: r.page_number, url: `https://sourcelibrary.org/book/${r.book_id}?page=${r.page_number}`,
    track: r.track, lang: r.lang, group: GROUP[r.lang], medium: medium(book, r.ocr_text), century: century(book.year ?? book.published),
    ocr_sha16: sha16(r.ocr_text), ocr_chars: r.ocr_text.length, ref_sha16: sha16(r.reference_text), ref_chars: r.reference_text.length,
    reference: { title: m.title ?? null, translator: m.translator ?? null, year: m.year ?? null, licence: m.licence ?? null, style: m.style ?? null, canonical: !!m.canonical, private: !!m.private },
    p6545: P6545.has(r.id), floor: FLOOR.has(r.id), seeded: !!seed, seed_sha16: seed ? sha16(seed) : null };
  rows.push(row);
  const maxOut = maxOutputTokensFor([{ ocr: { data: r.ocr_text } }]);
  for (const arm of ARMS) {
    const built = buildTranslationPrompt({ prompts: P[arm], book, ocrText: r.ocr_text, previousTranslation: seedFor(arm, seed), prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
    // CLI engines (agy, claude -p) get cli-translate's suffix, as #6728 sent them; lite gets the worker's prompt.
    const cli = built.prompt + TRANSLATE_SUFFIX;
    (req[arm] ||= []).push({ uid: r.id, lang: r.lang, group: row.group, book_id: r.book_id, page_number: r.page_number, prompt: cli, prompt_hash: md5(cli), prompt_ref: built.promptRef, seeded: !!seed, page_break: built.pageBreak });
    units.push({ uid: r.id, set: arm, page_id: r.id, lang: r.lang, prod_model: 'gemini-3.1-flash-lite', prompt: built.prompt, prompt_hash: md5(built.prompt), max_out: maxOut, src_chars: r.ocr_text.length });
  }
  // the A-vs-A arm sends v13's request again, byte for byte
  units.push({ ...units.find((u) => u.uid === r.id && u.set === 'v13'), set: 'v13b' });
}
await c.close();

const manifest = { issue: 7499, built: new Date().toISOString().slice(0, 10), source: 'scripts/eval/pareto-6182/load-xl.mjs (reference_text present)',
  prompts: Object.fromEntries(ARMS.map((a) => [a, P[a].translation.ref.content_hash])), plan: PLAN,
  counts: { pages: rows.length, p6545: rows.filter((x) => x.p6545).length, floor: rows.filter((x) => x.floor).length,
    by_group: rows.reduce((a, x) => ({ ...a, [x.group]: (a[x.group] || 0) + 1 }), {}), by_medium: rows.reduce((a, x) => ({ ...a, [x.medium]: (a[x.medium] || 0) + 1 }), {}) },
  pages: rows };

if (process.argv.includes('--check')) {
  const old = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const by = new Map(old.pages.map((p) => [p.id, p]));
  const drift = rows.filter((p) => !by.has(p.id) || by.get(p.id).ocr_sha16 !== p.ocr_sha16 || by.get(p.id).ref_sha16 !== p.ref_sha16).map((p) => p.id);
  const gone = old.pages.filter((p) => !rows.some((x) => x.id === p.id)).map((p) => p.id);
  console.log(`manifest check: ${rows.length} pages, ${drift.length} drifted, ${gone.length} gone`, drift.slice(0, 10), gone.slice(0, 10));
  process.exit(drift.length || gone.length ? 1 : 0);
}
fs.mkdirSync(path.join(W, 'req'), { recursive: true });
if (!fs.existsSync(MANIFEST)) fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
else console.log('manifest.json exists: left as frozen (use --check to compare)');
for (const [arm, rs] of Object.entries(req)) fs.writeFileSync(path.join(W, 'req', `cli-${arm}.jsonl`), rs.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(W, 'units.jsonl'), units.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(W, 'records.jsonl'), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(W, 'floor-uids.txt'), [...FLOOR].join('\n') + '\n');
console.log(JSON.stringify(manifest.counts), JSON.stringify(manifest.prompts), `units ${units.length}`);
