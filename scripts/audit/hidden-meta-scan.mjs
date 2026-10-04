#!/usr/bin/env node
// PRIOR ART: scripts/audit/page-integrity.mjs — its truncation and hidden-translation checks flag
// a page whose translation is short or sits in a wrapper; neither says what the words after the
// continuity marker ARE (this page's own text, the previous page's, or a duplicate of the visible
// body), which is what decides the repair. This walk parses only the pages that carry the marker,
// so the whole mirror takes minutes.
/**
 * hidden-meta-scan — every translated page whose continuity <meta> carries text, over the local
 * corpus mirror (~/sl-corpus/books/*.jsonl), with the evidence a repair needs (#5376 tq11).
 * MEASUREMENT ONLY: writes files, touches no store.
 *
 * Per page with `<meta>continues from previous page: TEXT</meta>` it records how much of the page
 * the meta holds, and where TEXT comes from:
 *   inPrev   share of TEXT's word trigrams found in the previous page's translation (the
 *            continuity context handed back)
 *   inBody   share found in this page's own visible body (a hidden duplicate of shown text)
 *   rShown / rAll   visible-body length and visible+hidden length, each over the OCR's reading
 *            length; compared with the language's median ratio they say whether the page is
 *            short without TEXT and whole with it
 *   cog      cognates: the share of TEXT's long words whose folded 5-letter prefix opens a word
 *            in the HEAD of this page's OCR, and in the TAIL of the previous page's ("substance"
 *            / "substantia"). Latin and the Romance languages share enough stems with English
 *            for the difference between the two to say which page TEXT translates; a source in
 *            another script gives no signal and the page is left to the other evidence
 *   anchors  numbers and proper names in TEXT, looked up the same way in each whole page
 *   enOwn / enPrev   for a source the translator modernises rather than translates (English),
 *            TEXT's trigram share in this page's OCR and in the previous page's
 * `--summarize` turns those into a repair class per page (classify()) and a plan.
 *
 * Checkpointed per book: a book's rows and its `book` row are appended in ONE write; a restart
 * skips every book that already has a `book` row in its shard file.
 *
 * Usage:
 *   node scripts/audit/hidden-meta-scan.mjs [--shard=k/n] [--limit=N] [--dir=~/sl-corpus/books]
 *        [--out=scripts/output/hidden-meta]
 *   node scripts/audit/hidden-meta-scan.mjs --summarize [--out=…]   → <out>/summary.json, repair-list.jsonl
 *   node --env-file=.env.production.local scripts/audit/hidden-meta-scan.mjs --live [--min-share=0.2] [--out=…]
 *        → <out>/live-check.jsonl, live-summary.json: the repair candidates re-read from the LIVE pages
 *          (the mirror is days old; #5148's unwrap and new translations move the ground). Read-only.
 *   node --env-file=.env.production.local scripts/audit/hidden-meta-scan.mjs --dry-run [--n=20] [--out=…]
 *        → <out>/dry-run.md: the repair each class implies, previewed on N live pages. Writes nothing.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readingLength, foldWord, sourceProse, translationProse } from '../lib/page-integrity.mjs';
import { continuityMeta, HIDDEN_META_WHOLE_PAGE_SHARE as META_WHOLE_PAGE_SHARE } from '../lib/hidden-translation.mjs';
import { pageLanguage } from './page-integrity.mjs';

export const META_PAYLOAD_MIN_WORDS = 8;  // fewer words after the marker are a phrase, not text to class
export const META_COPIED_SHARE = 0.6;     // trigram share at which the payload IS the other text

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k) => process.argv.includes(`--${k}`);

const MARKER_LINE = /continue[sd]?\s+from\s+(?:the\s+)?previous\s+page/i;
const SAMPLE_EVERY = 40; // translated pages parsed per book for the language length ratios

const tagless = (t) => String(t || '').replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
const words = (t) => String(t || '').split(/\s+/).map(foldWord).filter(Boolean);
const trigrams = (w) => { const g = new Set(); for (let i = 0; i + 3 <= w.length; i++) g.add(w.slice(i, i + 3).join(' ')); return g; };
const share = (mine, theirs) => { let n = 0; for (const g of mine) if (theirs.has(g)) n++; return mine.size ? n / mine.size : 0; };

const NOT_NAMES = new Set(['the', 'this', 'that', 'these', 'those', 'and', 'but', 'for', 'with', 'from', 'when', 'where', 'which', 'what',
  'there', 'then', 'thus', 'therefore', 'however', 'because', 'since', 'although', 'after', 'before', 'also', 'likewise', 'moreover',
  'they', 'their', 'there', 'here', 'hence', 'whence', 'first', 'second', 'third', 'chapter', 'book', 'page', 'lord', 'father', 'holy', 'saint']);

/** Numbers (2+ digits) and mid-sentence capitalised words in an English payload. */
export function anchorsOf(payload) {
  const out = new Set();
  const text = tagless(payload);
  for (const m of text.matchAll(/\d{2,}/g)) out.add(m[0]);
  for (const m of text.matchAll(/(^|[^\p{L}])(\p{Lu}\p{Ll}{3,})/gu)) {
    const before = text.slice(Math.max(0, m.index - 2), m.index + m[1].length);
    if (m.index === 0 || /[.!?:;"“]\s*$/.test(before)) continue; // sentence-initial: any word is capitalised there
    const f = foldWord(m[2]);
    if (f.length >= 4 && !NOT_NAMES.has(m[2].toLowerCase())) out.add(f);
  }
  return [...out];
}

/** Which anchors a source page carries: digits verbatim, names by a folded 5-letter prefix. */
export function anchorHits(anchors, ocr) {
  const prose = sourceProse(ocr);
  const pref = new Set();
  for (const w of words(prose)) { pref.add(w.slice(0, 5)); if (w.length >= 4) pref.add(w.slice(0, 4)); }
  const digits = new Set(prose.match(/\d{2,}/g) || []);
  return new Set(anchors.filter(a => /^\d+$/.test(a) ? digits.has(a) : pref.has(a.slice(0, Math.min(5, a.length)))));
}

const EN_LONG_STOP = new Set(['should', 'because', 'through', 'therefore', 'between', 'before', 'without', 'within', 'another', 'however',
  'although', 'themselves', 'himself', 'herself', 'itself', 'whether', 'against', 'neither', 'either', 'likewise', 'moreover', 'whence',
  'others', 'things', 'something', 'nothing', 'having', 'called', 'according', 'concerning', 'indeed', 'rather', 'always', 'already',
  'little', 'greater', 'second', 'people', 'little', 'around', 'toward', 'towards', 'during', 'whatever', 'whoever', 'thereof', 'wherein',
  'continues', 'continued', 'previous'].map(foldWord));

/** Long English words of a payload, folded — the ones that can have a cognate in the source. */
export const cognateWords = (payload) => [...new Set(words(tagless(payload)).filter(w => w.length >= 6 && !EN_LONG_STOP.has(w)))];

/** Share of `cw` whose 5-letter prefix opens some word of `sourceWords`. */
export function cognateShare(cw, sourceWords) {
  if (!cw.length || !sourceWords.length) return 0;
  const pref = new Set(sourceWords.map(w => w.slice(0, 5)));
  return cw.filter(w => pref.has(w.slice(0, 5))).length / cw.length;
}

const pOf = (line) => { const m = line.match(/^\{"p":(-?\d+)/); return m ? Number(m[1]) : null; };

export function evidence({ row, prev, bookLang }) {
  const cm = continuityMeta(row.tr);
  if (!cm) return null;
  const lang = pageLanguage(row, bookLang);
  const base = { p: row.p, lang, form: cm.form, words: cm.words };
  if (cm.form !== 'text') return base;
  const shownProse = translationProse(row.tr);
  const hidden = readingLength(cm.payload), shown = readingLength(shownProse);
  const hiddenShare = hidden / Math.max(1, hidden + shown);
  const ocrLen = readingLength(sourceProse(row.ocr));
  const out = {
    ...base, hidden, shown, share: +hiddenShare.toFixed(3),
    wholePage: cm.words >= META_PAYLOAD_MIN_WORDS && hiddenShare >= META_WHOLE_PAGE_SHARE,
    ocrLen, rShown: ocrLen ? +(shown / ocrLen).toFixed(3) : null, rAll: ocrLen ? +((shown + hidden) / ocrLen).toFixed(3) : null,
    hasPrev: !!(prev && prev.tr && prev.tr.trim()),
  };
  if (cm.words < META_PAYLOAD_MIN_WORDS) return out;
  const mine = trigrams(words(cm.payload));
  if (out.hasPrev) out.inPrev = +share(mine, trigrams(words(tagless(prev.tr)))).toFixed(2);
  out.inBody = +share(mine, trigrams(words(shownProse))).toFixed(2);
  const anchors = anchorsOf(cm.payload);
  const own = anchorHits(anchors, row.ocr), prv = prev?.ocr ? anchorHits(anchors, prev.ocr) : new Set();
  out.anchors = { n: anchors.length, ownOnly: [...own].filter(a => !prv.has(a)).length, prevOnly: [...prv].filter(a => !own.has(a)).length, both: [...own].filter(a => prv.has(a)).length };
  const cw = cognateWords(cm.payload);
  const win = Math.max(40, 2 * cm.words);
  const ownW = words(sourceProse(row.ocr)), prevW = prev?.ocr ? words(sourceProse(prev.ocr)) : [];
  out.cog = { n: cw.length, own: +cognateShare(cw, ownW.slice(0, win)).toFixed(2), prev: +cognateShare(cw, prevW.slice(-win)).toFixed(2) };
  if (lang === 'english') {
    out.enOwn = +share(mine, trigrams(words(sourceProse(row.ocr)))).toFixed(2);
    if (prev?.ocr) out.enPrev = +share(mine, trigrams(words(sourceProse(prev.ocr)))).toFixed(2);
  }
  out.text = cm.payload.slice(0, 240);
  return out;
}

function scanFile(file, id, bookLang) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const byP = new Map();
  const cand = [];
  let tr = 0;
  const samples = [];
  for (const line of lines) {
    if (!line) continue;
    const p = pOf(line);
    if (p == null || p <= 0) continue; // soft-hidden pages are not in the reading order
    byP.set(p, line);
    if (line.includes('"tr":""') || !line.includes('"tr":"')) continue;
    tr++;
    if (MARKER_LINE.test(line)) cand.push(p);
    else if (tr % SAMPLE_EVERY === 0) samples.push(p);
  }
  const parse = (p) => { const l = byP.get(p); if (!l) return null; try { return JSON.parse(l); } catch { return null; } };
  const out = [];
  const bk = { kind: 'book', book: id, lang: bookLang, trPages: tr, marker: 0, forms: {}, ratios: [] };
  for (const p of cand) {
    const row = parse(p);
    if (!row?.tr) continue;
    const ev = evidence({ row, prev: parse(p - 1), bookLang });
    if (!ev) continue;
    bk.marker++;
    bk.forms[ev.form] = (bk.forms[ev.form] || 0) + 1;
    if (ev.form === 'text') out.push({ kind: 'meta', book: id, ...ev });
  }
  for (const p of samples) {
    const row = parse(p);
    if (!row?.tr || !row.ocr) continue;
    const o = readingLength(sourceProse(row.ocr)), t = readingLength(translationProse(row.tr));
    if (o >= 300 && t > 0) bk.ratios.push([pageLanguage(row, bookLang), +(t / o).toFixed(3)]);
  }
  out.push(bk);
  return out;
}

function loadBooks(dir) {
  const meta = new Map();
  const f = path.join(path.dirname(dir), 'books.jsonl');
  if (!fs.existsSync(f)) return meta;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue;
    try { const b = JSON.parse(l); meta.set(String(b.id), { lang: b.language || 'unknown', visible: String(b.visible) === 'True' || b.visible === true, title: b.display_title || b.title || '' }); } catch { /* a torn line */ }
  }
  return meta;
}

function run(dir, outDir) {
  const [k, n] = arg('shard', '0/1').split('/').map(Number);
  const limit = Number(arg('limit', 0));
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `shard-${k}-of-${n}.jsonl`);
  const done = new Set();
  if (fs.existsSync(outFile)) for (const l of fs.readFileSync(outFile, 'utf8').split('\n')) { if (l.startsWith('{"kind":"book"')) { try { done.add(JSON.parse(l).book); } catch { /* torn tail */ } } }
  const meta = loadBooks(dir);
  let files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().filter((_, i) => i % n === k);
  if (limit) files = files.slice(0, limit);
  let seen = 0;
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    if (done.has(id)) continue;
    let rows;
    try { rows = scanFile(path.join(dir, f), id, meta.get(id)?.lang || 'unknown'); }
    catch (e) { rows = [{ kind: 'book', book: id, error: String(e.message || e).slice(0, 200) }]; }
    fs.appendFileSync(outFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    if (++seen % 2000 === 0) console.log(`shard ${k}/${n}: ${seen}/${files.length - done.size}`);
  }
  console.log(`shard ${k}/${n}: done, ${seen} books scanned, ${done.size} already had a row`);
}

