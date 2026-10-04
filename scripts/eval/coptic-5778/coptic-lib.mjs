/**
 * PRIOR ART: scripts/eval/lib/metrics.mjs (`levenshtein`, `cleanMarkup` — global distance only, and
 * its tag strip eats text between `->centred<-` markers); scripts/eval/en-ocr-reference-5124.mjs
 * (English normaliser, Wikisource page join). Neither folds Coptic, reads SCRIPTORIUM's TreeTagger
 * SGML, or scores a reference unit INSIDE a longer page read, which is what a verse-level reference
 * under a page with apparatus needs. Shared helpers for the Coptic OCR probe (#5778).
 */
import fs from 'node:fs';

// Greek-block letters an engine may emit for the visually identical Coptic ones.
const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
const COPTIC = 'ⲁⲃⲅⲇⲉⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱ';
const G2C = new Map([...GREEK].map((g, i) => [g, [...COPTIC][i]]));
G2C.set('ς', 'ⲥ'); G2C.set('ϲ', 'ⲥ');

const isCopticLetter = (cp) =>
  (cp >= 0x2c80 && cp <= 0x2ce4) || (cp >= 0x2ceb && cp <= 0x2cee) || cp === 0x2cf2 || cp === 0x2cf3 ||
  (cp >= 0x3e2 && cp <= 0x3ef);

/**
 * THE NORMALISATION RULE (stated in the write-up; one rule for reference and every engine):
 *  1. NFD, then drop every combining mark (supralinear strokes U+0304/0305/FE24–FE26, jinkim
 *     U+0300/0307, diaeresis, circumflex, underdots) — editions and engines disagree on them.
 *  2. Lowercase; fold Greek-block letters to their Coptic-block twins (counted separately).
 *  3. Keep ONLY Coptic letters (U+2C80–2CE4, 2CEB–2CEE, 2CF2–2CF3, U+03E2–03EF). Spaces, line
 *     breaks, punctuation, digits, Latin and markup all go: Coptic word division is editorial.
 * Returns an array of code points (strings), so distances are in letters, not UTF-16 units.
 */
export function normCoptic(s, stats) {
  const out = [];
  for (const ch0 of s.normalize('NFD').toLowerCase()) {
    let ch = ch0;
    if (G2C.has(ch)) { ch = G2C.get(ch); if (stats) stats.greek = (stats.greek || 0) + 1; }
    if (isCopticLetter(ch.codePointAt(0))) out.push(ch);
  }
  return out;
}

const DROP_ELEMENTS = ['header', 'footer', 'page-num', 'sig', 'margin', 'vocab', 'warning', 'image-desc', 'language', 'script', 'page-type', 'scan-quality', 'columns', 'note', 'footnote', 'meta', 'summary', 'keywords'];
/** OCR output → the text an engine claims is on the page. `dropBracketed` removes [restorations]. */
export function cleanOcr(text, { dropBracketed = false } = {}) {
  let t = String(text || '');
  for (const el of DROP_ELEMENTS) t = t.replace(new RegExp(`<${el}\\b[^<>]*>[\\s\\S]*?</${el}>`, 'g'), ' ');
  t = t.replace(/->|<-/g, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');
  if (dropBracketed) t = t.replace(/\[[^\[\]\n]{0,80}\]/g, ' ');
  return t;
}

/**
 * Sellers' approximate matching: the edit distance between `pat` and the BEST-matching substring of
 * `txt` (free start and end in the text). Extra text on the page — apparatus, running heads, verse
 * numbers, the neighbouring verse — costs nothing; a letter missing or wrong inside the unit does.
 * Capped at pat.length (a unit the read does not contain at all scores 100%, not more).
 */
export function infixDistance(pat, txt) {
  const m = pat.length, n = txt.length;
  if (!m) return { dist: 0, end: 0 };
  let prev = new Uint32Array(n + 1), cur = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const pc = pat[i - 1];
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (pc === txt[j - 1] ? 0 : 1);
      const del = prev[j] + 1, ins = cur[j - 1] + 1;
      cur[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
    }
    [prev, cur] = [cur, prev];
  }
  let best = m, end = 0;
  for (let j = 0; j <= n; j++) if (prev[j] < best) { best = prev[j]; end = j; }
  return { dist: Math.min(best, m), end };
}

const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? m[1] : null; };
const unesc = (s) => (s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * Parse one SCRIPTORIUM `*.tt` (TreeTagger SGML) file into its diplomatic text.
 * Token lines carry the `orig` form (with strokes). Returns
 *   { meta, units: [{ page, verse, chapter, english, text, extant }] }
 * `text` is everything the edition prints, bound groups separated by spaces, lines by \n;
 * `extant` omits letters inside <supplied …> (editorial restorations of lacunae).
 * A unit is a (page, verse) cell, so callers can regroup by page (manuscripts) or verse (Bibles).
 */
export function parseTT(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const meta = {};
  const units = [];
  let page = null, verse = null, chapter = null, english = null, supplied = 0, cur = null;
  const open = () => { cur = { page, verse, chapter, english, text: '', extant: '' }; units.push(cur); };
  const sep = (c) => { if (cur && cur.text && !/[\s]$/.test(cur.text)) { cur.text += c; cur.extant += c; } };
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('<meta')) { for (const m of line.matchAll(/([\w.:-]+)="([^"]*)"/g)) meta[m[1]] = unesc(m[2]); continue; }
    if (line.startsWith('</')) { if (line.startsWith('</supplied')) supplied = Math.max(0, supplied - 1); continue; }
    if (line.startsWith('<')) {
      const name = line.slice(1).match(/^[\w.:-]+/)?.[0] || '';
      if (name === 'pb_xml_id') { page = attr(line, 'pb_xml_id'); cur = null; }
      else if (name === 'verse_n') { verse = attr(line, 'vname') || attr(line, 'verse_n'); const tr = attr(line, 'translation'); english = tr != null ? unesc(tr) : null; cur = null; }
      else if (name === 'translation') { english = unesc(attr(line, 'translation')); if (cur) cur.english = english; }
      else if (name === 'chapter_n') { chapter = attr(line, 'chapter_n'); cur = null; }
      else if (name.startsWith('supplied')) supplied++;
      else if (name === 'lb_n') sep('\n');
      else if (name === 'orig_group' || (name === 'norm_group' && /orig_group=/.test(line))) sep(' ');
      continue;
    }
    if (!cur) open();
    cur.text += line;
    if (!supplied) cur.extant += line;
  }
  return { meta, units: units.filter((u) => u.text.trim()) };
}
