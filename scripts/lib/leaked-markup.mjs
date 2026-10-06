// PRIOR ART: src/lib/normalize-annotation-spans.ts — balances the note-family tags for the
// reader only, and knows nothing of <meta>, <term>, entities or the break markers;
// scripts/maintenance/translation-cleanup-a2-5700.mjs (`c_tags`, `c_visible`) — rewrites STORED
// text for the faults a deletion can fix, one run, with revision rows; it is not on any read path,
// so a page translated after it leaks again. scripts/lib/page-integrity.mjs `decodeEntities` turns
// an entity into the letter "x" for a length measure, which is not text a reader can be shown.
/**
 * Read-time repair of markup the translation model leaked into a page's English (#5700 A1(c)).
 *
 * ONE implementation, plain JavaScript, imported by the reader (`NotesRenderer`), by
 * `src/lib/strip-editorial-wrappers.ts` and by its scripts twin — so the reader, the quote and
 * snippet surfaces and the exports cannot disagree about what a leak is. No stored text changes.
 *
 * Every rule deletes markup or a repeated word; none writes a word the page did not carry.
 * Each was built from a real page (tests/unit/leaked-markup.test.ts quotes them):
 *
 *   break_tag     `</leaf-break/>`, `</column-break/>` — a marker written as a closer. The reader
 *                 printed it as literal text.
 *   meta_attr     `<meta type="…">` — the reader pairs a bare `<meta>` only, so the note fell into
 *                 the body.
 *   meta_label    `<meta>continues from previous page: …` with no `</meta>`. The words after the
 *                 label are the page's own text (hand-read: the whole page follows). Only the
 *                 opener and the label go. A bare label at the very top of a page goes too.
 *   tag_attr      `<note original: "御定佩文韻府">` — the note's first words written as attributes.
 *                 They move inside the note, or become the note when nothing closes it.
 *   dup_term      `the Vedas <term>Vedas</term>` — the word, then the same word as a term chip.
 *                 The plain copy goes.
 *   stutter       `two inches <gloss>in</gloss>ches` — a word, then the same word again with a tag
 *                 through it. The tagged copy goes.
 *   entity        `&nbsp;`, `&emsp;`, `&amp;` … decoded. Markdown decodes them in the reader; every
 *                 plain-text surface printed them. `&lt;` and `&gt;` stay encoded (decoding them
 *                 would make a tag), and so do numeric entities for ASCII (they escape Markdown).
 *   hash          heading hashes that are not at the start of a line (`BOOK THREE ###`,
 *                 `25 ### That the cause…`): Markdown prints them.
 *
 * NOT here, on purpose: `<term>X: definition</term>` and a model-written `<gloss>` after a term
 * (src/lib/term-definitions.ts, #5895 — it runs after this on the reader and the exports); a
 * closed continuity `<meta>` that holds page text (`metaPayload()` in page-integrity.mjs, #5305);
 * the Esukhia `#` note points (`stripHashMarks` in tengyur-draft-repairs-5497.mjs — inside a line
 * a `#` can be the source's: `C#`, `# 2`).
 */