// ── the repair class ─────────────────────────────────────────────────────────────────────────

export const SHORT_WITHOUT = 0.75; // visible body under this share of the language's usual length: the page is short
// A sentence ABOUT a page, not words from one: "The previous page was a blank endpaper", "this page
// begins the back matter", "keywords: …", "a philological discussion on …". The hand-read found
// these on near-empty leaves (whole-page flags under 40 words) and among the unclassed openings.
export const DESCRIPTION_RE = /^(?:(?:the|this) (?:previous |preceding |following |next )?(?:page|text|leaf|table|image|catalog|book|chapter|section|passage|account|list|poem|verse|entry)\b|(?:a|an) (?:page|table|list|catalog|discussion|description|summary|continuation|philological)\b|keywords?:|summary:|continuation of)/i;
export const MIN_OCR_FOR_LENGTH = 150;
export const LENGTH_MIN_SHARE = 0.2;
export const COG_MIN_WORDS = 4;
export const COG_MIN_SHARE = 0.3;
export const COG_MARGIN = 0.2;

/**
 * What the hidden words are, from the evidence row and the language's median length ratio `m`:
 *   'description'        a sentence about a page, not words from one: strip the payload
 *   'duplicate-of-body'  also in the visible body: strip the payload, nothing is lost
 *   'copied-previous'    the previous page's translation handed back: strip the payload
 *   'own-text'           this page's own lines: move them out of the meta into the body
 *   'not-this-page'      they translate the END of the previous page's source, or the page is
 *                        whole without them: a lead-in this page's source does not have (strip)
 *   'undecided'          the evidence does not settle it (re-translate, or read by eye)
 *   'short'              under META_PAYLOAD_MIN_WORDS: too few words to class
 */
