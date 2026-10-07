#!/usr/bin/env node
// PRIOR ART: scripts/lib/translation-text-repair.mjs (repairTranslationText) — the guarded door
// for every edit to stored translation text (human-edit skip, conditional write, revision row
// first, content_hash); used as-is for every write here. scripts/eval/lib/quality-census-detectors.mjs
// (classifyNote, the #5700 A1 census) and scripts/lib/page-terms-parse.mjs (parseTranslationTerms /
// verifyQuote) — the detectors; imported, not rewritten. scripts/lib/translate-core.mjs
// sanitizeTranslationTags — the tag repair; imported, and held here to its deletion-only cases.
// scripts/maintenance/fix-unclosed-note-tags.mjs and tengyur-draft-repairs-5497.mjs — the same
// door for a named page list / one book set; neither walks the corpus or knows these classes.
/**
 * The $0 deterministic cleanup of served translations (#5700 rows A2 and A3). No model calls.
 *
 * Classes — each a pure function over the stored English, each with its own by-eye gate:
 *   a_initial   <note> that only describes a decorative initial            → <meta> (info panel)
 *   a_scan      <note> that only warns about the scan / page condition     → <meta>
 *   c_tags      tag faults repaired by DELETING tags only: the premature close
 *               `<margin></margin>text</margin>` is rejoined, empty pairs and orphan closers go
 *   c_visible   centre markers the reader prints: `->### HEAD ###<-` trailing hashes, a second
 *               `->` inside one centred block, a `->` that is never closed, `.-<` / `< -` closers,
 *               a reversed `<-HEAD->`
 *   b_original  <note>original: "…"</note> whose quote is `absent` from the OCR of the page AND of
 *               both neighbouring pages (verifyQuote), on Latin-script pages where not one word of
 *               it is found (strictlyAbsent): the clause is dropped, the rest of the note kept
 *   d_termdef   (#5901) a model definition stored inside the chip, `<term>X: definition</term>`
 *               → `<term>X</term> <note>definition</note>`. The rule is the reader's
 *               (scripts/lib/term-definitions.mjs, shape 1 only); a chip inside another annotation
 *               span is left. Its own run: source `cleanup-termdef-5901`, never mixed with the others
 *
 * NOT touched: `[Blank page — no translatable content]` (the pipeline's own marker — page-counts
 * and the translate worker read it; an empty translation would be picked up for retranslation),
 * other brackets, unclosed tags (a closer has to be PLACED, which is a judgment), unknown tags
 * (`<italic>`, `<center>`: formatting to map, not delete),
 * `<header>`/`<page-num>` echoes, `translations.<iso>` editions, human-edited pages.
 *
 * Writes: `translation.data` (+ its content_hash) and one `page_revisions` row per page holding
 * the text it replaced, source `cleanup-a2-5700` (`cleanup-termdef-5901` for d_termdef) — the undo key. `translation.updated_at` is NOT
 * moved, so the translate worker, embed-gemini and the pages-content sync cron do not react; the
 * Supabase `pages` mirror is refreshed by `--resync` instead (and the search snippet column by
 * `--resync --snippets`, a separate decision: see resync()).
 *
 *   node --env-file=.env.production.local scripts/maintenance/translation-cleanup-a2-5700.mjs --scan   [--dir D] [--conc 4] [--shard i/n] [--classes d_termdef]
 *   node … --summary                                                         # counts per class from the scan
 *   npx tsx … --review --classes a_initial,… [--n 40] [--seed 5700]         # reader-rendered before/after
 *   node … --apply --classes a_initial,c_tags [--limit-per-class 1000] [--conc 4]
 *   node … --resync [--snippets]                                             # Supabase `pages` mirror; --snippets = page_translations (slow)
 *   node … --undo [--ids FILE|id,id] [--classes d_termdef]                   # restore the text each page held before
 * Every mode is resumable: --scan by book, --apply and --resync by page id (files under --dir).
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyNote } from '../eval/lib/quality-census-detectors.mjs';
import { parseTranslationTerms, hasNonLatinLetter } from '../lib/page-terms-parse.mjs';
import { sanitizeTranslationTags, TRANSLATION_TAG_VOCABULARY } from '../lib/translate-core.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { splitInlineTermDefinitions, splitTermDefinition } from '../lib/term-definitions.mjs';

export const SOURCE = 'cleanup-a2-5700';
export const TERMDEF_SOURCE = 'cleanup-termdef-5901';
export const CLASSES = ['a_initial', 'a_scan', 'c_tags', 'c_visible', 'b_original', 'd_termdef'];
/** The classes a run with no --classes means: the #5700 set. d_termdef is always asked for by name. */
export const A2_CLASSES = CLASSES.filter((c) => c !== 'd_termdef');
/** Which revision label, issue and job a set of classes writes under. d_termdef has its own undo key, so it runs alone. */
export function runFor(classes) {
  if (!classes.includes('d_termdef')) return { source: SOURCE, issue: '#5700', jobId: 'a2-cleanup-5700' };
  if (classes.length !== 1) throw new Error('d_termdef runs alone: its revision rows carry their own source label');
  return { source: TERMDEF_SOURCE, issue: '#5901', jobId: 'term-defs-5901' };
}
const WHAT = {
  a_initial: 'decorative-initial notes moved to <meta>',
  a_scan: 'scan-condition notes moved to <meta>',
  c_tags: 'empty, orphan and prematurely closed tags repaired by deleting tags only',
  c_visible: 'centre markers the reader printed repaired',
  b_original: 'original: clauses whose quote is not on the page dropped',
  d_termdef: 'model definitions inside <term> moved to a <note> after the term',
};

// ── (a) notes about the scan, not the text ───────────────────────────────────────────────────
/** A note that describes the leaf can also carry a reading of the text ("…initial 'S' omitted, so
 *  the word reads 'ed'"). Those stay notes: anything that quotes, glosses or explains. */
const NOTE_HAS_CONTENT = /\b(?:original|orig\.|lit\.|literally|i\.e\.|means?|meaning|refers?|referring|reads?|reading|should (?:be|read)|supplied|omitted|missing|restored|translat\w*|rendered|abbreviat\w*|stands for|signif\w*|symboli[sz]\w*|allud\w*|depict\w*|represent\w*|probably|likely|perhaps|possibly)\b/i;
const MAX_SCAN_NOTE = 260;