const WS_ENTITY = { nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ' };
const NAMED_ENTITY = {
  amp: '&', quot: '"', apos: "'", mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sect: '§', para: '¶', middot: '·', shy: '',
};
const WS_ENTITY_RUN = /(?:&(?:nbsp|ensp|emsp|thinsp);[ \t]*)+/gi;
const ENTITY = /&(?:([a-zA-Z]{2,8})|#(\d{2,6})|#[xX]([0-9a-fA-F]{2,5}));/g;

/** The continuity label the translation prompt asks for, as the model writes it. */
const CONT_LABEL = /^[ \t]*continue[sd]?[ \t]+from[ \t]+(?:the[ \t]+)?(?:previous[ \t]+page|page[ \t]+\d+)[ \t]*[:.…—–-]*[ \t]*/i;
const BARE_LABEL = /^(\s*)continues from (?:the )?previous page[ \t]*[:.…—–-]*[ \t]*/;
const PARAGRAPH_BREAK = /\n[ \t]*\n/;
/** How far a note's closer is looked for. A note is a sentence or two; unbounded, a junk page goes quadratic. */
const NOTE_LOOKAHEAD = 4000;
// What may stand before a repeated word: a space or opening punctuation. Not a letter (a longer
// word) and not `>` (the tail of a word a tag runs through: `<unclear>k</unclear>ai`).
const WORD_EDGE = /[\s(\["“‘'*_—–-]/;

function count(fired, rule, n = 1) { if (fired && n) fired[rule] = (fired[rule] || 0) + n; }

function fixMeta(text, fired) {
  if (!/<meta\b/i.test(text) && !BARE_LABEL.test(text)) return text;
  // `<meta catchword="Return"/>` has no content and no closer: as an opener it would pair with
  // the NEXT `</meta>` and hide the page text between them.
  let out = text.replace(/<meta(?:\s[^<>]*)?\/>/gi, () => { count(fired, 'meta_attr'); return ''; })
    .replace(/<meta\s[^<>]*>/gi, () => { count(fired, 'meta_attr'); return '<meta>'; });
  // An opener that carries the label and meets another opener, or the end, before any closer.
  // `lastClose` keeps this linear: past it nothing can close, so nothing is searched.
  const lower = out.toLowerCase();
  const lastClose = lower.lastIndexOf('</meta>');
  out = out.replace(/<meta>([^<]*)/gi, (whole, body, at) => {
    const label = CONT_LABEL.exec(body);
    if (!label) return whole;
    const from = at + whole.length;
    if (from <= lastClose) {
      const close = lower.indexOf('</meta>', from), next = lower.indexOf('<meta>', from);
      if (next === -1 || close < next) return whole;
    }
    count(fired, 'meta_label');
    return body.slice(label[0].length);
  });
  return out.replace(BARE_LABEL, (_m, lead) => { count(fired, 'meta_label'); return lead; });
}

/**
 * `<note original: "御定佩文韻府">The Peiwen Yunfu…</note>` → the words move inside the note. Where
 * nothing closes it in its own paragraph (`"No Sheep" <note original: "无羊"> refers to…`) the
 * words ARE the whole note.
 */
function fixTagAttrs(text, fired) {
  return text.replace(/<(note|gloss|margin|term|insert|unclear)[ \t]+(original:[^<>]*?)[ \t]*>/gi, (_m, tag, words, at, all) => {
    count(fired, 'tag_attr');
    const rest = all.slice(at + _m.length, at + _m.length + NOTE_LOOKAHEAD);
    const brk = rest.search(PARAGRAPH_BREAK);
    const para = brk === -1 ? rest : rest.slice(0, brk);
    const close = para.search(new RegExp(`</${tag}>`, 'i')), next = para.search(new RegExp(`<${tag}[\\s>]`, 'i'));
    if (close === -1 || (next !== -1 && next < close)) return `<${tag}>${words}</${tag}>`;
    return `<${tag}>${words}${/[.;:,]$/.test(words) ? '' : ';'} `;
  });
}

/**
 * `the Vedas <term>Vedas</term>` → `the <term>Vedas</term>`, keeping the running text's casing.
 * A pair that opens its line is left alone: in a word list (`orator <term>orator</term>`) the two
 * are an English word and its source word that happen to be spelled alike.
 */
function fixDupTerms(text, fired) {
  if (!/<term>/i.test(text)) return text;
  const RE = /<term>([^<>\n]{3,60})<\/term>/gi;
  let res = '', cursor = 0, m;
  while ((m = RE.exec(text)) !== null) {
    const term = m[1];
    const gap = gapStart(text, m.index);
    const start = gap - term.length;
    if (gap === m.index || start <= cursor || text[start - 1] === '\n') continue;
    const same = text.slice(start, gap);
    if (same.toLowerCase() !== term.toLowerCase() || !WORD_EDGE.test(text[start - 1])) continue;
    res += text.slice(cursor, start) + `<term>${same}</term>`;
    cursor = RE.lastIndex;
    count(fired, 'dup_term');
  }
  return cursor ? res + text.slice(cursor) : text;
}

/** Index where the run of spaces and tabs ending at `at` begins (`at` itself when there is none). */
function gapStart(text, at) {
  let i = at;
  while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) i--;
  return i;
}

/** `inches <gloss>in</gloss>ches` → `inches`. */
function fixStutter(text, fired) {
  if (!/<\/(?:gloss|term|unclear|insert)>\p{L}/u.test(text)) return text;
  const RE = /<(gloss|term|unclear|insert)>(\p{L}{1,20})<\/\1>(\p{L}{1,20})/giu;
  let res = '', cursor = 0, m;
  while ((m = RE.exec(text)) !== null) {
    const word = m[2] + m[3];
    const gap = gapStart(text, m.index);
    const start = gap - word.length;
    if (gap === m.index || start < cursor) continue;
    if (text.slice(start, gap).toLowerCase() !== word.toLowerCase()) continue;
    if (start > 0 && !WORD_EDGE.test(text[start - 1])) continue;
    res += text.slice(cursor, gap);
    cursor = RE.lastIndex;
    count(fired, 'stutter');
  }
  return cursor ? res + text.slice(cursor) : text;
}

function fixEntities(text, fired, plain) {
  if (text.indexOf('&') === -1) return text;
  let out = text;
  if (plain) {
    // Plain text has no indent to keep: a run of spacing entities is one space, none at a line start.
    out = out.replace(WS_ENTITY_RUN, (run, at, all) => {
      count(fired, 'entity');
      const prev = at === 0 ? '\n' : all[at - 1];
      return prev === '\n' || prev === ' ' || prev === '\t' ? '' : ' ';
    });
  }
  return out.replace(ENTITY, (whole, name, dec, hex) => {
    let ch;
    if (name) {
      const key = name.toLowerCase();
      ch = WS_ENTITY[key] ?? NAMED_ENTITY[key];
    } else {
      const code = dec ? Number(dec) : parseInt(hex, 16);
      // ASCII stays encoded: `&#124;` in a table cell and `&#42;` are Markdown escapes, and
      // `&#60;` would open a tag.
      if (code >= 160 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF)) ch = String.fromCodePoint(code);
    }
    if (ch === undefined) return whole;
    count(fired, 'entity');
    return ch;
  });
}

// A heading may sit in a blockquote or a list item, or behind the reader's centring arrow.
/** `TITLE ###` or `TITLE ### <-` without its hashes, or null. By hand: a regex here is quadratic on a long run of spaces. */
function trailingHashes(line) {
  let end = line.length;
  const blank = (i) => line[i] === ' ' || line[i] === '\t';
  while (end > 0 && blank(end - 1)) end--;
  if (end >= 2 && line[end - 2] === '<' && line[end - 1] === '-') { end -= 2; while (end > 0 && blank(end - 1)) end--; }
  let h = end;
  while (h > 0 && line[h - 1] === '#') h--;
  if (h === end || end - h > 6 || h === 0 || !blank(h - 1)) return null;
  let keep = h;
  while (keep > 0 && blank(keep - 1)) keep--;
  return keep === 0 ? null : line.slice(0, keep) + line.slice(end);
}

const HEADING_START = /^[ \t]*(?:>[ \t]*)*(?:[-*+][ \t]+)?(?:->[ \t]*)?#{1,6}(?:[ \t]|$)/;

function fixHashes(text, fired) {
  if (text.indexOf('#') === -1) return text;
  return text.split('\n').map((line) => {
    if (line.indexOf('#') === -1 || /https?:\/\//.test(line)) return line;
    const head = HEADING_START.exec(line)?.[0] || '';
    let rest = line.slice(head.length);
    if (!rest.includes('#')) return line;
    // Hashes closing a line that no heading opened ("THE WALDENSIANS: BOOK THREE ###").
    if (!head) {
      const cut = trailingHashes(rest);
      if (cut) { rest = cut; count(fired, 'hash'); }
    }
    // A heading marker with something in front of it ("25 ### That the cause…", "| ### SECTION 3").
    rest = rest.replace(/(^|[^#\s][ \t]+|\|)#{2,6}[ \t]+(?=\S)/g, (_m, lead) => { count(fired, 'hash'); return lead; });
    // … or wrapped in a tag, where Markdown never reads it ("<center># Translation</center>").
    rest = rest.replace(/(<[a-zA-Z][\w-]*>)#{1,6}[ \t]+(?=[^\s\d])/g, (_m, lead) => { count(fired, 'hash'); return lead; });
    return head + rest;
  }).join('\n');
}

export const LEAK_RULES = ['break_tag', 'meta_attr', 'meta_label', 'tag_attr', 'dup_term', 'stutter', 'entity', 'hash'];

/**
 * @param {string} text a page's stored translation or transcription
 * @param {{ plain?: boolean, fired?: Record<string, number> }} [opts]
 *   `plain`: the caller serves plain text (quotes, snippets, exports), so spacing entities
 *   collapse to a space instead of becoming no-break spaces. `fired`: filled with the number of
 *   repairs per rule — the census reads it (scripts/audit/leaked-markup-census.mjs).
 * @returns {string}
 */
export function repairLeakedMarkup(text, opts) {
  if (!text || typeof text !== 'string') return text;
  if (text.indexOf('<') === -1 && text.indexOf('&') === -1 && text.indexOf('#') === -1 && !BARE_LABEL.test(text)) return text;
  const fired = opts?.fired;
  let out = text.replace(/<\/(leaf-break|column-break)\s*\/?>/gi, (_m, name) => { count(fired, 'break_tag'); return `<${name.toLowerCase()}/>`; });
  out = fixMeta(out, fired);
  if (/<[a-z]+[ \t]+original:/i.test(out)) out = fixTagAttrs(out, fired);
  out = fixDupTerms(out, fired);
  out = fixStutter(out, fired);
  out = fixEntities(out, fired, !!opts?.plain);
  return fixHashes(out, fired);
}