export function classify(r, m) {
  if (r.words < META_PAYLOAD_MIN_WORDS) return 'short';
  if (DESCRIPTION_RE.test(r.text || '')) return 'description';
  if ((r.inBody ?? 0) >= META_COPIED_SHARE) return 'duplicate-of-body';
  if ((r.inPrev ?? 0) >= META_COPIED_SHARE) return 'copied-previous';
  const a = r.anchors || { ownOnly: 0, prevOnly: 0 };
  if (r.enOwn != null) {
    if (r.enOwn >= 0.5 && r.enOwn > (r.enPrev ?? 0)) return 'own-text';
    if ((r.enPrev ?? 0) >= 0.5 && (r.enPrev ?? 0) > r.enOwn) return 'not-this-page';
  }
  const c = r.cog;
  if (c && c.n >= COG_MIN_WORDS) {
    if (c.own >= COG_MIN_SHARE && c.own - c.prev >= COG_MARGIN) return 'own-text';
    if (c.prev >= COG_MIN_SHARE && c.prev - c.own >= COG_MARGIN) return 'not-this-page';
  }
  // Length says something only when the payload is a visible share of the page: a page varies
  // around its language's usual ratio by more than a one-line payload moves it.
  const canMeasure = m && r.ocrLen >= MIN_OCR_FOR_LENGTH && r.rShown != null && r.share >= LENGTH_MIN_SHARE;
  if (canMeasure) {
    const nShown = r.rShown / m, nAll = r.rAll / m;
    const closerWith = Math.abs(Math.log(Math.max(nAll, 1e-3))) < Math.abs(Math.log(Math.max(nShown, 1e-3)));
    if (nShown < SHORT_WITHOUT && closerWith && a.prevOnly <= a.ownOnly) return 'own-text';
    if (nShown >= SHORT_WITHOUT && !closerWith && a.ownOnly <= a.prevOnly) return 'not-this-page';
  }
  if (a.ownOnly >= 2 && a.prevOnly === 0) return 'own-text';
  if (a.prevOnly >= 2 && a.ownOnly === 0) return 'not-this-page';
  return 'undecided';
}