/** Rewrite `<note>…</note>` → `<meta>…</meta>` when the note is ONLY about a decorative initial
 *  (`which` has 'initial') or the scan (`'scan'`). The reader lifts <meta> into the page-info
 *  panel, and every quote/search/export surface already drops it. No word is deleted. */
export function notesToMeta(text, which = ['initial', 'scan']) {
  const n = { initial: 0, scan: 0 };
  const out = String(text).replace(/<note>([^<]*)<\/note>/g, (m, body) => {
    const c = classifyNote(body);
    if (c !== 'initial' && c !== 'scan') return m;
    if (!which.includes(c)) return m;
    if (body.length > MAX_SCAN_NOTE || NOTE_HAS_CONTENT.test(body)) return m;
    n[c]++;
    return `<meta>${body}</meta>`;
  });
  return { text: out, n };
}

// ── (c) tag faults, deletion-only ────────────────────────────────────────────────────────────
const TAG_TOKEN = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\s*\/?>/g;
const stripTags = (s) => String(s).replace(TAG_TOKEN, '');
const tagBag = (s) => { const b = new Map(); for (const t of String(s).match(TAG_TOKEN) || []) b.set(t, (b.get(t) || 0) + 1); return b; };
/** The premature close the census sized: an empty pair, then the annotation's own PLAIN text in the
 *  same paragraph, then the stray closer. Not rejoined: a span crossing a blank line (it would wrap
 *  body text in a margin), and a span holding other tags or centre markers — rendered through
 *  NotesRenderer, an <unclear> inside a rejoined <margin> loses its "?" and centred lines fall out
 *  of a rejoined <insert>. */
const SIMPLE_REJOIN = /<(margin|insert|gloss|unclear|note|term)>\s*<\/\1>(?:(?!\n\s*\n)(?!->|<-|::|\n\s*[#|>])[^<]){1,600}<\/\1>/gi;

/**
 * sanitizeTranslationTags(), accepted only when all it did was DELETE tags: rejoin a premature
 * close, drop an empty pair, drop an orphan closer. If it had to add a closer, unwrap an unknown
 * tag or bracket a word, the page is left alone (`skipped`) — those need a placement decision.
 * So does any page where the deleted tag is not one of ours.
 */
export function repairTagsDeletionOnly(text) {
  const src = String(text);
  if (!mayNeedTagRepair(src)) return { text: src, n: 0 };
  const out = sanitizeTranslationTags(src);
  if (out === src) return { text: src, n: 0 };
  if (stripTags(out) !== stripTags(src)) return { text: src, n: 0, skipped: 'text-changed' };
  const before = tagBag(src);
  let removed = 0;
  for (const [tok, k] of tagBag(out)) if (k > (before.get(tok) || 0)) return { text: src, n: 0, skipped: 'tag-added' };
  // Same tags is not enough: a nested note is "repaired" by closing the outer note early and
  // dropping its real closer — one added, one removed — which turns the rest of an AI note into
  // body text. `out` must be `src` with tag tokens taken out, nothing moved.
  if (!isTagDeletionOf(src, out)) return { text: src, n: 0, skipped: 'tag-moved' };
  const after = tagBag(out);
  for (const [tok, k] of before) {
    const gone = k - (after.get(tok) || 0);
    // A deleted tag that carries a number (`<verse 68>`, `<column 2>`) would take the number with it.
    if (gone > 0 && /\s[^>]*\d/.test(tok)) return { text: src, n: 0, skipped: 'numbered-tag' };
    // Tags outside the vocabulary (<italic>, <center>, <foreign>) carry formatting the sanitizer
    // would discard; they want a mapping to markdown, not a deletion. Left for that.
    if (gone > 0 && !TRANSLATION_TAG_VOCABULARY.has(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(tok)[1].toLowerCase())) return { text: src, n: 0, skipped: 'unknown-tag' };
    removed += gone;
  }
  // Every empty pair the sanitizer rejoined must be the simple shape; an empty pair followed by a
  // far-off orphan closer is not the same fault.
  const simple = (src.match(SIMPLE_REJOIN) || []).length;
  if (countRejoins(src, out) > simple) return { text: src, n: 0, skipped: 'far-rejoin' };
  return { text: out, n: removed };
}
/** True when `out` is `src` with some tag tokens deleted and nothing else changed or moved. */
export function isTagDeletionOf(src, out) {
  let j = 0, at = 0;
  for (const m of src.matchAll(TAG_TOKEN)) {
    const text = src.slice(at, m.index);
    if (!out.startsWith(text, j)) return false;
    j += text.length;
    if (out.startsWith(m[0], j)) j += m[0].length; // kept
    at = m.index + m[0].length;
  }
  return out.slice(j) === src.slice(at);
}
/** Cheap screen before the sanitizer (it compiles ~50 patterns per call): can only a deletion
 *  apply? Yes when a tag is outside the vocabulary, a pair is empty, or opens and closes differ. */
const VOID = new Set(['br', 'hr', 'img', 'column-break', 'leaf-break']);
function mayNeedTagRepair(src) {
  if (!src.includes('<')) return false;
  const bal = new Map();
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*?)?\s*(\/?)>/g)) {
    const name = m[2].toLowerCase();
    if (!TRANSLATION_TAG_VOCABULARY.has(name)) return true;
    if (m[3] || VOID.has(name)) continue;
    bal.set(name, (bal.get(name) || 0) + (m[1] ? -1 : 1));
  }
  for (const v of bal.values()) if (v !== 0) return true;
  return /<([a-z-]+)>\s*<\/\1>/i.test(src) || /<\/[a-z-]+[^a-z>-]/i.test(src);
}
/** How many empty pairs lost only their CLOSER (the opener survived): a rejoin. A dropped empty
 *  pair loses both tokens. Counted per tag name from the token bags. */
