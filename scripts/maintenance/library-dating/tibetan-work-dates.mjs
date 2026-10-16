#!/usr/bin/env node
/**
 * Tibetan WORK dates (#6721, Derek 2026-10-15: "we are looking for dates of the works, not the editions ... use the
 * title page ... author lifespan, no problem. a range is fine. the tibetan are all at 1700"). The lean run gave 2,333 of
 * the 2,343 Tibetan books a bare catalogue-only model estimate of the work. This replaces it with the first that holds:
 *
 *   colophon        — the closing leaves state when the text was COMPOSED: words verified against the OCR, the rab byung
 *                     year converted by rabjungYears() (scripts/lib/date-works.mjs), not by the model. With no cycle
 *                     number, the cycle is the one inside the author's dated window (else the one inside the model's
 *                     window, at confidence medium); ambiguous → not used.
 *   catalogue       — BDRC's AuthoredEvent on the work (WA…) the book's BDRC instance belongs to
 *   author_lifespan — the author's BDRC dates, [birth + 15, death] (authorWindow()): the main author on BDRC's work
 *                     record, else the author the colophon or title names (the model reads the name; the words must be
 *                     in the OCR, title or catalogue; the name must match exactly one BDRC person — Wikidata's 19K
 *                     BDRC-linked people are the name index — or the one whose dates meet the model's)
 *   canonical       — a Kangyur/Tengyur text: the Indian composition window (basis model_knowledge, rule canonical), and
 *                     the Tibetan translation window as its own `translation` layer; never the Derge carving or a reprint
 *   model           — the model's window from the record AND the leaves, confidence low, where it is narrower than
 *                     the stored estimate (else the stored estimate stays)
 *
 * The edition date is not touched. A work date after a sourced edition (title page, colophon, catalogue) is rejected.
 * `source_work_dates_meta.work_update` records the rule, the page, the reading and the previous work date.
 *
 * Steps (all files under <dir>):
 *   export   <dir>                 → tibetan.jsonl (record, description, BDRC ids, opening + closing leaves) READ-ONLY
 *   (model)  date-books.mjs <dir>/tibetan.jsonl <dir>/readings.jsonl --engine claude --model sonnet --lean tibetan
 *   persons  <dir> --names wd_bdrc_names.tsv → persons.txt (BDRC person ids to fetch: bdrc-dates.mjs --persons)
 *   resolve  <dir> --names … --bdrc bdrc-cache.json → resolved.jsonl + a summary
 *   write    <dir> <run_id> [--dry-run] [--only ids.txt]   (sweep_log first; edited_by skipped; never `published`)
 *
 * PRIOR ART: write-dates.mjs (the lean writer: whole-row writes from a plan, not a work-only update), bdrc-dates.mjs
 * (extended here for scan ids, AuthoredEvent and roles), export-books.mjs --tail (1,200 chars of closing text, no
 * page numbers to link a colophon to), date-works.mjs (authorWindow, lifespan display, fitWindow — reused).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/tibetan-work-dates.mjs <step> <dir> …
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { stripEditorialWrappers } from '../../lib/strip-editorial-wrappers.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { recordSweepActions } from '../../lib/sweep-log.mjs';
import { authorWindow, fitWindow, rabjungYears, rabjungLabel, TIBETAN_PROMPT_VERSION, elementAnimalIn, statedCE } from '../../lib/date-works.mjs';

const [STEP, DIR, RUN_ID] = process.argv.slice(2, 5);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!STEP || !DIR) { console.error('usage: tibetan-work-dates.mjs export|persons|resolve|write <dir> [run_id] …'); process.exit(2); }
const F = (n) => path.join(DIR, n);
const readRows = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const TIBETAN = { pages_count: { $gt: 0 }, language: { $regex: 'tibet', $options: 'i' } };
const clean = (t) => stripMarkupTags(stripEditorialWrappers(t || '') || '', ' ').replace(/\s+/g, ' ').trim();
const fmtYear = (y) => (y < 0 ? `${-y} BCE` : String(y));
const fmtSpan = (a, b) => (a === b ? fmtYear(a) : a < 0 && b < 0 ? `${-a}–${-b} BCE` : `${fmtYear(a)}–${fmtYear(b)}`);

/** Letters, marks and digits only (Tibetan vowel signs are marks: loose() would drop them), Tibetan digits as ASCII. */
export const norm = (s) => String(s || '').normalize('NFC').replace(/[༠-༩]/g, (d) => String(d.charCodeAt(0) - 0x0F20)).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
/** The words are in the text (normalised), and long enough to mean something. */
export const quoted = (x, text) => { const q = norm(x); return q.length >= 5 && norm(text).includes(q); };