// ── the repair each class implies, as pure text functions (preview only — no writer here) ──────

export const BARE_MARKER = '<meta>continues from previous page</meta>';

/** The continuity meta reduced to the bare marker: for a payload that is a duplicate, the previous
 *  page's text, or a description. Nothing a reader sees changes. */
export function stripContinuityPayload(tr) {
  const cm = continuityMeta(tr);
  if (!cm || cm.form !== 'text') return { text: tr, changed: false };
  return { text: String(tr).replace(cm.raw, () => BARE_MARKER), changed: true };
}

/** The payload moved out of the meta into the body, inline tags kept: for the page's own text.
 *  It becomes the paragraph after the marker; when it ends mid-sentence and the body goes on in
 *  lower case, the two are joined with a space instead of a paragraph break. */
export function moveContinuityPayload(tr) {
  const cm = continuityMeta(tr);
  if (!cm || cm.form !== 'text') return { text: tr, changed: false };
  const t = String(tr);
  const after = t.slice(cm.index + cm.raw.length);
  const body = after.replace(/^\s+/, '');
  const open = !/[.!?:;"”’)\]]\s*$/.test(cm.inner) && /^[\p{Ll}]/u.test(body.replace(/^(?:<\/?[a-zA-Z][^>]*>\s*)*/, ''));
  const joined = open ? `${cm.inner} ${body}` : `${cm.inner}\n\n${body}`;
  return { text: t.slice(0, cm.index) + BARE_MARKER + '\n\n' + joined, changed: true };
}

/** What the class implies for the page. */
export const REPAIR_FOR = { 'own-text': 'move', 'copied-previous': 'strip', 'duplicate-of-body': 'strip', description: 'strip', 'not-this-page': 'strip', undecided: 'judge-or-retranslate', short: 'leave' };

async function mongo() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  return { c, pages: c.db(process.env.MONGODB_DB || 'bookstore').collection('pages') };
}