function countRejoins(src, out) {
  let rejoins = 0;
  for (const tag of ['margin', 'insert', 'gloss', 'unclear', 'note', 'term', 'image-desc', 'interp', 'meta']) {
    const c = (s, tok) => s.split(tok).length - 1;
    const openLost = c(src, `<${tag}>`) - c(out, `<${tag}>`);
    const empties = (src.match(new RegExp(`<${tag}>\\s*</${tag}>`, 'gi')) || []).length;
    rejoins += Math.max(0, empties - openLost);
  }
  return rejoins;
}

// ── (c) centre markers the reader prints ─────────────────────────────────────────────────────
/**
 * The reader centres `->text<-` (NotesRenderer.preprocessCentering). What it then PRINTS:
 *   1. closing hashes of a centred heading: `->### THIRD DIALOGUE ###<-` shows "THIRD DIALOGUE ###";
 *   2. a malformed closer on a centred line: `.-<`, `< -`, `<–`;
 *   3. a reversed pair on its own line: `<-FROM THE BOOK->`;
 *   4. a second `->` inside one centred block (each verse line opened, only the last closed);
 *   5. a line-opening `->` that nothing closes (the next marker in the page is another `->`, or none).
 * Only line-opening markers are read; a `->` inside running text ("A -> B") is never touched.
 */
