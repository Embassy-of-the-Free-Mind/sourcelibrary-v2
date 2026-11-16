/**
 * PRIOR ART: scripts/lib/gpu-print-lane.mjs (#6871 — the LightOnOCR print lane's policy, guards, ocr field and writer).
 * It does not fit as is: its guards are written for Latin-script English (more than three Devanagari letters reject the
 * page), its conversion is LightOnOCR markdown, and its book rule is visible English 1800+. This file is the SANSKRIT
 * PROFILE of the same lane, not a second lane: scripts/workers/gpu-print-lane.mjs --lang sa keeps plan / apply / the
 * ledgers / the one writer, and only what differs for Surya 2 on printed Devanagari lives here.
 *
 * Sanskrit, printed Devanagari → Surya 2 on gex45 (v3 #95; the decision of v2#7243, 2026-11-03, taken 2026-11-13).
 * Evidence: scripts/eval/experiments/2026-11-03-sanskrit-surya-print-confirm-7243.md (50 new printed Devanagari books,
 * one page each: median CER Surya 2.1% vs Flash 1.3%, paired Δ +0.46 points, 0/50 unread, 0 misleading pages) and
 * 2026-10-24-sanskrit-gex45-vs-flash-7243.md (30 print books; manuscripts FAIL and are not read here).
 *
 * What the tests covered is what the lane writes: FIRST READS of PRINTED DEVANAGARI. Everything else is turned away
 * and recorded, never written:
 *   - a page whose letters are not mostly Devanagari (Bengali-script Calcutta editions, Roman transliteration, Grantha,
 *     Telugu, an English preface): `not_devanagari`, with the script the read is in;
 *   - a book whose text pages are mostly another script: `book_not_devanagari`, every planned page, nothing written;
 *   - a row-by-row read of a two-column index, Surya's measured weak class: `index_columns` (the read is kept as a
 *     candidate read so a later agy pass can use it as its draft);
 *   - a loop, a blank leaf, an engine note, a block the engine itself labels handwriting.
 * THE SCRIPT CHECK READS THE ENGINE'S OWN OUTPUT. Nothing on the box classifies a page image before the read, so the
 * check runs after it, in apply. It can tell Devanagari from Bengali or Roman. It CANNOT tell a printed page from a
 * Devanagari manuscript or lithograph: that rests on the frame (a curated campaign of printed editions under one hold),
 * the catalogue rule at plan (manuscriptReason), and the by-eye pilot. See the PR for v3 #95.
 *
 * The thresholds below are declared, not fitted: no Surya read of the weak classes is stored in the repo to fit them
 * on. Every one only turns pages away (a page not written stays unread for another route), and rejected.jsonl keeps
 * the measured value beside each reject so the on-box pilot can move them.
 */
import { contentHash } from './write-provenance.mjs';
import { gpuLoopVerdict } from './gpu-ocr-loop-guard.mjs';
import { MIN_WORD_CHARS, COMMENTARY, stripEdgeNotes, wordChars } from './gpu-print-lane.mjs';

export const SA_LANE = 'gpu-print-sa-2026-11';
export const SA_ROUTE = 'sanskrit-print-surya-95';
export const SA_ISSUE = 95;
/** The import hold of the 2026-11 printed-editions campaign (scripts/import/ia-manifest-direct.mjs --hold). The lane reads
 *  ONLY books under it, places no hold and releases none: a book is as held after the read as before. */
export const SA_HOLD = 'sanskrit-print-surya-lane';
export const SA_SOURCE = 'surya';
export const SA_REVISION_REASON = 'ocr_gpu_print_sa_95';
export const SA_EVIDENCE = 'scripts/eval/experiments/2026-11-03-sanskrit-surya-print-confirm-7243.md: 50 printed Devanagari books, one page each, median CER 2.1% vs Flash 1.3% (paired +0.46 points, CI +0.21 to +0.78), 0 unread, 0 misleading; router cell sanskrit-blank/print (scripts/eval/estimator/router-table/evidence/sanskrit-surya-7243.score.json)';

export const SURYA = Object.freeze({
  name: 'Surya', model: 'datalab-to/surya-ocr-2', repo: 'https://huggingface.co/datalab-to/surya-ocr-2',
  prompt: 'none (surya_ocr CLI over a vLLM server, the tool\'s own OCR task)', decode: null, max_side: 2400,
});