const idFilter = (id) => (/^[0-9a-f]{24}$/i.test(id) ? { $or: [{ id }, { _id: new ObjectId(id) }] } : { $or: [{ id }, { _id: id }] });

async function db() { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return { c, d: c.db(process.env.MONGODB_DB || 'bookstore') }; }

// ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────
if (STEP === 'export') {
  const { c, d } = await db();
  const books = await d.collection('books').find(TIBETAN, { projection: { id: 1, title: 1, original_title: 1, display_title: 1, author: 1, author_id: 1, published: 1,
    pages_count: 1, catalog_metadata: 1, 'image_source.source_url': 1, 'image_source.provider': 1, catalog_ids: 1, source_work_dates_meta: 1, source_work_dates: 1 } }).toArray();
  const out = []; let withTail = 0;
  for (let i = 0; i < books.length; i += 100) {
    const chunk = books.slice(i, i + 100);
    const ids = chunk.map((b) => String(b.id || b._id));
    const pages = await d.collection('pages').find({ $or: chunk.map((b) => ({ book_id: String(b.id || b._id), $or: [{ page_number: { $lte: 4 } }, { page_number: { $gt: (b.pages_count || 0) - 4 } }] })),
      'ocr.data': { $type: 'string', $ne: '' }, 'ocr.unreadable': { $ne: true } },
    { projection: { _id: 0, book_id: 1, page_number: 1, text: { $substrCP: ['$ocr.data', 0, 4000] } }, maxTimeMS: 120_000 }).toArray();
    const by = new Map(ids.map((x) => [x, []])); for (const p of pages) by.get(p.book_id)?.push(p);
    for (const b of chunk) {
      const id = String(b.id || b._id); const ps = by.get(id).sort((x, y) => x.page_number - y.page_number);
      const pc = b.pages_count || 0;
      const lead = ps.filter((p) => p.page_number <= Math.min(4, pc - 3)).map((p) => `[page ${p.page_number}] ${clean(p.text).slice(0, 400)}`).join(' ');
      const tailPages = ps.filter((p) => p.page_number > pc - 4).slice(-3).map((p) => ({ page_number: p.page_number, text: clean(p.text).slice(-1400) }));
      if (tailPages.length) withTail++;
      const cm = b.catalog_metadata || {};
      const description = (cm.metadata_pairs || []).filter((p) => /description|summary|note|author|creator|date/i.test(p.label || '')).map((p) => `${p.label}: ${p.value}`).join(' | ')
        || [cm.description, cm.notes].flat().filter(Boolean).join(' | ');
      const bdrc = String(b.image_source?.source_url || '').match(/bdr:(M?W\w+)/)?.[1] || b.catalog_ids?.bdrc_instance || null;
      out.push(JSON.stringify({ book_id: id, title: b.display_title || null, original_title: b.title || b.original_title || null, author: b.author || null, author_id: b.author_id || null,
        published: b.published ?? null, pages_count: pc, provider: b.image_source?.provider || null, bdrc, description: String(description || '').slice(0, 800), lead,
        tail: tailPages.map((p) => `[page ${p.page_number}] ${p.text}`).join('\n').slice(-1500), tail_pages: tailPages,
        prev_work: b.source_work_dates_meta?.work || null, edition: b.source_work_dates_meta?.edition || null, edited_by: b.source_work_dates_meta?.edited_by || null }));
    }
  }
  await c.close();
  fs.writeFileSync(F('tibetan.jsonl'), out.join('\n') + '\n');
  console.log(`${books.length} Tibetan books exported, ${withTail} with closing text → ${F('tibetan.jsonl')}`);
  process.exit(0);
}