/** Re-read the candidates from the live pages. A candidate is any judged row with share ≥ minShare,
 *  or any row the classifier marks as this page's own text (those are the move candidates). */
async function live(outDir, minShare) {
  const rows = fs.readFileSync(path.join(outDir, 'repair-list.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(r => r.share >= minShare || r.cls === 'own-text');
  const byBook = new Map();
  for (const r of rows) (byBook.get(r.book) || byBook.set(r.book, []).get(r.book)).push(r);
  const { c, pages } = await mongo();
  const outFile = path.join(outDir, 'live-check.jsonl');
  fs.writeFileSync(outFile, '');
  const tally = { candidates: rows.length, books: byBook.size, found: 0, missing: 0, same: 0, changed: 0, unwrapped: 0, human: 0, hiddenPage: 0, stillText: 0, nowBare: 0, byClass: {} };
  let n = 0;
  for (const [book, rs] of byBook) {
    const docs = await pages.find({ book_id: book, page_number: { $in: rs.map(r => r.p) } },
      { projection: { id: 1, page_number: 1, hidden: 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.unwrapped_by': 1, 'translation.updated_at': 1, 'translation.content_hash': 1, 'translation.prompt_version': 1, 'translation.model': 1 }, maxTimeMS: 60000 }).toArray();
    const byP = new Map(docs.map(d => [d.page_number, d]));
    const lines = [];
    for (const r of rs) {
      const d = byP.get(r.p);
      const t = d?.translation || {};
      const cm = d ? continuityMeta(t.data) : null;
      const row = { book, p: r.p, id: d?.id ?? null, cls: r.cls, sev: r.sev, words: r.words, found: !!d, hidden: d?.hidden === true, source: t.source ?? null, human: !!(t.source === 'manual' || t.edited_by), unwrapped_by: t.unwrapped_by ?? null, prompt_version: t.prompt_version ?? null, model: t.model ?? null, updated_at: t.updated_at ?? null, liveWords: cm?.words ?? 0, liveForm: cm?.form ?? null, sameAsMirror: !!d && (cm?.words ?? 0) === r.words };
      tally[d ? 'found' : 'missing']++;
      if (d) {
        tally[row.sameAsMirror ? 'same' : 'changed']++;
        if (row.unwrapped_by) tally.unwrapped++;
        if (row.human) tally.human++;
        if (row.hidden) tally.hiddenPage++;
        if (row.liveForm === 'text') tally.stillText++;
        if (row.liveForm === 'bare') tally.nowBare++;
        const k = (tally.byClass[r.cls] ||= { candidates: 0, stillText: 0, unwrapped: 0, human: 0 });
        k.candidates++; if (row.liveForm === 'text') k.stillText++; if (row.unwrapped_by) k.unwrapped++; if (row.human) k.human++;
      }
      lines.push(JSON.stringify(row));
    }
    fs.appendFileSync(outFile, lines.join('\n') + '\n');
    if (++n % 500 === 0) console.log(`live: ${n}/${byBook.size} books`);
  }
  await c.close();
  tally.generated = new Date().toISOString(); tally.minShare = minShare;
  fs.writeFileSync(path.join(outDir, 'live-summary.json'), JSON.stringify(tally, null, 1) + '\n');
  return tally;
}

/** Preview the implied repair on N live pages, stratified by class and severity. */
async function dryRun(outDir, n) {
  const live = fs.readFileSync(path.join(outDir, 'live-check.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(r => r.found && r.liveForm === 'text' && !r.human && !r.hidden && r.id);
  const want = [['own-text', 'whole', 6], ['own-text', 'half', 2], ['own-text', 'part', 2], ['own-text', 'opening', 4], ['copied-previous', '', 3], ['description', '', 2], ['not-this-page', '', 1]];
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const picks = [], seenBooks = new Set();
  for (const [cls, sev, k] of want) {
    const pool = live.filter(r => r.cls === cls && r.sev.startsWith(sev) && !seenBooks.has(r.book));
    for (let i = 0; i < k && pool.length; i++) { const r = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; seenBooks.add(r.book); picks.push(r); }
  }
  const { c, pages } = await mongo();
  const docs = await pages.find({ id: { $in: picks.slice(0, n).map(r => r.id) } }, { projection: { id: 1, book_id: 1, page_number: 1, 'translation.data': 1 }, maxTimeMS: 60000 }).toArray();
  await c.close();
  const byId = new Map(docs.map(d => [d.id, d]));
  const head = (t, k = 420) => translationProse(t).replace(/\s+/g, ' ').trim().slice(0, k);
  const md = [`# Hidden-meta repair — dry run of ${docs.length} live pages (${new Date().toISOString().slice(0, 10)})`, '',
    'Nothing was written. For each page: the class, the repair it implies, and the first ~420 characters a reader would see before and after (apparatus stripped as the reader strips it). Links open the page.', ''];
  for (const r of picks.slice(0, n)) {
    const d = byId.get(r.id); if (!d) continue;
    const tr = d.translation.data;
    const rep = REPAIR_FOR[r.cls];
    const out = rep === 'move' ? moveContinuityPayload(tr) : stripContinuityPayload(tr);
    md.push(`## ${r.cls} · ${r.sev} · ${rep.toUpperCase()} — [${d.book_id} p${d.page_number}](https://sourcelibrary.org/book/${d.book_id}?page=${d.page_number})`, '',
      `- hidden words: ${r.liveWords}`, `- **before:** ${head(tr) || '(empty)'}`, `- **after:** ${head(out.text) || '(empty)'}`, '');
  }
  fs.writeFileSync(path.join(outDir, 'dry-run.md'), md.join('\n'));
  return { pages: docs.length, file: path.join(outDir, 'dry-run.md') };
}

const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
export const severity = (r) => r.wholePage ? 'whole-page (>=80%)' : r.share >= 0.5 ? 'half (50-80%)' : r.share >= 0.2 ? 'part (20-50%)' : 'opening (<20%)';

function summarize(dir, outDir) {
  const meta = loadBooks(dir);
  const rows = [], ratios = {};
  const tot = { books: 0, translatedBooks: 0, trPages: 0, marker: 0, forms: {}, errors: 0 };
  for (const f of fs.readdirSync(outDir).filter(f => /^shard-\d+-of-\d+\.jsonl$/.test(f))) {
    for (const l of fs.readFileSync(path.join(outDir, f), 'utf8').split('\n')) {
      if (!l) continue;
      const r = JSON.parse(l);
      if (r.kind === 'meta') { rows.push(r); continue; }
      tot.books++;
      if (r.error) { tot.errors++; continue; }
      if (r.trPages) tot.translatedBooks++;
      tot.trPages += r.trPages; tot.marker += r.marker;
      for (const [k, v] of Object.entries(r.forms || {})) tot.forms[k] = (tot.forms[k] || 0) + v;
      for (const [lang, x] of r.ratios || []) { (ratios[lang] ||= []).push(x); (ratios._all ||= []).push(x); }
    }
  }
  const medians = Object.fromEntries(Object.entries(ratios).filter(([, v]) => v.length >= 200).map(([k, v]) => [k, median(v)]));
  const count = (list, key) => list.reduce((o, r) => { const k = key(r); o[k] = (o[k] || 0) + 1; return o; }, {});
  for (const r of rows) {
    r.visible = meta.get(r.book)?.visible ?? null;
    r.cls = classify(r, medians[r.lang] ?? medians._all);
    r.sev = severity(r);
  }
  const judged = rows.filter(r => r.cls !== 'short');
  const bySevClass = {};
  for (const r of judged) { (bySevClass[r.sev] ||= {})[r.cls] = (bySevClass[r.sev][r.cls] || 0) + 1; }
  const summary = {
    generated: new Date().toISOString(),
    mirror: { books: tot.books, translatedBooks: tot.translatedBooks, translatedPages: tot.trPages, scanErrors: tot.errors },
    continuityMeta: { pages: tot.marker, forms: tot.forms },
    textPayload: { pages: rows.length, underMinWords: rows.length - judged.length, judged: judged.length, books: new Set(judged.map(r => r.book)).size, inVisibleBooks: judged.filter(r => r.visible).length },
    bySeverity: count(judged, r => r.sev),
    byClass: count(judged, r => r.cls),
    bySeverityAndClass: bySevClass,
    hiddenWords: { total: judged.reduce((s, r) => s + r.words, 0), ownText: judged.filter(r => r.cls === 'own-text').reduce((s, r) => s + r.words, 0) },
    byLanguage: Object.fromEntries(Object.entries(count(judged, r => r.lang)).sort((x, y) => y[1] - x[1]).slice(0, 15)),
    lengthMedians: medians,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'repair-list.jsonl'), judged.sort((x, y) => y.share - x.share).map(r => JSON.stringify(r)).join('\n') + '\n');
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = arg('dir', path.join(os.homedir(), 'sl-corpus/books'));
  const out = arg('out', 'scripts/output/hidden-meta');
  if (flag('summarize')) process.stdout.write(JSON.stringify(summarize(dir, out), null, 1) + '\n');
  else if (flag('live')) process.stdout.write(JSON.stringify(await live(out, Number(arg('min-share', 0.2))), null, 1) + '\n');
  else if (flag('dry-run')) process.stdout.write(JSON.stringify(await dryRun(out, Number(arg('n', 20))), null, 1) + '\n');
  else run(dir, out);
}