/** Letters of Devanagari among all letters, below which a page is not a Devanagari page. */
export const MIN_DEVANAGARI_SHARE = 0.6;
/** A book is judged as a whole once it has this many pages with text … */
export const BOOK_GATE_MIN_PAGES = 10;
/** … and is refused when fewer than this share of them are Devanagari pages. */
export const BOOK_MIN_DEVANAGARI_PAGES = 0.5;
/** Index detector: at least this many lines, this share of them ending in a number, this share of those holding two entries. */
export const INDEX_MIN_LINES = 8;
export const INDEX_NUMBER_FINAL_SHARE = 0.6;
export const INDEX_TWO_ENTRY_SHARE = 0.3;

export const isSanskritBook = (language) => /^Sanskrit\b/.test(String(language || ''));

// The scripts a printed Sanskrit edition comes in, most likely first; anything else counts as `other`.
const SCRIPTS = ['Devanagari', 'Latin', 'Bengali', 'Telugu', 'Grantha', 'Tamil', 'Malayalam', 'Kannada', 'Gujarati', 'Gurmukhi',
  'Oriya', 'Sinhala', 'Tibetan', 'Arabic', 'Sharada', 'Newa', 'Modi', 'Greek', 'Cyrillic', 'Han'];
const SCRIPT_TEST = SCRIPTS.map((n) => [n, new RegExp(`^\\p{Script=${n}}$`, 'u')]);

/**
 * The scripts of a read, by LETTER (\p{L}: vowel signs, accents, digits and dandas are not counted, so a Vedic page's
 * accent marks and a page's numerals do not move the share): { letters, by: { Devanagari: n, Latin: n, … },
 * devanagari_share, script } where `script` is the script with the most letters (null: no letters).
 */
