#!/usr/bin/env node
/**
 * PRIOR ART: overview-draw.mjs (stratified by a FRAME the caller hands in, 4 books × 4 pages) and draw.mjs (one frame,
 * a run of 3 pages). Neither stratifies by LANE: the lane (which engine read the page, which model translated it) is a
 * property of the PAGE, not of a book list, so the stratum is only known after the page is drawn. This draws the page
 * first, then stratifies. It reuses lib.mjs (bookOrder, pageImageUrl, structureCounts), the packet record of
 * overview-draw.mjs (so REVIEWER.md's schema fits) and exposureOf() (review-vocabulary.mjs), unchanged.
 *
 * served-draw — the served-text audit (#6691): ONE page per book, random, stratified by lane.
 *
 *   node --env-file=.env.production.local scripts/eval/spot-check/served-draw.mjs \
 *     --out scripts/eval/results/spot-check/served-2026-10-13 [--seed 6691] [--screen 3000] [--per 10] [--min 10] [--strata 20] [--pilot 1]
 *
 * 1. Frame: live books (visible, pages_count > 0) with ≥ 1 translated page. Seeded order, uniform per book (bookOrder).
 * 2. Screen: the first --screen books of that order. For each, ONE translated page with page_number > 0, uniform over
 *    the book's translated pages, and its lane: ocr (engine family) × script (from books.language) × form (print,
 *    manuscript or e-text, a catalogue heuristic: the reviewer reports the form it sees) × tr (translation model family).
 * 3. Strata: every lane cell with ≥ --min screened books, largest first, up to --strata cells; the rest is one
 *    stratum `rest`. Each stratum takes its first --per books in the seeded order. Its frame share is its share of
 *    the screen, so frame-weighted totals can be formed (est_frame = share × frame size).
 * 4. Packets: pilot-*.json holds the first --pilot book(s) of every stratum (≈ 20 books), s-<stratum>.json the rest.
 *    A page whose OCR or English was made by Claude goes to claude-made.json instead: an Opus reviewer does not judge
 *    its own family's output (#6691); that packet needs a Gemini reviewer (agy), or is reported as not reviewed.
 *    A page with no image at all (a typed corpus) goes to no-image.json, also reported as not reviewed.
 *
 * Writes sample.json (books with stratum, lane, exposure, one page each), packets/*.json, draw-log.json (strata,
 * shares, frame size, seed) and screen.json.gz (every screened book's lane, for the sample-size note). Read-only.
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { bookOrder, structureCounts, pageImageUrl } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { exposureOf } from '../../lib/review-vocabulary.mjs';
import { scriptsOfLanguage } from '../../lib/stray-script.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out');
const SEED = Number(opt('seed', 6691)), SCREEN = Number(opt('screen', 3000)), PER = Number(opt('per', 10));
const MIN = Number(opt('min', 10)), MAX_STRATA = Number(opt('strata', 20)), PILOT = Number(opt('pilot', 1));
if (!OUT) throw new Error('--out required');
if (existsSync(join(OUT, 'sample.json'))) throw new Error(`${OUT}/sample.json exists — refusing to draw over a run`);

// ── lane of one page ──
export function ocrLane(model, source) {
  const m = String(model ?? '').toLowerCase(), s = String(source ?? '').toLowerCase();
  if (/claude|opus|sonnet|haiku|fable/.test(m)) return 'claude';
  if (/esukhia|etcsl|sat|oraec|corpus|typed|tei/.test(s) && (!m || /corpus/.test(m))) return 'etext';
  if (/paddle/.test(m)) return 'paddle';
  if (/bdrc|yigdzin|easter/.test(m) || s === 'bdrc') return 'bdrc';
  if (/^ia-|abbyy|djvu/.test(m) || /ia_djvu|ia-ocr/.test(s)) return 'ia-ocr';
  if (/kraken|ndl|mineru|qwen/.test(m)) return 'other-engine';
  if (/flash-lite/.test(m)) return 'gem-lite';
  if (/gemini-3\.[5-9]|gemini-[4-9]/.test(m)) return 'gem-3.8';
  if (/gemini-3-flash|gemini-3\.0-flash/.test(m)) return 'gem-3flash';
  if (/gemini/.test(m)) return 'gem-other';
  if (!m && !s) return 'unrecorded';
  return 'other-engine';
}
export function trLane(model) {
  const m = String(model ?? '').toLowerCase();
  if (!m) return 'tr-unrecorded';
  if (/corpus/.test(m)) return 'tr-corpus';   // a published scholarly translation shipped with an e-text corpus (ETCSL): no model made it
  if (/claude|opus|sonnet|haiku|fable/.test(m)) return 'tr-claude';
  if (/flash-lite/.test(m)) return 'tr-lite';
  if (/gemini-3\.[5-9]|gemini-[4-9]/.test(m)) return 'tr-3.8';
  if (/gemini-3-flash/.test(m)) return 'tr-3flash';
  if (/gemini/.test(m)) return 'tr-gem-other';
  return 'tr-other';
}
const FAMILY = [['Han', 'cjk'], ['Hiragana', 'cjk'], ['Hangul', 'cjk'], ['Tibetan', 'tibetan'], ['Greek', 'greek'], ['Hebrew', 'hebrew'],
  ['Arabic', 'arabic'], ['Syriac', 'syriac'], ['Cyrillic', 'cyrillic'], ['Devanagari', 'indic'], ['Bengali', 'indic'], ['Tamil', 'indic']];
export function scriptFamily(language) {
  const s = scriptsOfLanguage(language);
  if (!s.size) return 'latin';
  for (const [k, f] of FAMILY) if (s.has(k)) return f;
  return 'other-script';
}
const MS_PROVIDERS = new Set(['laurenziana', 'vatican', 'e-codices', 'penn_colenda', 'chester_beatty', 'morgan', 'e-manuscripta']);
const MS_TITLE = /manuscri|handschrift|\bms\.?\s|\bmss?\b|\bcod(ex|\.)\b|manoscr|autograph/i;
export function formOf(book, lane) {
  if (lane === 'etext') return 'etext';
  const y = Number(String(book.published ?? '').match(/\d{3,4}/)?.[0]);
  if (MS_PROVIDERS.has(book.image_source?.provider) || MS_TITLE.test(book.title ?? '') || (y && y < 1450)) return 'ms';
  return 'print';
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const books = db.collection('books'), pages = db.collection('pages');
const LIVE = { visible: true, pages_count: { $gt: 0 } };
const frame = (await books.find({ ...LIVE, pages_translated: { $gte: 1 } }, { projection: { _id: 0, id: 1 } }).toArray()).map((b) => b.id).filter(Boolean);
console.log(`frame: ${frame.length} live books with a translated page · seed ${SEED} · screen ${SCREEN}`);

// One uniform per book drawn in order BEFORE any query, so concurrency cannot change which page a book gets.
const order = [];
const bookRng = makeRng(SEED), pageRng = makeRng(SEED ^ 0x9e3779b9);
for (const id of bookOrder(frame, bookRng)) { if (order.length >= SCREEN) break; order.push({ id, u: pageRng() }); }

const META = { _id: 0, id: 1, visible: 1, title: 1, display_title: 1, author: 1, language: 1, original_language: 1, published: 1, place_published: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1, page_progression: 1, 'catalog_metadata.collections': 1, 'image_source.provider': 1, ia_identifier: 1 };
const screen = new Array(order.length);
let done = 0;
async function screenOne(i) {
  const { id, u } = order[i];
  const b = await books.findOne({ id }, { projection: META });
  const tr = await pages.find({ book_id: id, page_number: { $gt: 0 }, 'translation.data': { $regex: '\\S' } },
    { projection: { _id: 0, page_number: 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.model': 1 } }).toArray();
  if (!tr.length) { screen[i] = { id, rejected: 'no translated page > 0' }; return; }
  tr.sort((a, c) => a.page_number - c.page_number);
  const p = tr[Math.floor(u * tr.length)];
  const ocr = ocrLane(p.ocr?.model, p.ocr?.source), script = scriptFamily(b.language), form = formOf(b, ocr), trl = trLane(p.translation?.model);
  screen[i] = { id, rank: i, page_number: p.page_number, ocr, script, form, tr: trl, cell: `${ocr}|${script}|${form}|${trl}`,
    ocr_model: p.ocr?.model ?? null, ocr_source: p.ocr?.source ?? null, translation_model: p.translation?.model ?? null, language: b.language, provider: b.image_source?.provider ?? null };
}
const queue = [...order.keys()];
await Promise.all(Array.from({ length: 4 }, async () => { for (let i; (i = queue.shift()) !== undefined;) { await screenOne(i); if (++done % 250 === 0) console.log(`screened ${done}/${order.length}`); } }));

const ok = screen.filter((s) => !s.rejected);
const cells = new Map();
for (const s of ok) cells.set(s.cell, (cells.get(s.cell) ?? 0) + 1);
const named = [...cells].filter(([, n]) => n >= MIN).sort((a, b) => b[1] - a[1]).slice(0, MAX_STRATA).map(([c]) => c);
const stratumOf = (s) => (named.includes(s.cell) ? s.cell : 'rest');
const strata = [...named, 'rest'].map((name) => {
  const members = ok.filter((s) => stratumOf(s) === name);
  return { name, screened: members.length, share: members.length / ok.length, est_frame: Math.round(frame.length * members.length / ok.length),
    cells: name === 'rest' ? Object.fromEntries([...new Set(members.map((m) => m.cell))].map((c) => [c, members.filter((m) => m.cell === c).length])) : undefined,
    drawn: members.slice(0, PER).map((m) => m.id) };
});
for (const st of strata) console.log(`${st.name.padEnd(44)} screened ${String(st.screened).padStart(5)} share ${(100 * st.share).toFixed(1).padStart(5)}%  drawn ${st.drawn.length}`);

const sample = [];
const slug = (s) => s.replace(/\|/g, '__').replace(/[^a-z0-9_.-]/gi, '-');
const packets = {};
for (const st of strata) {
  for (const [k, id] of st.drawn.entries()) {
    const s = ok.find((x) => x.id === id);
    const b = await books.findOne({ id }, { projection: META });
    const all = await pages.find({ book_id: id }, { projection: { _id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1, _id: 1 }).toArray();
    const recs = await pages.find({ book_id: id, page_number: s.page_number }).sort({ _id: 1 }).toArray();
    const pgs = recs.map((p) => ({ page_number: p.page_number, page_id: String(p._id), image_url: pageImageUrl(p),
      crop: !p.split_from_spread && !p.cropped_photo && p.crop?.xStart !== undefined ? p.crop : undefined,
      ocr: p.ocr?.data ?? '', ocr_engine: p.ocr?.source ?? null, ocr_model: p.ocr?.model ?? null,
      translation: p.translation?.data ?? '', translation_model: p.translation?.model ?? null, translation_source: p.translation?.source ?? null,
      exposure: exposureOf({ book: b, page: p }) }));
    const rec = { slot: sample.length + 1, stratum: st.name, lane: { ocr: s.ocr, script: s.script, form: s.form, tr: s.tr }, book_id: id,
      book_url: `https://sourcelibrary.org/book/${id}?page=${s.page_number}`, tradition: null, book: b,
      structure: { ...structureCounts(all), pages_count_field: b.pages_count, pages_translated_field: b.pages_translated }, run: [s.page_number], pages: pgs };
    sample.push(rec);
    const claudeMade = s.ocr === 'claude' || s.tr === 'tr-claude';
    // No leaf image to read against (a typed corpus such as ETCSL): the method cannot judge it; reported as not reviewed.
    const noImage = pgs.every((p) => !p.image_url);
    const packet = noImage ? 'no-image' : claudeMade ? 'claude-made' : k < PILOT ? 'pilot' : `s-${slug(st.name)}`;
    (packets[packet] ??= []).push(rec);
    console.log(`${packet.padEnd(48)} ${id} p${s.page_number} ${String(b.language).padEnd(10)} ${pgs.map((p) => p.exposure).join(',')} ${String(b.title).slice(0, 40)}`);
  }
}
await client.close();

// The pilot (one book per stratum) splits into reviewer-sized packets of ≤ 10.
const pilot = packets.pilot ?? [];
delete packets.pilot;
for (let k = 0; k * 10 < pilot.length; k++) packets[`pilot-${k + 1}`] = pilot.slice(k * 10, (k + 1) * 10);

mkdirSync(join(OUT, 'packets'), { recursive: true });
// What a reviewer reads: no stratum, lane or exposure (the lane names the engine; the reviewer is told the models anyway, but not the stratum).
const forReviewer = (r) => ({ ...r, stratum: undefined, lane: undefined, pages: r.pages.map((p) => ({ ...p, exposure: undefined })) });
for (const [name, recs] of Object.entries(packets)) writeFileSync(join(OUT, 'packets', `${name}.json`), JSON.stringify(recs.map(forReviewer), null, 1));
writeFileSync(join(OUT, 'sample.json'), JSON.stringify(sample, null, 1));
writeFileSync(join(OUT, 'screen.json.gz'), gzipSync(JSON.stringify(screen)));
let sha = null;
try { sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
writeFileSync(join(OUT, 'draw-log.json'), JSON.stringify({ issue: 6691, mode: 'served-audit', seed: SEED, frame_size: frame.length, screened: order.length,
  screened_ok: ok.length, rejected: screen.filter((s) => s.rejected).length, per_stratum: PER, min_cell: MIN, pilot_per_stratum: PILOT,
  rng: 'mulberry32 (paired-stats makeRng); books seed, page uniform seed ^ 0x9e3779b9, drawn in order before any query',
  code_sha: sha, packets: Object.fromEntries(Object.entries(packets).map(([k, v]) => [k, v.map((r) => r.book_id)])), strata }, null, 1));
console.log(`wrote ${OUT}: ${sample.length} books, ${strata.length} strata, packets ${Object.keys(packets).join(' ')}`);