export function fixCentreMarkers(text) {
  const n = { heading_hashes: 0, closer: 0, reversed: 0, inner_open: 0, dangling_open: 0 };
  const paras = String(text).split(/(\n[ \t]*\n)/);
  for (let p = 0; p < paras.length; p += 2) {
    const lines = paras[p].split('\n');
    for (let i = 0; i < lines.length; i++) {
      let ln = lines[i];
      if (/^\s*->/.test(ln) && !/<-/.test(ln) && /(?:-<|<\s-|<[–—])\s*$/.test(ln)) { ln = ln.replace(/(?:-<|<\s-|<[–—])(\s*)$/, '<-$1'); n.closer++; }
      const rev = /^(\s*)<-\s*([^<>\n]*?[^\s<>-])\s*->(\s*)$/.exec(ln);
      if (rev) { ln = `${rev[1]}->${rev[2]}<-${rev[3]}`; n.reversed++; }
      const hh = /^(\s*->\s*#{1,6}\s*)([^#\n]*?[^\s#])\s*#+\s*(<-\s*)$/.exec(ln);
      if (hh) { ln = hh[1] + hh[2] + hh[3]; n.heading_hashes++; }
      lines[i] = ln;
    }
    // Blocks: consecutive lines that each open with `->`, where only the last carries `<-`.
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*->/.test(lines[i]) || /<-/.test(lines[i])) continue;
      let k = i + 1;
      while (k < lines.length && /^\s*->/.test(lines[k]) && !/<-/.test(lines[k])) k++;
      if (k >= lines.length || !/^\s*->/.test(lines[k]) || !/<-\s*$/.test(lines[k]) || (lines[k].match(/->/g) || []).length !== 1) continue;
      for (let x = i + 1; x <= k; x++) { lines[x] = lines[x].replace(/^(\s*)->\s?/, '$1'); n.inner_open++; }
      i = k;
    }
    paras[p] = lines.join('\n');
  }
  // A line-opening `->` that nothing closes. The reader pairs `->` with the NEXT `<-` anywhere in
  // the page, so "nothing closes it" means: the next marker after it is another `->`, or none.
  // (A closer three paragraphs on is still its closer — removing the opener would strand a `<-`.)
  let out = paras.join('');
  const drops = [];
  for (const m of out.matchAll(/^([ \t]*)->[ \t]?/gm)) {
    const after = m.index + m[0].length;
    const next = /->|<-/.exec(out.slice(after));
    if (next && next[0] === '<-') continue;
    // What is left must not become markdown: "->4." would turn into an empty list item.
    if (/^(?:\d+[.)]|[-*+>#|])(?:\s|$)/.test(out.slice(after, after + 12))) continue;
    drops.push([m.index + m[1].length, after]);
  }
  for (const [a, b] of drops.reverse()) { out = out.slice(0, a) + out.slice(b); n.dangling_open++; }
  return { text: out, n };
}

// ── (b) `original:` quotes that are not on the page ──────────────────────────────────────────
const ORIGINAL_NOTE = /<note>(\s*original:\s*["“«'][^"”»']{1,80}["”»']\s*(?:[(（][^()（）]{1,80}[)）])?)([^<]*)<\/note>/gi;
export const MIN_OCR_CHARS = 400;

/** Letters only, for a containment test that survives what verifyQuote() does not: a word broken
 *  across lines (`e= lementa`, `equi/ noctiali`), a tag or bold marker inside a word, u/v and i/j,
 *  ligatures, marks of abbreviation (`melãcholicus`), a long s the OCR read as f, a doubled letter.
 *  Tags are removed as TOKENS: a lazy `<[^>]+>` swallows the page from a stray `<` to the next `>`
 *  (1,326 characters on one sampled page). Comparison only — never stored. */
function squeeze(s) {
  return stripTags(s).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss').replace(/&/g, 'et')
    .replace(/u/g, 'v').replace(/j/g, 'i').replace(/f/g, 's') // OCR reads the long s as f
    .replace(/[^\p{L}]+/gu, '').replace(/(\p{L})\1+/gu, '$1');
}
/** Best share of the quote's letter trigrams found in any one quote-sized window of the page. */
export function nearestWindow(quote, hay) {
  const q = squeeze(quote);
  if (q.length < 3) return 0;
  const want = new Set(); for (let i = 0; i + 3 <= q.length; i++) want.add(q.slice(i, i + 3));
  const w = q.length + 6; let best = 0;
  for (let at = 0; at < hay.length; at += Math.max(1, Math.floor(q.length / 4))) {
    const win = hay.slice(at, at + w); let c = 0;
    for (const g of want) if (win.includes(g)) c++;
    if (c > best) best = c;
  }
  return best / want.size;
}
/** The same word as a scribe or compositor abbreviates it: the nasal before a consonant, or the final one, dropped. */
const dropNasal = (w) => w.replace(/[mn](?=[^aeiovy]|$)/g, '');

/**
 * `absent` from verifyQuote() is an upper bound: measured on the A1 draw, a third of those quotes
 * ARE on the page under a looser fold, and many more are romanisations of a word the page prints
 * in its own script. This is the stricter test the cleanup needs before deleting anything:
 * the pages are Latin-script only (so no romanisation question), the quote is not on them even
 * letters-only, and NO word of it (4+ letters) is — in full, by stem, or abbreviated.
 */
export function strictlyAbsent(quote, ocrs) {
  const text = stripTags((ocrs || []).join('\n'));
  if (hasNonLatinLetter(quote)) return false;
  if ((text.match(/(?!\p{Script=Latin})\p{L}/gu) || []).length > 3) return false; // any other script: a romanisation question
  const hay = squeeze(text);
  const q = squeeze(quote);
  if (q.length < 4 || hay.includes(q)) return false;
  const words = String(quote).split(/[^\p{L}\p{M}]+/u).map(squeeze).filter((w) => w.length >= 4);
  if (!words.length) return false;
  for (const w of words) {
    if (hay.includes(w) || hay.includes(dropNasal(w))) return false;
    if (w.length >= 6 && hay.includes(w.slice(0, Math.max(5, Math.floor(w.length * 0.7))))) return false;
  }
  return nearestWindow(quote, hay) < 0.5; // an OCR slip away from the page is not absent
}

/**
 * Drop the `original: "…" (…)` clause of a note when verifyQuote() finds the quote `absent` from
 * this page's OCR and from each neighbour's (a block translation can carry a line across the
 * page seam — that quote is real), AND strictlyAbsent() agrees. `script`-tier notes (uncheckable)
 * and any page printing a non-Latin script are never touched. What the
 * note says after the clause is kept; a note with nothing left is removed.
 * @param {string} text  @param {string[]} ocrs  this page's OCR first, then its neighbours'
 */
export function dropAbsentOriginals(text, ocrs) {
  const own = String(ocrs?.[0] || '');
  const dropped = [];
  // The page's own transcription, not the OCR's description of an illustration: a word read off a
  // plate is on the leaf and not in the text.
  if (stripTags(stripEditorialWrappers(own)).replace(/\s+/g, ' ').trim().length < MIN_OCR_CHARS) return { text: String(text), n: 0, dropped, skipped: 'ocr-too-short' };
  const tierOf = (note, ocr) => parseTranslationTerms(note, ocr).find((r) => r.kind === 'original');
  const out = String(text).replace(ORIGINAL_NOTE, (m, clause, rest, at, whole) => {
    const row = tierOf(`<note>${clause}</note>`, own);
    if (!row || row.match !== 'absent') return m;
    for (const o of (ocrs || []).slice(1)) if (o && tierOf(`<note>${clause}</note>`, o)?.match !== 'absent') return m;
    if (!strictlyAbsent(row.term, ocrs)) return m;
    dropped.push(row.term);
    const kept = rest.replace(/^\s*[.;,:]?\s*(?:[—–-]\s+)?/, '').trim();
    if (!kept) return /\s$/.test(whole.slice(0, at)) ? '\u0001' : '';
    return `<note>${kept[0].toUpperCase()}${kept.slice(1)}</note>`;
  }).replace(/[ \t]?\u0001/g, '');
  return { text: out, n: dropped.length, dropped };
}

// ── (d) model definitions stored inside <term> (#5901) ───────────────────────────────────────
/**
 * `<term>X: definition</term>` → `<term>X</term> <note>definition</note>`; when X already stands
 * right before the chip, or the head is the model's own label (`original:`), the note alone. The
 * rule and its limits are the reader's own (scripts/lib/term-definitions.mjs, #5908) — imported,
 * not copied — so the stored text becomes what the reader already shows. `<gloss>` is not touched.
 * No character of the chip is deleted except the colon that joined head and definition (and a head
 * the sentence already carries).
 */
export function termDefinitionsToNotes(text) {
  return splitInlineTermDefinitions(String(text), { outsideSpans: true });
}

// ── one page ─────────────────────────────────────────────────────────────────────────────────
/** Run the named classes over one page's English. Returns the new text and what each class did. */
export function cleanupPage(text, { classes = A2_CLASSES, ocrs = null } = {}) {
  let t = String(text || '');
  const fired = {};
  const skipped = {};
  const which = ['initial', 'scan'].filter((k) => classes.includes(`a_${k}`));
  if (which.length && t.includes('<note>')) {
    const r = notesToMeta(t, which);
    t = r.text;
    if (r.n.initial) fired.a_initial = r.n.initial;
    if (r.n.scan) fired.a_scan = r.n.scan;
  }
  if (classes.includes('c_tags')) {
    const r = repairTagsDeletionOnly(t);
    t = r.text;
    if (r.n) fired.c_tags = r.n;
    if (r.skipped) skipped.c_tags = r.skipped;
  }
  if (classes.includes('c_visible') && (t.includes('->') || t.includes('<-'))) {
    const r = fixCentreMarkers(t);
    t = r.text;
    if (Object.values(r.n).some(Boolean)) fired.c_visible = Object.fromEntries(Object.entries(r.n).filter(([, v]) => v));
  }
  if (classes.includes('b_original') && ocrs) {
    const r = dropAbsentOriginals(t, ocrs);
    t = r.text;
    if (r.n) fired.b_original = r.dropped;
  }
  if (classes.includes('d_termdef') && t.includes('<term>')) {
    const r = termDefinitionsToNotes(t);
    t = r.text;
    const { in_span: inSpan, ...did } = r.n;
    if (Object.values(did).some(Boolean)) fired.d_termdef = Object.fromEntries(Object.entries(did).filter(([, v]) => v));
    if (inSpan) skipped.d_termdef = 'in-span';
  }
  return { text: t, fired, skipped };
}

// ── I/O ──────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = arg('--dir', '/data/scratch/sl/claude-jobs/a2');
const CONC = Number(arg('--conc', 4));
const F = { cand: 'candidates.jsonl', books: 'scan-books-done.txt', scan: 'scan-summary.json', applied: 'applied.jsonl', resynced: 'resynced.txt', progress: 'progress.json' };
const SHARD = arg('--shard', '').replace('/', 'of');
const fp = (k) => path.join(DIR, SHARD && ['cand', 'books', 'progress'].includes(k) ? F[k].replace(/(\.\w+)$/, `.${SHARD}$1`) : F[k]);
const shardFiles = (k) => fs.readdirSync(DIR).filter((f) => f === F[k] || new RegExp(`^${F[k].replace(/(\.\w+)$/, '')}\\.\\d+of\\d+\\.\\w+$`).test(f)).map((f) => path.join(DIR, f));
const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
const classesArg = (dflt) => { const cs = arg('--classes', dflt.join(',')).split(',').filter(Boolean); const bad = cs.filter((c) => !CLASSES.includes(c)); if (bad.length) throw new Error(`unknown class ${bad.join(',')}; from ${CLASSES.join(',')}`); return cs; };
const HAS_TR = { 'translation.data': { $type: 'string', $ne: '' } };
const LIVE = { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } };

async function connect() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: CONC + 2 });
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
async function retry(fn, tries = 4) {
  for (let a = 0; ; a++) {
    try { return await fn(); } catch (e) { if (a >= tries - 1) throw e; await new Promise((r) => setTimeout(r, 5000 * (a + 1))); }
  }
}
/** OCR of each wanted page and its two neighbours, keyed by page_number. */
async function ocrWindow(db, bookId, pageNumbers) {
  const want = [...new Set(pageNumbers.flatMap((p) => [p - 1, p, p + 1]))];
  const map = new Map();
  for (let i = 0; i < want.length; i += 400) {
    const rows = await retry(() => db.collection('pages').find({ book_id: bookId, page_number: { $in: want.slice(i, i + 400) } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } }).hint({ book_id: 1, page_number: 1 }).maxTimeMS(120000).toArray());
    for (const r of rows) if (typeof r.ocr?.data === 'string') map.set(r.page_number, r.ocr.data);
  }
  return (p) => [map.get(p) || '', map.get(p - 1) || '', map.get(p + 1) || ''];
}

/** --scan: walk every live translated book, one book at a time (no cursor held across work). */
async function scan() {
  const { isHumanEditedTranslation } = await import('../lib/translation-text-repair.mjs');
  const { client, db } = await connect();
  const classes = classesArg(A2_CLASSES);
  const wantB = classes.includes('b_original');
  const bookRows = await db.collection('books').find(LIVE, { projection: { _id: 1, id: 1, language: 1 } }).toArray();
  const langOf = new Map(bookRows.map((b) => [b.id || String(b._id), b.language || '']));
  const books = [...langOf.keys()].sort();
  const done = new Set(readLines(fp('books')).map((l) => l.split('\t')[0]));
  const [shard, shards] = arg('--shard', '0/1').split('/').map(Number);
  const todo = books.filter((b, i) => i % shards === shard && !done.has(b));
  const limit = Number(arg('--limit-books', 0));
  if (limit) todo.length = Math.min(todo.length, limit);
  console.error(`scan: ${books.length} live translated books, ${done.size} done, ${todo.length} to do`);
  const cand = fs.createWriteStream(fp('cand'), { flags: 'a' });
  const booksDone = fs.createWriteStream(fp('books'), { flags: 'a' });
  let pages = 0, hits = 0, n = 0;
  const t0 = Date.now();
  await pool(todo, CONC, async (bid) => {
    const rows = await retry(() => db.collection('pages').find({ book_id: bid, page_number: { $gte: 0 }, ...HAS_TR },
      { projection: { _id: 0, id: 1, page_number: 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.edited_at': 1 } })
      .hint({ book_id: 1, page_number: 1 }).maxTimeMS(300000).toArray());
    const needOcr = wantB ? rows.filter((r) => /<note>\s*original:/i.test(r.translation.data)).map((r) => r.page_number) : [];
    const ocrOf = needOcr.length ? await ocrWindow(db, bid, needOcr) : null;
    const lines = [];
    for (const r of rows) {
      const res = cleanupPage(r.translation.data, { classes, ocrs: ocrOf && needOcr.includes(r.page_number) ? ocrOf(r.page_number) : null });
      const anySkip = Object.keys(res.skipped).length;
      if (res.text === r.translation.data && !anySkip) continue;
      const rec = { id: r.id, b: bid, p: r.page_number, f: res.fired, l: langOf.get(bid) };
      if (anySkip) rec.s = res.skipped;
      if (typeof r.id !== 'string' || !r.id) rec.x = 'no_id';
      else if (isHumanEditedTranslation(r.translation)) rec.x = 'human_edited';
      lines.push(JSON.stringify(rec));
    }
    pages += rows.length; hits += lines.length;
    if (lines.length) cand.write(lines.join('\n') + '\n');
    booksDone.write(`${bid}\t${rows.length}\t${langOf.get(bid)}\n`);
    if (++n % 200 === 0) {
      fs.writeFileSync(fp('progress'), JSON.stringify({ mode: 'scan', books_done: done.size + n, books: books.length, pages_read: pages, candidates: hits, elapsed_s: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }));
      console.error(`${done.size + n}/${books.length} books · ${pages} pages · ${hits} candidates`);
    }
  });
  await new Promise((r) => cand.end(r)); await new Promise((r) => booksDone.end(r));
  await client.close();
  fs.writeFileSync(fp('progress'), JSON.stringify({ mode: 'scan', finished: true, books_done: done.size + n, pages_read: pages, candidates: hits, at: new Date().toISOString() }));
  if (shards === 1) summarise(books.length);
}

function loadCandidates() {
  const seen = new Map();
  for (const f of shardFiles('cand')) for (const l of readLines(f)) { const c = JSON.parse(l); seen.set(c.id || `${c.b}:${c.p}`, c); }
  return [...seen.values()];
}
function summarise(books) {
  const cands = loadCandidates();
  const bookLines = shardFiles('books').flatMap((f) => readLines(f)).map((l) => l.split('\t'));
  const s = { generated_at: new Date().toISOString(), books_scanned: bookLines.length, live_books: books, pages_read: bookLines.reduce((n, l) => n + (Number(l[1]) || 0), 0), pages_with_any: 0, books_with_any: 0, by_class: {}, c_visible_ops: {}, d_termdef_ops: {}, skipped: {}, excluded: {}, union: {}, by_language: {} };
  for (const [, n, lang] of bookLines) if (n !== undefined) (s.by_language[lang || '?'] ||= { pages_read: 0, pages_with_any: 0 }).pages_read += Number(n) || 0;
  const booksHit = new Set();
  for (const c of cands) {
    if (c.x) { s.excluded[c.x] = (s.excluded[c.x] || 0) + 1; continue; }
    const ks = Object.keys(c.f);
    if (ks.length) { s.pages_with_any++; booksHit.add(c.b); if ('l' in c) (s.by_language[c.l || '?'] ||= { pages_read: 0, pages_with_any: 0 }).pages_with_any++; }
    for (const [op, v] of Object.entries(c.f.d_termdef || {})) s.d_termdef_ops[op] = (s.d_termdef_ops[op] || 0) + v;
    for (const k of ks) (s.by_class[k] ||= { pages: 0, edits: 0 }, s.by_class[k].pages++, s.by_class[k].edits += typeof c.f[k] === 'number' ? c.f[k] : Array.isArray(c.f[k]) ? c.f[k].length : Object.values(c.f[k]).reduce((a, b) => a + b, 0));
    for (const [op, v] of Object.entries(c.f.c_visible || {})) s.c_visible_ops[op] = (s.c_visible_ops[op] || 0) + v;
    for (const [k, why] of Object.entries(c.s || {})) s.skipped[`${k}:${why}`] = (s.skipped[`${k}:${why}`] || 0) + 1;
    if (ks.some((k) => k !== 'b_original' && k !== 'd_termdef')) s.union.a2 = (s.union.a2 || 0) + 1;
  }
  s.books_with_any = booksHit.size;
  fs.writeFileSync(fp('scan'), JSON.stringify(s, null, 1));
  console.log(JSON.stringify(s, null, 1));
  return s;
}

function seededOrder(items, seed) {
  let st = seed >>> 0;
  const rng = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return items.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/** --review: N seeded pages per class, before/after as the reader renders them (run under tsx). */
async function review() {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const mod = await import('../../src/components/reader/NotesRenderer');
  const NotesRenderer = mod.default?.default || mod.default || mod;
  const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
  const shown = (tr) => renderToStaticMarkup(React.createElement(NotesRenderer, { text: tr, showMetadata: false }))
    .replace(/<\/(?:p|div|h\d|li|tr|blockquote)>|<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&(?:lt|gt|amp|quot|nbsp|#x27|#39);/g, (m) => ENT[m]).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const classes = classesArg(A2_CLASSES);
  const N = Number(arg('--n', 40)); const seed = Number(arg('--seed', 5700));
  // The reader's text pipeline with notes on and with notes off — what d_termdef has to leave right in both.
  const prepared = (tr, showNotes) => (mod.prepareNotesMarkdown || mod.default.prepareNotesMarkdown)(tr, { showNotes }).processedText.replace(/[ \t]+/g, ' ').trim();
  const cands = loadCandidates().filter((c) => !c.x);
  const { client, db } = await connect();
  for (const cls of classes) {
    const pick = seededOrder(cands.filter((c) => c.f[cls]).sort((a, b) => (a.id < b.id ? -1 : 1)), seed).slice(0, N);
    const out = [`# ${cls} — ${pick.length} seeded pages (seed ${seed}), before/after as NotesRenderer shows them\n`];
    let k = 0;
    for (const c of pick) {
      const page = await db.collection('pages').findOne({ id: c.id }, { projection: { id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } });
      const before = page?.translation?.data || '';
      const ocrs = cls === 'b_original' ? (await ocrWindow(db, c.b, [c.p]))(c.p) : null;
      const res = cleanupPage(before, { classes: [cls], ocrs });
      out.push(`\n## ${++k}. https://sourcelibrary.org/book/${c.b}?page=${c.p}  (page ${c.id})  ${JSON.stringify(res.fired)}`);
      out.push(...hunks(before, res.text, 'RAW'));
      out.push(...hunks(shown(before), shown(res.text), 'READER'));
      if (cls === 'd_termdef') {
        // Before the cleanup the reader already applied this rule at display time, so both views
        // should come out the same as before; what differs is where the stored rule and the display
        // rule disagree. AFTER lines show the changed regions as the reader will prepare them.
        out.push(...hunks(prepared(before, true), prepared(res.text, true), 'NOTES-ON'));
        out.push(...hunks(prepared(before, false), prepared(res.text, false), 'NOTES-OFF'));
        out.push(...chipViews(before, prepared(res.text, true), prepared(res.text, false)));
      }
      if (cls === 'b_original') for (const q of res.fired.b_original || []) out.push(`  OCR nearest to "${q}": ${nearest(q, ocrs.join('\n'))}`);
    }
    const f = path.join(DIR, `review-${cls}${seed === 5700 ? '' : `-seed${seed}`}.md`);
    fs.writeFileSync(f, out.join('\n') + '\n');
    console.log(`${cls}: ${pick.length} pages → ${f}`);
  }
  await client.close();
}
/** d_termdef, one block per definition chip of the stored page: the chip as stored, then the same
 *  place as the reader prepares the cleaned page with notes ON and with notes OFF. `LEAK` marks a
 *  definition still present with notes off. */
function chipViews(before, on, off) {
  const out = [];
  const flat = (x) => x.replace(/\s+/g, ' ');
  for (const m of before.matchAll(/<term>([^<\n]*?)<\/term>/gi)) {
    const sp = splitTermDefinition(m[1]);
    if (!sp) continue;
    const key = sp.definition.slice(0, 40);
    out.push(`  CHIP  ${flat(before.slice(Math.max(0, m.index - 70), m.index + m[0].length + 40))}`);
    const i = on.indexOf(key);
    if (i < 0) { out.push('    ON   (definition not found in the prepared text)'); continue; }
    const noteAt = on.lastIndexOf('<note>', i);
    out.push(`    ON   ${flat(on.slice(Math.max(0, noteAt - 90), i + sp.definition.length + 50))}`);
    const lead = on.slice(0, noteAt).replace(/<term>[^<]*<\/term>\s*$/, '').replace(/<note>[^<]*<\/note>/g, '').replace(/<\/?(?:term|interp|margin|gloss|insert|unclear)>/g, '');
    const anchor = lead.slice(-30).trim();
    const j = anchor.length > 8 ? off.indexOf(anchor) : -1;
    out.push(`    OFF  ${off.includes(key) ? 'LEAK ' : ''}${j < 0 ? `(anchor "${anchor}" not found)` : flat(off.slice(Math.max(0, j - 50), j + anchor.length + 90))}`);
  }
  return out;
}
/** Changed regions of two texts, line-based, with the differing lines side by side. */
function hunks(a, b, label, max = 16) {
  if (a === b) return [`  ${label}: (identical)`];
  const A = a.split('\n'), B = b.split('\n');
  const out = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (A[i] === B[j]) { i++; j++; continue; }
    // resync: nearest following line the two share
    let di = 1, dj = 1, found = false;
    for (let span = 1; span < 40 && !found; span++) for (let x = 0; x <= span && !found; x++) { const y = span - x; if (i + x < A.length && j + y < B.length && A[i + x] === B[j + y]) { di = x; dj = y; found = true; } }
    if (!found) { di = A.length - i; dj = B.length - j; }
    const [x, y] = trimPair(A.slice(i, i + di).join(' ⏎ '), B.slice(j, j + dj).join(' ⏎ '));
    out.push(`  ${label} −  ${x}`); out.push(`  ${label} +  ${y}`);
    i += di; j += dj;
    if (out.length > max) { out.push(`  ${label} … (more)`); break; }
  }
  return out;
}
/** Cut the shared head and tail of two strings down to 60 characters of context each. */
function trimPair(x, y) {
  let h = 0; while (h < x.length && h < y.length && x[h] === y[h]) h++;
  let t = 0; while (t < x.length - h && t < y.length - h && x[x.length - 1 - t] === y[y.length - 1 - t]) t++;
  const cut = (s) => (h > 60 ? '…' : '') + s.slice(Math.max(0, h - 60), Math.min(s.length, s.length - t + 60)) + (t > 60 ? '…' : '');
  return [cut(x), cut(y)];
}
/** The OCR window sharing the most character trigrams with the quote — for judging a normalisation miss by eye. */
function nearest(q, ocr) {
  const grams = (s) => { const g = new Set(); const z = s.normalize('NFC').toLowerCase().replace(/\s+/g, ' '); for (let i = 0; i + 3 <= z.length; i++) g.add(z.slice(i, i + 3)); return g; };
  const qg = grams(q); const flat = ocr.replace(/\s+/g, ' ');
  const w = Math.max(q.length + 10, 30); let best = 0, at = 0;
  for (let i = 0; i < flat.length; i += Math.max(1, Math.floor(q.length / 4))) {
    const g = grams(flat.slice(i, i + w)); let c = 0; for (const x of qg) if (g.has(x)) c++;
    if (c > best) { best = c; at = i; }
  }
  return `${qg.size ? Math.round((100 * best) / qg.size) : 0}% trigrams — "${flat.slice(Math.max(0, at - 10), at + w + 10)}"`;
}

/** --apply: re-read each candidate page, recompute, write through repairTranslationText. */
async function apply() {
  const { repairTranslationText } = await import('../lib/translation-text-repair.mjs');
  const classes = arg('--classes', '').split(',').filter(Boolean);
  if (!classes.length || classes.some((c) => !CLASSES.includes(c))) throw new Error(`--classes required, from ${CLASSES.join(',')}`);
  const run = runFor(classes);
  const perClass = Number(arg('--limit-per-class', 0));
  const already = new Set(readLines(fp('applied')).map((l) => JSON.parse(l)).filter((r) => r.status !== 'error').map((r) => r.id));
  let cands = loadCandidates().filter((c) => !c.x && classes.some((k) => c.f[k]));
  if (perClass) {
    const order = seededOrder(cands.sort((a, b) => (a.id < b.id ? -1 : 1)), 57002);
    const take = new Map();
    for (const cls of classes) for (const c of order.filter((x) => x.f[cls]).slice(0, perClass)) take.set(c.id, c);
    cands = [...take.values()];
  }
  const todo = cands.filter((c) => !already.has(c.id));
  const byBook = new Map();
  for (const c of todo) (byBook.get(c.b) || byBook.set(c.b, []).get(c.b)).push(c);
  console.error(`apply [${classes.join(',')}]: ${cands.length} pages selected, ${todo.length} to do in ${byBook.size} books`);
  const { client, db } = await connect();
  const log = fs.createWriteStream(fp('applied'), { flags: 'a' });
  const tally = {}; let n = 0; const t0 = Date.now();
  await pool([...byBook.entries()], CONC, async ([bid, cs]) => {
    const ids = cs.map((c) => c.id);
    const pages = [];
    for (let i = 0; i < ids.length; i += 200) pages.push(...await retry(() => db.collection('pages').find({ id: { $in: ids.slice(i, i + 200) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, translation: 1 } }).toArray()));
    const wantB = classes.includes('b_original') ? pages.filter((p) => /<note>\s*original:/i.test(p.translation?.data || '')).map((p) => p.page_number) : [];
    const ocrOf = wantB.length ? await ocrWindow(db, bid, wantB) : null;
    for (const page of pages) {
      let rec;
      try {
        const before = page.translation?.data;
        const res = cleanupPage(before, { classes, ocrs: ocrOf && wantB.includes(page.page_number) ? ocrOf(page.page_number) : null });
        const fired = Object.keys(res.fired);
        const r = await repairTranslationText(db, page, res.text, { expectBefore: before, source: run.source, issue: run.issue, jobId: run.jobId, apply: true,
          reason: `deterministic cleanup: ${fired.map((k) => WHAT[k]).join('; ') || 'none'}. No model, no retranslation` });
        rec = { id: page.id, b: bid, p: page.page_number, status: r.status, why: r.why, f: fired };
      } catch (e) { rec = { id: page.id, b: bid, p: page.page_number, status: 'error', why: String(e.message || e).slice(0, 200) }; }
      log.write(JSON.stringify(rec) + '\n');
      const key = rec.status === 'written' ? 'written' : `${rec.status}:${rec.why}`;
      tally[key] = (tally[key] || 0) + 1;
      if (++n % 500 === 0) fs.writeFileSync(fp('progress'), JSON.stringify({ mode: 'apply', classes, done: n, todo: todo.length, tally, elapsed_s: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }));
    }
  });
  await new Promise((r) => log.end(r));
  await client.close();
  fs.writeFileSync(fp('progress'), JSON.stringify({ mode: 'apply', classes, done: n, todo: todo.length, tally, finished: true, at: new Date().toISOString() }));
  console.log(JSON.stringify({ selected: cands.length, done_this_run: n, tally }, null, 1));
}

/**
 * --resync: push the written pages' English to the Supabase `pages` mirror (no embedding call).
 * --resync --snippets: instead rewrite the `translation` column of `page_translations` (the
 *   semantic-search snippet). Kept apart because it is ~60× dearer per row: measured 2026-10-03,
 *   4 ms/row for `pages` against 235 ms/row for `page_translations`, whose rows sit under the HNSW
 *   vector index — a non-HOT update re-inserts the vector. The vector itself is never recomputed.
 */
async function resync() {
  const snippets = flag('--snippets');
  const { pageEmbeddingInput } = await import('../lib/page-embedding-text.mjs');
  const { default: pg } = await import('pg');
  const written = [...new Set(readLines(fp('applied')).map((l) => JSON.parse(l)).filter((r) => r.status === 'written').map((r) => r.id))];
  const ckpt = path.join(DIR, snippets ? 'resynced-snippets.txt' : F.resynced);
  const done = new Set(readLines(ckpt));
  const todo = written.filter((id) => !done.has(id));
  console.error(`resync ${snippets ? 'page_translations' : 'pages mirror'}: ${written.length} written, ${todo.length} to push`);
  const { client, db } = await connect();
  const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await sb.connect();
  const log = fs.createWriteStream(ckpt, { flags: 'a' });
  let updated = 0;
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i += 200) {
    const ids = todo.slice(i, i + 200);
    const pages = await retry(() => db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, 'translation.data': 1 } }).toArray());
    const live = pages.filter((p) => typeof p.translation?.data === 'string');
    if (snippets) {
      const emb = live.map((p) => [p.id, pageEmbeddingInput(p)]).filter(([, e]) => e?.hasTranslation);
      const r = await retry(() => sb.query('UPDATE page_translations AS t SET translation = d.txt FROM unnest($1::text[], $2::text[]) AS d(id, txt) WHERE t.page_id = d.id AND t.translation IS NOT NULL AND t.translation IS DISTINCT FROM d.txt', [emb.map(([id]) => id), emb.map(([, e]) => e.text.slice(0, 50000))]));
      updated += r.rowCount;
    } else {
      const r = await retry(() => sb.query('UPDATE pages AS t SET translation_data = d.txt FROM unnest($1::text[], $2::text[]) AS d(id, txt) WHERE t.id = d.id AND t.translation_data IS DISTINCT FROM d.txt', [live.map((p) => p.id), live.map((p) => p.translation.data)]));
      updated += r.rowCount;
    }
    log.write(ids.join('\n') + '\n');
    if ((i / 200) % 25 === 0) { console.error(`${i + ids.length}/${todo.length} · updated ${updated}`); fs.writeFileSync(path.join(DIR, 'progress-resync.json'), JSON.stringify({ mode: snippets ? 'resync-snippets' : 'resync', done: i + ids.length, todo: todo.length, updated, elapsed_s: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() })); }
  }
  await new Promise((r) => log.end(r));
  await sb.end(); await client.close();
  fs.writeFileSync(path.join(DIR, 'progress-resync.json'), JSON.stringify({ mode: snippets ? 'resync-snippets' : 'resync', done: todo.length, todo: todo.length, updated, finished: true, at: new Date().toISOString() }));
  console.log(JSON.stringify({ table: snippets ? 'page_translations' : 'pages', pushed: todo.length, updated }, null, 1));
}

/**
 * --undo: put back the text a page held before this cleanup. Per page: the newest revision row
 * with this script's source is the text to restore, and it is restored only while the page still
 * holds exactly what the cleanup wrote (after_content_hash) — a page retranslated or edited since
 * is left alone. Goes through repairTranslationText, so the undo is itself a revision row.
 *   --ids <file|id,id>   default: every `written` page in applied.jsonl
 */
async function undo() {
  const { repairTranslationText } = await import('../lib/translation-text-repair.mjs');
  const run = runFor(classesArg(A2_CLASSES));
  const idsArg = arg('--ids', null);
  const ids = idsArg ? (fs.existsSync(idsArg) ? readLines(idsArg) : idsArg.split(',')) : [...new Set(readLines(fp('applied')).map((l) => JSON.parse(l)).filter((r) => r.status === 'written').map((r) => r.id))];
  const { client, db } = await connect();
  const tally = {};
  const log = fs.createWriteStream(path.join(DIR, 'undone.jsonl'), { flags: 'a' });
  await pool(ids, CONC, async (id) => {
    let status;
    try {
      const rev = await db.collection('page_revisions').find({ page_id: id, field: 'translation', source: run.source }).sort({ created_at: -1 }).limit(1).next();
      const page = await db.collection('pages').findOne({ id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, translation: 1 } });
      if (!rev || !page) status = 'no_revision';
      else if (page.translation?.content_hash !== rev.after_content_hash) status = 'changed_since';
      else {
        const r = await repairTranslationText(db, page, rev.data, { expectBefore: page.translation.data, source: `${run.source}-undo`, issue: run.issue, jobId: run.jobId, apply: true, reason: `undo of ${run.source}: text restored from revision ${rev.id}` });
        status = r.status === 'written' ? 'restored' : `${r.status}:${r.why}`;
      }
    } catch (e) { status = `error:${String(e.message || e).slice(0, 120)}`; }
    tally[status] = (tally[status] || 0) + 1;
    log.write(JSON.stringify({ id, status }) + '\n');
  });
  await new Promise((r) => log.end(r));
  await client.close();
  console.log(JSON.stringify({ pages: ids.length, tally }, null, 1));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(DIR, { recursive: true });
  const run = flag('--scan') ? scan : flag('--review') ? review : flag('--apply') ? apply : flag('--resync') ? resync : flag('--undo') ? undo : flag('--summary') ? async () => summarise(null) : null;
  if (!run) { console.error('one of --scan | --summary | --review | --apply | --resync | --undo'); process.exit(1); }
  run().catch((e) => { console.error(e); process.exit(1); });
}