// ── the name index: Wikidata's BDRC-linked people (label/alias → P ids), and BDRC's own person names ──────────────
function nameIndex(tsv, bd) {
  const idx = new Map(); const namesOf = new Map();
  const add = (name, p) => { const k = norm(name).replace(/^(slobdpon|mkhanpo|bla ma|rjebtsun)/, ''); if (k.length < 4) return; if (!idx.has(k)) idx.set(k, new Set()); idx.get(k).add(p); if (!namesOf.has(p)) namesOf.set(p, new Set()); namesOf.get(p).add(k); };
  if (tsv && fs.existsSync(tsv)) for (const l of fs.readFileSync(tsv, 'utf8').split('\n').slice(1)) {
    const [, id, lab] = l.split('\t'); if (!id || !lab) continue;
    const p = id.replace(/"/g, ''); const name = lab.replace(/^"(.*)"@[\w-]+$/, '$1');
    add(name, p);
  }
  for (const [p, rec] of Object.entries(bd?.persons || {})) for (const n of rec.names || []) add(n, p);
  return { idx, namesOf };
}
// a window wider than a century says nothing about the work (a birth known only to its century: "1915–2084")
const personWindow = (bd, p) => { const r = bd?.persons?.[p]; const w = r ? authorWindow({ P569: r.birth, P570: r.death, P1317: r.floruit }) : null; return w && w.to - w.from <= 100 && w.from <= 2026 ? w : null; };
const AUTHOR_ROLES = new Set(['author', 'terton', 'compiler']);

/** The BDRC person the model's reading names, or { candidates } when it cannot be told apart. */
function matchAuthor(r, b, { idx, namesOf }, bd) {
  if (!r || !AUTHOR_ROLES.has(r.role)) return { why: 'no_author' };
  const shown = [b.original_title, b.title, b.author, b.description, b.lead, b.tail].filter(Boolean).join(' ');
  if (!r.a_x || !quoted(r.a_x, shown)) return { why: 'name_not_in_text' };
  const keys = [r.a_bo, r.a_wy, r.a_en].map(norm).filter((k) => k.length >= 4);
  const cands = new Set(); for (const k of keys) for (const p of idx.get(k) || []) cands.add(p);
  // a BDRC id the model gave counts only if that person carries one of the names
  if (r.bdrc && keys.some((k) => namesOf.get(r.bdrc)?.has(k))) cands.add(r.bdrc);
  if (!cands.size) return { why: 'no_bdrc_match', keys };
  const dated = [...cands].map((p) => ({ p, w: personWindow(bd, p) }));
  const known = dated.filter((x) => x.w);
  let pick = null;
  if (r.a_d) { const ok = known.filter((x) => x.w.from - 15 <= r.a_d[1] + 10 && x.w.to >= r.a_d[0] - 10); if (ok.length === 1) pick = ok[0]; else if (ok.length > 1) return { why: 'ambiguous', candidates: ok.map((x) => x.p) }; }
  // no dates from the model = it does not know who this is: one index hit on a common name ("Sonam Senge" → the one
  // who died in 1253, for a text that may be Gorampa's) is not an identification
  else return { why: 'unrecognised_name', candidates: [...cands] };
  if (!pick) return { why: known.length ? 'ambiguous_or_disagrees' : 'no_dates', candidates: [...cands] };
  return { p: pick.p, w: pick.w };
}

// ── persons: the BDRC ids to fetch dates for ─────────────────────────────────────────────────────────────────────
const readings = new Map(); for (const r of readRows(F('readings.jsonl'))) readings.set(r.book_id, r);
if (STEP === 'persons') {
  const ni = nameIndex(arg('--names'), null);
  const want = new Set();
  for (const b of readRows(F('tibetan.jsonl'))) {
    const r = readings.get(b.book_id)?.reading; if (!r) continue;
    for (const k of [r.a_bo, r.a_wy, r.a_en].map(norm)) for (const p of ni.idx.get(k) || []) want.add(p);
    if (r.bdrc) want.add(r.bdrc);
  }
  fs.writeFileSync(F('persons.txt'), [...want].join('\n') + '\n');
  console.log(`${want.size} BDRC persons to fetch → ${F('persons.txt')}`);
  process.exit(0);
}

// ── resolve ──────────────────────────────────────────────────────────────────────────────────────────────────────
const SOURCED_EDITION = new Set(['title_page', 'colophon', 'catalogue']);
const pageOf = (b, x) => (b.tail_pages || []).find((p) => quoted(x, p.text))?.page_number ?? null;
const win = (from, to, basis, evidence, display) => fitWindow({ year: Math.round((from + to) / 2), from, to, display: display || (from === to ? fmtYear(from) : fmtSpan(from, to)), precision: from === to ? 'exact' : 'range', basis, evidence });
const WINDOW_WHAT = { lifespan: "the author's adult life", work_period: "the author's working years", floruit: 'around the author’s floruit', death_only: "before the author's death", birth_only: "the author's likely working life" };

export function resolveBook(b, rr, bd, ni) {
  const r = rr?.reading || null; const out = { book_id: b.book_id, checks: [] };
  const edTo = b.edition && SOURCED_EDITION.has(b.edition.basis) ? b.edition.to : null;
  const fits = (w) => w && (edTo == null || w.from <= edTo);
  const cap = (w) => (edTo != null && w.to > edTo ? { ...w, to: edTo } : w);

  // BDRC: the work record's AuthoredEvent and main author
  const mw = bd?.book_instance?.[b.book_id]; const wa = (mw && bd.instances?.[mw]?.work) || (b.bdrc && bd?.scans?.[b.bdrc]?.work) || null;
  const work = wa ? bd.works?.[wa] : null;
  let bdrcAuthored = null; if (work?.authored) { const [f, t] = work.authored; if (fits({ from: f })) bdrcAuthored = win(f, Math.min(t, edTo ?? t), 'catalogue', `bdr:${wa} AuthoredEvent ${fmtSpan(f, t)}`); }
  let bdrcAuthor = null;
  for (const cr of work?.creators || []) {
    const role = String(bd.roles?.[cr.role] || '').toLowerCase();
    if (!/author|tert|compiler|commentator/.test(role) || /translat|attribut|scribe|editor|source language/.test(role)) continue;
    const w = personWindow(bd, cr.person); if (w && fits(w)) { bdrcAuthor = { p: cr.person, w, role }; break; }
  }
  // the colophon/title author
  const m = r ? matchAuthor(r, b, ni, bd) : { why: 'no_reading' };
  out.author_match = m.p ? { p: m.p, window: m.w } : { why: m.why, candidates: m.candidates };
  // a tertön revealed treasure texts from the 11th century on: an earlier "tertön" is the attributed figure (Padmasambhava)
  const tertonOk = !(r?.role === 'terton' && m.w && m.w.from < 1000);
  if (!tertonOk) out.checks.push('terton_before_1000');
  const author = bdrcAuthor ? { ...bdrcAuthor, src: 'bdrc_work' } : m.p && fits(m.w) && tertonOk ? { p: m.p, w: m.w, src: 'colophon_or_title' } : null;
  if (m.p && !fits(m.w)) out.checks.push('author_after_edition');

  // the colophon year. The model only names what the words say; each part is checked against the words themselves: a
  // cycle number only where they say rab byung (the pilot run's model supplied one for 15 of 51 that never did), the
  // element and animal only where their syllables are in the quote, a CE year only after phyi lo / spyi lo
  let colo = null;
  const words = r?.y_x || '';
  const said = r && words && r.y_what === 'composition' && quoted(words, b.tail || '');
  if (r?.y_x && r.y_what === 'composition' && !said) out.checks.push('year_not_in_text');
  const ce = said ? statedCE(words) : null;
  const ageSaid = said && r.age && /(རང་|དགུང་)/.test(words);
  const birth = author ? bd.persons?.[author.p]?.birth : null;
  if (ce && fits({ from: ce })) {
    const lab = r.el && r.an && elementAnimalIn(words, r.el, r.an) ? rabjungYears({ element: r.el, animal: r.an }, ce - 1, ce + 1) : null;
    if (lab && !lab.length) out.checks.push('ce_contradicts_cycle_year');
    else colo = { work: win(ce, ce, 'colophon', words.slice(0, 200), String(ce)), page: pageOf(b, words), conf: 'high', firm: true };
  } else if (ageSaid && birth && birth[0] === birth[1]) {
    // the author's age when composing, with an exactly known birth year: birth + age − 1 (Tibetan age counts from one)
    const y = birth[0] + r.age - 1;
    if (fits({ from: y }) && y <= author.w.to) colo = { work: win(y, y, 'colophon', words.slice(0, 200), `${y} (the author, b. ${birth[0]}, at age ${r.age})`), page: pageOf(b, words), conf: 'high', firm: true };
  } else if (said && r.el && r.an) {
    if (!elementAnimalIn(words, r.el, r.an)) out.checks.push('element_animal_not_in_words');
    else {
      const cyc = r.cyc > 0 && /རབ་བྱུང|བར་བྱུང|rab ?byung/i.test(words) ? r.cyc : null;
      let years = rabjungYears({ cycle: cyc, element: r.el, animal: r.an }, 1027, edTo ?? 2030);
      let how = cyc ? `rab byung ${cyc}` : null; let conf = 'high';
      if (years.length > 1 && author) { years = years.filter((y) => y >= author.w.from - 15 && y <= author.w.to); how = `cycle not stated: the one in the author's life (bdr:${author.p})`; }
      else if (years.length > 1 && rr?.work) { years = years.filter((y) => y >= rr.work.from && y <= rr.work.to); how = 'cycle not stated: the one in the estimated window'; conf = 'low'; }
      if (years.length === 1 && fits({ from: years[0] }) && (!author || (years[0] >= author.w.from - 15 && years[0] <= author.w.to))) {
        const y = years[0];
        colo = { work: win(y, y, 'colophon', words.slice(0, 200), `${y} (${rabjungLabel(y)} year${how ? `; ${how}` : ''})`), page: pageOf(b, words), conf, firm: !!cyc };
      } else out.checks.push(years.length > 1 ? 'colophon_cycle_ambiguous' : 'colophon_year_unusable');
    }
  } else if (said) out.checks.push('colophon_year_unusable');

  let pick = null;
  if (colo?.firm) pick = { work: colo.work, rule: 'colophon', confidence: colo.conf, page: colo.page };
  else if (bdrcAuthored) pick = { work: bdrcAuthored, rule: 'bdrc_authored', confidence: 'high' };
  else if (colo) pick = { work: colo.work, rule: 'colophon', confidence: colo.conf, page: colo.page };
  else if (author) {
    const w = cap(author.w);
    if (w.to >= w.from) pick = { work: win(w.from, w.to, 'author_lifespan', `bdr:${author.p} ${author.w.how}`, `${fmtSpan(w.from, w.to)}, ${WINDOW_WHAT[author.w.how]}`), rule: `lifespan_${author.src}`, confidence: author.src === 'bdrc_work' ? 'high' : 'medium', author_window: { ...author.w, src: `bdr:${author.p}` } };
  }
  // the title names the canon more reliably than the model does (a Tengyur volume read as Kangyur in the pilot)
  const t = `${b.original_title || ''} ${b.title || ''}`;
  const titleCanon = /bstan[ -]?'?gyur|tanjur|tengyur|བསྟན་འགྱུར/i.test(t) ? 'tengyur' : /bka'?[ -]?'?gyur|kanjur|kangyur|བཀའ་འགྱུར/i.test(t) ? 'kangyur' : null;
  const canon = r && (titleCanon || r.canon !== 'none') ? { ...r, canon: titleCanon || r.canon } : null;
  if (!pick && canon?.ind && fits({ from: canon.ind[0] })) {
    pick = { work: win(canon.ind[0], canon.ind[1], 'model_knowledge', '', `c. ${fmtSpan(canon.ind[0], canon.ind[1])}, Indian composition`), rule: `canonical_${canon.canon}`, confidence: 'medium' };
  }
  // nothing sourced: the model's window from the record AND the leaves, but only where it is narrower than the estimate
  // already stored (a second guess is not better for being second: Dechen Lingpa's terma, 1600–1700 → 1700–1900)
  const prev = b.prev_work;
  if (!pick && rr?.work && !(prev && prev.basis === 'model_knowledge' && rr.work.to - rr.work.from >= prev.to - prev.from)) pick = { work: { ...rr.work }, rule: 'model', confidence: 'low' };
  if (!pick) return { ...out, pick: null };
  if (canon?.tib) pick.translation = { from: canon.tib[0], to: canon.tib[1] };
  if (pick.page) pick.page_url = `https://sourcelibrary.org/book/${b.book_id}?page=${pick.page}`;
  return { ...out, pick, reading: r, prev_work: b.prev_work };
}

if (STEP === 'resolve') {
  const bd = JSON.parse(fs.readFileSync(arg('--bdrc'), 'utf8'));
  const ni = nameIndex(arg('--names'), bd);
  const rows = readRows(F('tibetan.jsonl')); const out = []; const tally = {}; const why = {};
  for (const b of rows) {
    if (b.edited_by) continue;
    const res = resolveBook(b, readings.get(b.book_id), bd, ni);
    out.push(JSON.stringify(res));
    const k = res.pick?.rule || 'none'; tally[k] = (tally[k] || 0) + 1;
    const wk = res.author_match?.why || 'matched'; why[wk] = (why[wk] || 0) + 1;
  }
  fs.writeFileSync(F('resolved.jsonl'), out.join('\n') + '\n');
  console.log(JSON.stringify({ books: rows.length, readings: readings.size, by_rule: tally, author_match: why }, null, 1));
  process.exit(0);
}

// ── write ────────────────────────────────────────────────────────────────────────────────────────────────────────
if (STEP === 'write') {
  if (!RUN_ID) { console.error('write needs a run_id'); process.exit(2); }
  const DRY = process.argv.includes('--dry-run');
  const only = arg('--only') ? new Set(fs.readFileSync(arg('--only'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) : null;
  const todo = readRows(F('resolved.jsonl')).filter((x) => x.pick && (!only || only.has(x.book_id)));
  const { c, d } = await db(); const books = d.collection('books');
  const stats = { written: 0, human: 0, missing: 0, same: 0 }; const diffs = [];
  for (let i = 0; i < todo.length; i += 200) {
    const batch = todo.slice(i, i + 200);
    const live = await books.find({ $or: batch.flatMap((t) => idFilter(t.book_id).$or) }, { projection: { id: 1, source_work_dates: 1, source_work_dates_meta: 1 } }).toArray();
    const byId = new Map(); for (const x of live) { byId.set(String(x._id), x); if (x.id) byId.set(String(x.id), x); }
    const go = [];
    for (const t of batch) {
      const cur = byId.get(t.book_id);
      if (!cur) { stats.missing++; continue; }
      const meta = cur.source_work_dates_meta || {};
      if (meta.edited_by) { stats.human++; continue; }
      if (meta.work_update?.run_id === RUN_ID && JSON.stringify(meta.work) === JSON.stringify(t.pick.work)) { stats.same++; continue; }
      const w = t.pick.work;
      const prec = w.from === w.to ? 'exact' : w.to - w.from <= 10 ? 'decade' : w.to - w.from <= 150 ? 'century' : 'millennium';
      const compLayer = { type: 'composition', date: String(w.year), date_display: w.display, date_precision: prec, basis: w.basis, evidence: w.evidence || '' };
      if (t.reading?.a_en && t.author_match?.p) compLayer.author = t.reading.a_en.slice(0, 120);
      const layers = [compLayer];
      if (t.pick.translation) { const tr = t.pick.translation; layers.push({ type: 'translation', date: String(Math.round((tr.from + tr.to) / 2)), date_display: `c. ${fmtSpan(tr.from, tr.to)}`, date_precision: tr.to - tr.from <= 150 ? 'century' : 'millennium', language: 'Tibetan', basis: 'model_knowledge', evidence: '' }); }
      // every other layer stays (the edition above all); the old composition/compilation (and, for a canonical text, translation) layers go
      for (const l of cur.source_work_dates || []) if (!['composition', 'compilation'].includes(l.type) && !(t.pick.translation && l.type === 'translation')) layers.push(l);
      const newMeta = { ...meta, work: w, confidence: t.pick.confidence,
        work_update: { run_id: RUN_ID, rule: t.pick.rule, prompt_version: TIBETAN_PROMPT_VERSION, at: new Date(), previous_work: meta.work ?? null, previous_confidence: meta.confidence ?? null,
          ...(t.pick.page ? { page: t.pick.page } : {}), ...(t.author_match?.p ? { author_bdrc: `bdr:${t.author_match.p}` } : {}),
          ...(t.reading ? { reading: { author: t.reading.a_en || t.reading.a_wy || '', role: t.reading.role, author_words: t.reading.a_x, year_words: t.reading.y_x, year_what: t.reading.y_what, canon: t.reading.canon } } : {}) } };
      if (t.pick.author_window) newMeta.author_window = t.pick.author_window;
      if (t.checks?.length) newMeta.work_update.checks = t.checks;
      go.push({ t, cur, set: { source_work_dates: layers, source_work_dates_meta: newMeta } });
    }
    if (DRY) { if (!diffs.length) for (const g of go.slice(0, 50)) diffs.push({ book_id: g.t.book_id, before: g.cur.source_work_dates_meta?.work, after: g.set.source_work_dates_meta.work, rule: g.t.pick.rule }); stats.written += go.length; continue; }
    if (!go.length) continue;
    await recordSweepActions(d, go.map(({ t, cur }) => ({ sweep: 'library-dating', book_id: t.book_id, action: 'date-work',
      detail: { run_id: RUN_ID, rule: t.pick.rule, previous: { source_work_dates: cur.source_work_dates ?? null, source_work_dates_meta: cur.source_work_dates_meta ?? null } } })));
    const res = await books.bulkWrite(go.map(({ cur, set }) => ({ updateOne: { filter: { _id: cur._id, 'source_work_dates_meta.edited_by': { $exists: false } }, update: { $set: set } } })), { ordered: false });
    stats.written += res.modifiedCount;
    console.log(`  ${i + batch.length}/${todo.length}: ${JSON.stringify(stats)}`);
  }
  if (DRY) fs.writeFileSync(F('dry-run-diff.json'), JSON.stringify(diffs, null, 1));
  await c.close();
  console.log(`done ${JSON.stringify(stats)}${DRY ? ' (dry run)' : ''}`);
  process.exit(0);
}
console.error(`unknown step ${STEP}`); process.exit(2);