export function scriptProfile(text) {
  const by = {};
  let letters = 0;
  for (const ch of String(text || '').match(/\p{L}/gu) || []) {
    letters++;
    const hit = SCRIPT_TEST.find(([, re]) => re.test(ch));
    const name = hit ? hit[0] : 'other';
    by[name] = (by[name] || 0) + 1;
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  return { letters, by, devanagari_share: letters ? +((by.Devanagari || 0) / letters).toFixed(3) : 0, script: top ? top[0] : null };
}

/** Is this read a Devanagari page? Pure: { ok, share, script, by }. */
export function devanagariVerdict(text) {
  const p = scriptProfile(text);
  return { ok: p.letters > 0 && p.devanagari_share >= MIN_DEVANAGARI_SHARE, share: p.devanagari_share, script: p.script, by: p.by };
}

const NUM = '[0-9०-९]+';
const NUMBER_FINAL = new RegExp(`${NUM}[\\s.,;]*$`, 'u');
// letters, a number, letters again, and a number at the end: two index entries read as one row
const TWO_ENTRY = new RegExp(`\\p{L}[^0-9०-९]*${NUM}[\\s,.;:0-9०-९–-]*\\s+\\p{L}.*${NUM}[\\s.,;]*$`, 'u');

/**
 * A two-column index read row by row (#7243: Surya's weak class in both tests — "Surya read the columns row by row";
 * 5.2% CER against Flash's 0.2% on the confirm set's word index). The mark of it in the text: most lines end in a page
 * or verse number, and many of them hold a second number in the middle with words after it (two entries on one row).
 * A one-column index or a contents page ends its lines in numbers too but has no second entry, and is not flagged. A
 * verse page closes its numbers with a danda (॥ १२ ॥), so its lines do not end in a number.
 * Returns { hit, lines, number_final, two_entry }.
 */
export function indexColumns(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter((l) => /\p{L}/u.test(l));
  const ends = lines.filter((l) => NUMBER_FINAL.test(l));
  const two = ends.filter((l) => TWO_ENTRY.test(l));
  const hit = lines.length >= INDEX_MIN_LINES && ends.length >= INDEX_NUMBER_FINAL_SHARE * lines.length && two.length >= INDEX_TWO_ENTRY_SHARE * ends.length;
  return { hit, lines: lines.length, number_final: ends.length, two_entry: two.length };
}

/** A block label under which the engine itself says the page is not print. Surya 2's label set is tallied by the pilot
 *  (surya-print-read.py keeps `labels`); a label this never matches costs nothing. */
const HANDWRITING_LABEL = /handwrit/i;

/** The read step's text, tidied: no carriage returns, no trailing blanks, at most one empty line in a row. Nothing else:
 *  surya-print-read.py already turned the engine's HTML into text exactly as the #7243 scorer did. */
export function cleanRead(text) {
  return String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The page verdict for one Surya read (out/<bid>/<pn>.json: { text, labels?, block_errors? }):
 * { verdict: 'write' | 'textless' | 'reject', reason, body?, detail? }. Order matters: the engine's own failures first,
 * then blankness, then what the page IS (script, layout). A page is written only when every check passes.
 */
export function suryaPageVerdict(read) {
  const raw = String(read?.text || '');
  if (!raw.trim() && read?.block_errors > 0) return { verdict: 'reject', reason: 'engine_block_error', detail: { block_errors: read.block_errors } };
  const g = gpuLoopVerdict(raw, { finish: read?.finish ?? null });
  if (g.refuse) return { verdict: 'reject', reason: `loop_guard:${g.reason}`, detail: g.detail ?? null };
  const { body, notes } = stripEdgeNotes(cleanRead(raw));
  const stripped = notes.length ? { stripped_notes: notes.length, note: notes[0].slice(0, 120) } : null;
  if (wordChars(body) < MIN_WORD_CHARS) return { verdict: 'textless', reason: 'under_min_word_chars', body };
  if (COMMENTARY.test(body)) return { verdict: 'reject', reason: 'engine_commentary', detail: { line: body.match(COMMENTARY)[0].slice(0, 80) } };
  const hand = Object.keys(read?.labels || {}).find((l) => HANDWRITING_LABEL.test(l));
  if (hand) return { verdict: 'reject', reason: 'handwriting_label', detail: { label: hand, blocks: read.labels[hand] } };
  const d = devanagariVerdict(body);
  if (!d.ok) return { verdict: 'reject', reason: 'not_devanagari', detail: { share: d.share, script: d.script, by_script: d.by } };
  const ix = indexColumns(body);
  if (ix.hit) return { verdict: 'reject', reason: 'index_columns', detail: { lines: ix.lines, number_final: ix.number_final, two_entry: ix.two_entry } };
  return { verdict: 'write', reason: stripped ? 'ok_notes_stripped' : 'ok', body, detail: { devanagari_share: d.share, ...(stripped || {}) } };
}

/**
 * The book as a whole, from every read that came back for it, before any page is written: is it a Devanagari book?
 * Only pages with text count (a blank leaf says nothing). With fewer than BOOK_GATE_MIN_PAGES text pages the book is
 * not judged here and each page stands on its own verdict. Returns
 * { ok, reason?, text_pages, devanagari_pages, by_script: { Bengali: n, … }, script } — `script` is the script most
 * pages are in, which tells the route that should read the book.
 */
export function bookScriptGate(reads) {
  const by = {};
  let text = 0, deva = 0;
  for (const r of reads || []) {
    const body = cleanRead(r?.text);
    if (wordChars(body) < MIN_WORD_CHARS) continue;
    const d = devanagariVerdict(body);
    text++;
    if (d.ok) deva++;
    const k = d.ok ? 'Devanagari' : (d.script === 'Devanagari' ? 'mixed' : d.script || 'other');
    by[k] = (by[k] || 0) + 1;
  }
  const script = Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const out = { text_pages: text, devanagari_pages: deva, by_script: by, script };
  if (text < BOOK_GATE_MIN_PAGES) return { ok: true, judged: false, ...out };
  if (deva < BOOK_MIN_DEVANAGARI_PAGES * text) return { ok: false, judged: true, reason: 'book_not_devanagari', ...out };
  return { ok: true, judged: true, ...out };
}

/**
 * The ledger rows of a refused book: ONE rejected row for every planned page still open, so no page of it is left
 * without an outcome (no silent skips). `pages`: [{ pn, pid }]; `gate`: bookScriptGate's refusal.
 */
export function refusedBookRows(bid, pages, gate) {
  const detail = { script: gate.script, text_pages: gate.text_pages, devanagari_pages: gate.devanagari_pages, by_script: gate.by_script };
  return (pages || []).map((p) => ({ bid, pn: p.pn, pid: p.pid, reason: gate.reason || 'book_not_devanagari', detail }));
}

/**
 * Why the lane does not plan this book at all (a sentence for plan-skipped.jsonl), or null. `manuscript`: the catalogue
 * rule's answer (cli-ocr-lane.mjs manuscriptReason), passed in so this stays pure.
 */
export function saBookSkip(book, { manuscript = null } = {}) {
  if (!isSanskritBook(book?.language)) return 'not Sanskrit';
  if (manuscript) return `not print by the catalogue: ${manuscript} (Surya failed manuscripts, v2#7243)`;
  return null;
}

/** The frame's book query: Sanskrit books under the lane's hold, hidden ones included (the campaign imports hidden). */
export function saFrameQuery() {
  return { language: { $regex: '^Sanskrit' }, 'pipeline_auto.hold.reason': SA_HOLD, pages_count: { $gt: 0 } };
}

/** The whole `ocr` field the lane writes, in the gpu-print lane's shape (scripts/lib/gpu-print-lane.mjs ocrField). */
export function saOcrField(text, { run, now = new Date(), imageUrl = null, imageSha256 = null, box = {}, why = null } = {}) {
  return {
    data: text,
    content_hash: contentHash(text),
    language: 'Sanskrit',
    model: SURYA.model,
    source: SA_SOURCE,
    pipeline: SA_LANE,
    updated_at: now,
    engine: {
      name: SURYA.name, model: SURYA.model, repo: SURYA.repo,
      // the licence is read from the model card of the snapshot the box served, never typed here
      ...(box.licence ? { licence: box.licence, licence_source: 'logged: the model card of the served snapshot' } : { licence: 'not_recorded', licence_source: 'not_recorded: the box run did not report the model card licence' }),
      ...(box.weights_revision ? { revision: box.weights_revision, revision_source: 'logged: the HF snapshot the box served' } : { revision_source: 'not_recorded: the box run did not report its snapshot' }),
      version: box.surya_version || null,
      prompt: SURYA.prompt,
      conventions: `whole page, long side capped at ${SURYA.max_side} px; the engine's HTML blocks in reading order, tags dropped (scripts/gpu/surya-print-read.py, as the #7243 scorer read them); written only where the page had no text and the read is Devanagari print by the lane's guards (scripts/lib/surya-print-lane.mjs)`,
      measured: SA_EVIDENCE,
      route: SA_ROUTE,
      // a bare GPU read, no agy pass yet: a later correction frame selects on this, as for the English lane
      corrected: false,
      run, issue: SA_ISSUE, host: box.host || null, gpu: box.gpu || null,
      serving: box.vllm_version ? { backend: 'vllm', vllm: box.vllm_version } : null,
      input: imageUrl ? { image_url: imageUrl, image_sha256: imageSha256 } : { status: 'not_recorded', reason: 'caller passed no image url' },
      replaced: why,
    },
  };
}

/**
 * The lane profile scripts/workers/gpu-print-lane.mjs runs under --lang sa (or a lane dir whose `lang` file says sa).
 * Keys the English profiles do not carry switch the worker's defaults: see the worker's "profile hooks".
 */
export const SA_PROFILE = Object.freeze({
  language: 'Sanskrit', isBook: isSanskritBook, lane: SA_LANE, cell: null, measured: SA_EVIDENCE,
  issue: SA_ISSUE, engine: SURYA, source: SA_SOURCE, revisionReason: SA_REVISION_REASON,
  holds: Object.freeze([SA_HOLD]), heldOnly: true, minYear: null,
  frameQuery: saFrameQuery, bookSkip: saBookSkip,
  pageVerdict: suryaPageVerdict, bookGate: bookScriptGate, convert: cleanRead, ocrField: saOcrField,
  // a rejected read worth keeping as a later correction pass's draft: the words are right, their order is not
  keepReasons: Object.freeze(['index_columns']),
  // pages this lane will never read, whatever is planned again
  finalReasons: Object.freeze(['not_devanagari', 'book_not_devanagari', 'handwriting_label']),
  scriptReason: 'not_devanagari',
});
