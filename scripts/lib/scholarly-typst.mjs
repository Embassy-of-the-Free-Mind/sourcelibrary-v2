/**
 * Scholarly PDF generator using Typst — the PDF deposited with Zenodo.
 *
 * Its reader arrived from a DOI citation and has no site around them: the PDF
 * is the whole impression, and once deposited it is permanent. (The reader
 * download is a different generator: src/lib/pdf-export.ts.)
 *
 * Layout: A4, a ~75-character text column, and a margin column that carries
 *   - the source-page number where each page begins (the citable anchor),
 *     with the source's own printed page number beside it when known
 *   - the original's marginal notes, where the original has them
 * Footnotes (the translation's explanatory notes) number from 1 per page.
 * Title page, imprint page with "cite as", contents built from book.chapters,
 * running heads, front matter (intro, methodology), index, colophon.
 *
 * Produces a .typ file, then compiles with `typst compile`. Uses only fonts
 * embedded in the typst binary (Libertinus Serif), so it renders the same on
 * the laptop and on Hetzner. Inspect changes without minting:
 *   node scripts/qa/render-scholarly-pdf.mjs <bookId>
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import crypto from 'crypto';
import { cleanOcrArtifacts } from './strip-editorial-wrappers.mjs';

// ── Text processing ─────────────────────────────────────────────────

// Tags whose CONTENT is about the page, not of it — dropped content-and-all.
// `header` is the source's printed running head: it repeats on every page in
// whatever half-translated form the model gave it that time, so it goes; the
// edition carries its own running heads.
const DROP_TAGS = 'meta|page-type|columns|detected-images|lang|language|folio|sig|header|warning|abbrev|vocab|summary|keywords|section-intro|image-desc|scan-quality|script';

const ENTITIES = { nbsp: ' ', emsp: ' ', ensp: ' ', thinsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–', hellip: '…' };

/** Decode the handful of HTML entities the models emit; whitespace ones become a plain space. */
function decodeEntities(text) {
  return text
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&(?:nbsp|emsp|ensp)\b/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Strip markup from text headed for a footnote or margin note (plain prose, one paragraph). */
function cleanForNote(text) {
  let s = text.trim();
  s = s.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '[?$1]');
  s = s.replace(/<note>([\s\S]*?)<\/note>/gi, '($1)');
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(/->([\s\S]*?)<-/g, '$1');
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  s = s.replace(/\s*\n+\s*/g, ' ');
  return s.trim();
}

// A marginal note longer than this cannot sit in a 40mm column without
// running down the page and colliding with its neighbours — it becomes a
// footnote labelled as marginal instead.
const MARGIN_NOTE_MAX_CHARS = 220;

// A gloss longer than this is a quotation, not a term: it stays a footnote
// rather than interrupt the sentence
const ORIGINAL_TERM_MAX_WORDS = 5;

/**
 * A third of a translation's notes are `original: "ardorem," meaning heat…` —
 * the source word behind an English rendering, sometimes with a gloss. Split
 * into the term (set inline, see #orig) and the explanation (still a note).
 * Null when the note is not of that shape or the term is a whole quotation.
 */
export function splitOriginalTerm(content) {
  const m = String(content).match(/^\s*original(?:\s+(?:latin|greek|hebrew|german|french|italian|text|word|term))?\s*:\s*([\s\S]+)$/i);
  if (!m) return null;
  let s = m[1].trim();
  let term, rest;
  const quoted = s.match(/^["“'‘]([^"”'’]+)["”'’]\s*([\s\S]*)$/);
  if (quoted) {
    term = quoted[1];
    rest = quoted[2];
  } else {
    // Unquoted: the term runs to the first sentence break or dash
    const cut = s.match(/^([^.;:—–(]+?)(?:\s*[.;:—–]\s+|\s*(?=\())([\s\S]*)$/);
    term = cut ? cut[1] : s;
    rest = cut ? cut[2] : '';
  }
  term = term.replace(/[\s,.;:]+$/, '').trim();
  rest = rest.replace(/^[\s,.;:—–-]+/, '').trim();
  if (!term || term.split(/\s+/).length > ORIGINAL_TERM_MAX_WORDS) return null;
  if (rest) rest = rest[0].toUpperCase() + rest.slice(1);
  return { term, rest };
}

/**
 * The source's printed running head, when the model transcribed it as the
 * page's first line instead of tagging it: "**Cap. V. On the globe of the
 * Earth. 103**", "106        Dialogue II.", or a bare "140". Deliberately
 * narrow — a short standalone first line carrying a page number at one end —
 * because a false positive deletes a line of the author's text.
 * Returns { printedPage, rest } or null.
 */
function splitRunningHead(text) {
  // A bare page number on the first line needs no blank line after it to be safe
  const bare = text.match(/^\s*(?:\*\*)?(\d{1,4})(?:\*\*)?[ \t]*\n/);
  if (bare) return { printedPage: bare[1], rest: text.slice(bare[0].length) };
  const m = text.match(/^\s*([^\n]+)\n\s*\n/);
  if (!m) return null;
  const line = m[1].replace(/^[#>\-*\s]+|[#<\-*\s]+$/g, '').replace(/\s+/g, ' ');
  if (line.length > 70) return null;
  const num = line.match(/^(\d{1,4})\b(?:\s+\D.*)?$/) || line.match(/^\D.*\s(\d{1,4})\.?$/);
  if (!num) return null;
  if (line.split(' ').length > 10) return null;
  return { printedPage: num[1], rest: text.slice(m[0].length) };
}

/**
 * The page's first line, when it is short enough to be a running head —
 * whether set as a heading ("-># IAMBLICHUS #<-") or left as a plain line
 * ("Itineris exstatici"). Returns { key, length } — key for comparing across
 * pages (letters only, so "… 139" and "… 141" match), length to cut.
 * Plain string slicing, not one regex: a lazy match across a 3,000-character
 * first line backtracks for minutes.
 */
function leadingDisplayLine(text) {
  const start = text.search(/\S/);
  const end = start < 0 ? -1 : text.indexOf('\n', start);
  if (end < 0 || end - start > 80) return null;
  // A line carrying a tag is content (a marginal section letter), not a head
  if (text.slice(start, end).includes('<') && !/<-\s*$/.test(text.slice(start, end))) return null;
  const line = text.slice(start, end)
    .replace(/^->\s*/, '').replace(/\s*<-\s*$/, '')
    .replace(/^#{1,6}\s*/, '').replace(/\s*#+\s*$/, '');
  const key = line.replace(/[^\p{L}]+/gu, ' ').trim().toLowerCase();
  return key && line.length <= 60 ? { key, length: end + 1 } : null;
}

/**
 * Markdown-shape marginalia: the model labels the note instead of tagging it,
 * and the label varies — "[Marginal note: …]", "[Marginal note, top right:]",
 * "[Left marginal note 2]:", a bare "Marginal note: …".
 *
 * Where the note ENDS is the hazard. A closed bracket says so. A label with
 * text after it on the line owns that line and no more. A label alone on its
 * line owns the short lines that follow (a margin is narrow, so its lines
 * are), stopping at the first blank or full-width line — on a page without
 * blank lines, "to the end of the paragraph" would file the author's next
 * three speeches in a footnote.
 */
function extractLabelledMarginalia(text, marginal) {
  const closed = /\[(?:(?:left|right|top|bottom)\s+)?marginal notes?[^\]:\n]{0,40}:\s*([^\]]+)\]/gi;
  const label = /(?:\[(?:(?:left|right|top|bottom)\s+)?marginal notes?[^\]:\n]{0,40}(?::\]|\]:?)|^[ \t]*marginal notes?:)[ \t]*/i;
  const lines = text.replace(closed, (_, c) => marginal(c)).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) { out.push(lines[i]); continue; }
    const before = lines[i].slice(0, m.index);
    let note = lines[i].slice(m.index + m[0].length);
    if (!note.trim()) {
      const run = [];
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].trim().length < 48 && run.length < 8 && !label.test(lines[i + 1])) run.push(lines[++i]);
      note = run.join(' ');
    }
    out.push(before + marginal(note));
  }
  return out.join('\n');
}

/**
 * Printed running heads that reached the text as headings. A real chapter
 * title opens one page; a line that opens many is the printer's running head.
 */
export function findRunningHeads(pages) {
  const counts = new Map();
  for (const page of pages) {
    const text = (page.translation?.data || '')
      .replace(new RegExp(`<(${DROP_TAGS}|page-num)(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, 'gi'), '');
    const lead = leadingDisplayLine(text);
    if (lead) counts.set(lead.key, (counts.get(lead.key) || 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 3).map(([key]) => key));
}

/**
 * Convert one page of translation text to Typst markup.
 *
 * Handles both shapes the pipeline has produced over time: the tag-rich one
 * (<note>, <margin>, <term>, <page-num>, <header>…) and the markdown one
 * (# headings, **bold**, "[Marginal note: …]"). Returns the Typst body plus
 * the source's own printed page number when the page states it.
 *
 * - <note>, <gloss>, explanatory <term> → footnotes
 * - <margin> / [Marginal note: …] → set in the margin, as the original has them
 * - # headings and ->centred<- lines → display lines (not outline entries)
 * - *italic* kept; **bold** dropped (the models bold every annotated lemma,
 *   which reads as noise in print)
 * - running heads, metadata tags, HTML remnants and entities stripped
 */
export function translationToTypst(text, { runningHeads = new Set(), anchor = () => '', reflow = false } = {}) {
  if (!text) return { body: '', printedPage: null };

  let out = text;
  let printedPage = null;

  const pageNum = out.match(/<page-num>\s*([^<]{1,12}?)\s*<\/page-num>/i);
  if (pageNum) printedPage = pageNum[1];
  out = out.replace(/<page-num>[\s\S]*?<\/page-num>/gi, '');

  out = out.replace(new RegExp(`<(${DROP_TAGS})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, 'gi'), '');

  // Remove AI preambles — the canonical guard (#3108) catches conversational
  // openers ("Note: the text in the image is in French...") that the narrow
  // regex below misses; it runs after tag removal so a leading tag can't mask
  // the preamble, and it leaves inline tags intact for footnote extraction
  out = cleanOcrArtifacts(out);
  out = out.replace(/^(?:Okay,?\s*)?(?:Here(?:'s| is) (?:the|my) (?:translation|modernization|transcription)[\s\S]*?:\s*\n+)/i, '');

  // HTML remnants: entities (a run of &nbsp; between a page number and a
  // running head is the common one) and presentational tags with attributes
  out = decodeEntities(out);
  out = out.replace(/<\/?(?:div|span|center|p|font|u|sup|sub|br)(?:\s[^>]*)?\/?>/gi, ' ');
  out = out.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '$2');
  out = out.replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*');
  out = out.replace(/[ \t]{2,}/g, ' ');

  // A running head the model set as a heading ("-># IAMBLICHUS #<-"): known
  // because the same leading line recurs across the book (see findRunningHeads)
  const lead = leadingDisplayLine(out);
  if (lead && runningHeads.has(lead.key)) out = out.slice(lead.length);

  const head = splitRunningHead(out);
  if (head) {
    out = head.rest;
    printedPage = printedPage || head.printedPage;
  }

  // Notes become placeholders now and Typst calls after escaping
  const inserts = [];
  const hold = typst => { inserts.push(typst); return `%%IN${inserts.length - 1}%%`; };
  const footnote = content => {
    // "original: «term»" names the word the translation renders: set it in the
    // line, after that word, and keep only any explanation as a note
    const orig = splitOriginalTerm(content);
    if (orig) return hold(`#orig[${escapeTypst(orig.term)}]${orig.rest ? `#footnote[${escapeTypst(orig.rest)}]` : ''};`);
    return hold(`#footnote[${escapeTypst(content)}];`);
  };
  const marginal = content => {
    const clean = cleanForNote(content);
    if (!clean || clean.length < 3) return '';
    return clean.length > MARGIN_NOTE_MAX_CHARS
      ? footnote(`In the margin: ${clean}`)
      : hold(`#mnote[${escapeTypst(clean)}];`);
  };

  // Margins first: they may contain <note> tags, which cleanForNote flattens
  out = out.replace(/<margin>([\s\S]*?)<\/margin>/gi, (_, c) => marginal(c));
  // Markdown-shape marginalia: "[Marginal note: …]" and the block form
  // "[Marginal note:]" followed by its lines up to the next blank line
  out = extractLabelledMarginalia(out, marginal);

  out = out.replace(/<note>([\s\S]*?)<\/note>/gi, (_, c) => {
    const clean = cleanForNote(c);
    return clean ? footnote(clean) : '';
  });
  // A gloss of a word or two ("clock-making" for Horology) is set in the
  // line, in grey; a footnote for each made half of Fludd UCH I's 6,300 notes.
  // A gloss that only repeats the word before it is dropped, and a longer
  // explanation stays a footnote.
  out = out.replace(/<gloss>([\s\S]*?)<\/gloss>/gi, (_, c, at, whole) => {
    const clean = cleanForNote(c).replace(/[.;,]$/, '');
    if (clean.length < 3) return '';
    const before = whole.slice(Math.max(0, at - 60), at).replace(/<[^>]*>/g, ' ').trim().toLowerCase();
    if (before.endsWith(clean.toLowerCase())) return '';
    return isShortGloss(clean) ? hold(`#gl[${escapeTypst(clean)}];`) : footnote(`Gloss: ${clean}`);
  });
  // <term> is used two ways: wrapping a word (keep the word) or carrying an
  // explanation of the preceding word ("hypophetas: from the Greek…") — a note
  out = out.replace(/<term>([\s\S]*?)<\/term>/gi, (_, c) => {
    const clean = cleanForNote(c);
    return clean.length > 40 || /:\s/.test(clean) ? footnote(clean) : clean;
  });

  out = out.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '[?$1]');
  out = out.replace(/<column-break\s*\/?>/gi, '\n\n');
  // <leaf-break/> (#5260): two leaves on one page image, not continuous — a paragraph break.
  out = out.replace(/<leaf-break\s*\/?>/gi, '\n\n');

  // Display lines: markdown headings and ->centred<- text. Level is kept so
  // a chapter title outranks a section title; none enter the PDF outline,
  // which is built from the book's chapter list instead.
  out = out.replace(/^[ \t]*->\s*([\s\S]*?)\s*<-[ \t]*$/gm, (_, c) => {
    const h = c.match(/^(#{1,6})\s*(.*?)\s*#*$/s);
    return `\n\n%%DL${h ? h[1].length : 3}%%${(h ? h[2] : c).replace(/\s*\n\s*/g, ' ')}%%/DL%%\n\n`;
  });
  out = out.replace(/^[ \t]*(#{1,6})\s+(.+?)\s*#*[ \t]*$/gm, (_, hashes, c) => `\n\n%%DL${hashes.length}%%${c}%%/DL%%\n\n`);
  out = out.replace(/->\s*|\s*<-/g, ' ');

  // Any remaining tag, with or without attributes
  out = out.replace(/<\/?[a-z][^>\n]*>/gi, '');

  // Horizontal rules, bold; italic survives as a placeholder pair
  out = out.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  out = out.replace(/\*\*(.+?)\*\*/g, '$1');
  out = out.replace(/(?<![*\w])\*(?![*\s])([^*\n]+?)(?<![*\s])\*(?![*\w])/g, '%%EM%%$1%%/EM%%');

  // Markdown table rows don't survive typesetting — keep the cell content
  out = out.replace(/^\|.*\|$/gm, (line) => {
    if (/^[\s|:-]+$/.test(line)) return '';
    const cells = line.split('|').map(c => c.trim()).filter(c => c && !/^[-:]+$/.test(c));
    return cells.join(' — ');
  });

  // A transcription keeps the source's line breaks, so every paragraph is
  // short lines and words split across them; as reading text it reflows,
  // with the printer's end-of-line hyphens closed up ("la-/tet" → "latet")
  if (reflow) out = out.replace(/(\p{L})[-¬=]\n(?=\p{Ll})/gu, '$1');

  out = escapeTypst(out);

  // Paragraph pass: keep the line structure of lists (an index, a table of
  // plant names, verse) — prose lines reflow, short-line blocks do not
  const paragraphs = out.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const rendered = [];
  let pendingNotes = '';
  // The source-page anchor rides inside the page's first block, so it sits
  // beside that block's first line whatever the block is
  let pendingAnchor = anchor(printedPage);
  const takeAnchor = () => { const a = pendingAnchor; pendingAnchor = ''; return a; };
  for (let para of paragraphs) {
    // A margin note transcribed on its own lines would otherwise become an
    // empty paragraph; carry it to the start of the text it sits beside
    if (/^(?:%%IN\d+%%\s*)+$/.test(para) && para.split('%%IN').slice(1).every(s => inserts[parseInt(s, 10)].startsWith('#mnote'))) {
      pendingNotes += para.replace(/\s+/g, '');
      continue;
    }
    const display = para.match(/^%%DL(\d)%%([\s\S]*?)%%\/DL%%$/);
    if (display && !/[\p{L}\p{N}]/u.test(display[2].replace(/%%IN\d+%%/g, ''))) continue; // "***" ornaments
    if (display) {
      // "BOOK TWO", "TREATISE ONE": the source opens a book here, and sets it larger than a chapter
      const level = /^(?:\*|_)*(?:the\s+)?(?:book|treatise|tractate)\s+(?:[ivxlc]+\b|the\s+\w+|\w+)\.?(?:\*|_)*\s*$/i.test(display[2].replace(/%%[^%]*%%/g, '').trim()) ? 0 : display[1];
      rendered.push(`#dline(${level})[${takeAnchor()}${display[2]}]`);
      continue;
    }
    para = para.replace(/%%\/?DL\d?%%/g, '');
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
    const visible = l => l.replace(/%%IN\d+%%/g, '').length;
    const isList = !reflow && lines.length >= 4 && lines.filter(l => visible(l) < 48).length / lines.length > 0.8;
    // A line-initial "/ ", "- ", "+ ", "= " or "1. " is Typst list/term/heading
    // syntax; none of it is meant here
    const safe = l => l.replace(/^(\/|[-+=]+|\d+\.)(?=\s)/, m => m.replace(/[\/\-+=.]/g, c => `\\${c}`));
    let body = isList ? lines.map(safe).join(' \\\n') : lines.map(safe).join('\n');
    body = takeAnchor() + pendingNotes + body;
    pendingNotes = '';
    rendered.push(isList && lines.length >= 12 ? `#listcols[\n${body}\n]` : body);
  }
  if (pendingNotes || pendingAnchor) rendered.push(takeAnchor() + pendingNotes);

  let body = rendered.join('\n\n');
  body = body.replace(/%%EM%%([\s\S]*?)%%\/EM%%/g, '#emph[$1];');
  body = body.replace(/%%\/?EM%%/g, '');
  // Placeholders last, innermost-safe: inserts never contain other placeholders
  // Twice: a note can sit inside a marginal note
  for (let pass = 0; pass < 3 && /%%IN\d+%%/.test(body); pass++) {
    body = body.replace(/%%IN(\d+)%%/g, (_, i) => inserts[Number(i)]);
  }
  // An inline source term reads as a word: exactly one space before it
  body = body.replace(/[ \t]*#(orig|gl)\[/g, ' #$1[');

  return { body: body.trim(), printedPage };
}

export const isShortGloss = text => String(text).trim().split(/\s+/).length <= 6 && String(text).length <= 45;

function escapeTypst(text) {
  // Escape characters special in Typst content mode
  // Coerce non-strings: fields like ustc_id are stored as numbers on some books
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/#/g, '\\#')
    .replace(/\$/g, '\\$')
    .replace(/@/g, '\\@')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/~/g, '\\~')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    // // and /* open Typst comments even in content mode: // silently eats
    // the rest of the line (and any closing ] of an enclosing #footnote)
    .replace(/\/\//g, '\\/\\/')
    .replace(/\/\*/g, '\\/\\*')
    // backtick opens a Typst raw block and swallows everything to the next one
    .replace(/`/g, '\\`');
}

function markdownToTypst(md) {
  if (!md) return '';
  let out = md;

  // ## Heading → = Heading (Typst level 2 since we use = for title)
  out = out.replace(/^### (.+)$/gm, '=== $1');
  out = out.replace(/^## (.+)$/gm, '== $1');

  // Markdown `*` bullets → `-` bullets BEFORE emphasis conversion,
  // so a bullet asterisk can't pair with an italic asterisk on the same line
  out = out.replace(/^(\s*)\*\s+/gm, '$1- ');

  // **bold** → *bold*
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // *italic* → _italic_ (but not inside bold)
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');

  // - bullet → - bullet (same in Typst)
  // Typst uses - for bullets already

  // Escape special chars except the markup we just added
  // This is tricky — skip lines that start with = (headings) or - (bullets) or * (bold)
  // For now, just escape # @ $ < > ~
  out = out.replace(/(?<!\\)#(?!footnote)/g, '\\#');
  out = out.replace(/\$/g, '\\$');
  out = out.replace(/@/g, '\\@');
  out = out.replace(/(?<!\\)<(?![a-z])/g, '\\<');
  out = out.replace(/(?<![a-z])>(?!])/g, '\\>');

  // Typst comment-openers in prose (e.g. https:// URLs) silently eat the
  // rest of the line — escape them
  out = out.replace(/\/\//g, '\\/\\/');
  out = out.replace(/\/\*/g, '\\/\\*');

  // Unclosed-delimiter guard: any line left with an odd number of * or _
  // (AI markdown variance) would make Typst fail to compile — escape them
  out = out.split('\n').map(line => {
    if (((line.match(/(?<!\\)\*/g) || []).length) % 2 === 1) line = line.replace(/(?<!\\)\*/g, '\\*');
    if (((line.match(/(?<!\\)_/g) || []).length) % 2 === 1) line = line.replace(/(?<!\\)_/g, '\\_');
    if (((line.match(/(?<!\\)`/g) || []).length) % 2 === 1) line = line.replace(/(?<!\\)`/g, '\\`');
    return line;
  }).join('\n');

  return out;
}

// ── Page filtering ──────────────────────────────────────────────────

const SKIP_PAGE_TYPES = new Set(['blank', 'digitizer-insert']);

// Leaves that belong to the COPY, not the work: flyleaves, a dealer's
// catalogue slip, shelfmarks, bookplates, the digitiser's colour chart. Fludd
// UCH I opened its translation with 'Vault (6-6) Book # 71 … Collated'. The
// words alone are not enough (real pages mention a flyleaf), so this applies
// only before the work's title page, and to very short pages at the back.
const COPY_MATTER = /\b(fly-?leaf|end-?paper|paste-?down|shelf-?mark|bookplate|ex-?libris|library stamp|catalog(ue)? (description|slip|entry|clipping)|collation (mark|note)|digiti[sz]ation (target|card)|colou?r (chart|checker|calibration)|scale bar|call number)\b/i;
const bodyText = page => String(page.translation?.data || '').replace(/<(note|gloss|image-desc|summary|keywords|meta|page-num|header|sig|vocab|lang|language|margin)\b[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export function dropCopyMatter(pages, titlePageNumber) {
  const lastN = pages.length ? pages[pages.length - 1].page_number : 0;
  return pages.filter(p => {
    const body = bodyText(p);
    const copyish = COPY_MATTER.test(p.translation?.data || '') || !body;
    if (titlePageNumber != null && p.page_number < titlePageNumber) return !(copyish && body.length < 600);
    if (p.page_number > lastN - 4) return !(copyish && body.length < 200);
    return true;
  });
}

function isContentPage(page) {
  if (!page.translation?.data) return false;
  if (page.page_type && SKIP_PAGE_TYPES.has(page.page_type)) return false;
  const text = page.translation.data;
  // Skip physical descriptions of covers, spines, blank pages
  const isPhysicalDescription = /\b(blank\s+(page|sheet)|book\s+spine|front\s+cover|back\s+cover|binding\s+(is|shows|has)|no\s+text\s+(is\s+)?visible|devoid\s+of\s+(any\s+)?text|leather\s+sections|marbled\s+pattern)\b/i.test(text);
  if (isPhysicalDescription && text.length < 800) return false;
  // Skip corrupted/hallucinated pages (repetitive text)
  // Check for repeated n-grams (catches "the page of the title of the page...")
  const words = text.split(/\s+/);
  if (words.length > 30) {
    // Check bigram repetition
    const bigrams = {};
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i+1]}`.toLowerCase();
      bigrams[bg] = (bigrams[bg] || 0) + 1;
    }
    const maxBigram = Math.max(...Object.values(bigrams));
    if (maxBigram > 10 && maxBigram / (words.length / 2) > 0.15) return false;
  }
  return true;
}

// ── Typst document generator ────────────────────────────────────────

// Page geometry, shared by the JS that writes the preamble and nothing else.
// A4 because a scholar prints it; a ~75-character text column because A4 at
// full width is unreadable; the space that frees up on the right is the
// margin column that carries source-page numbers and the original's marginalia.
// Latin-script text is Libertinus (embedded in typst); the Notos in ./fonts
// cover an Arabic or Hebrew title and quotation. Compiled with
// --ignore-system-fonts, so a laptop with 900 fonts and a bare server agree.
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fonts');
const FONT_STACK = '("Libertinus Serif", "Noto Naskh Arabic", "Noto Serif Hebrew")';

// Typst hyphenation languages for the source text; unknown → no hyphenation
const LANG_CODES = { latin: 'la', german: 'de', french: 'fr', italian: 'it', greek: 'el', dutch: 'nl', spanish: 'es', english: 'en', portuguese: 'pt' };

// Standing credits, printed on the imprint page of every edition
const STANDING_CREDITS = ['Editor and creative director: Derek Lomas'];
// Named in the citation itself, so a reference to the edition carries its editor
const EDITION_EDITOR = 'Derek Lomas';

const TYPST_PREAMBLE = `
#let rust = rgb("#9e4a3a")
#let muted = rgb("#6b6560")
#let hairline = rgb("#d4cfc4")

#let text-w = 125mm
#let margin-l = 25mm
#let gutter = 6mm
#let mcol = 40mm

// ── Margin column ──
// Everything in the margin goes through one state so items never overprint:
// each asks for the height of the line it belongs to and is pushed down to
// the running floor if an earlier item still occupies that space. The update
// is a function of the previous value, so a page of ten notes resolves in a
// single layout pass instead of one pass per note.
#let margin-floor = state("margin-floor", (page: 0, y: 0pt))
#let settle(floor, pg, want, h, limit) = {
  let y = if floor.page == pg and floor.y > want { floor.y } else { want }
  if y + h > limit { y = calc.max(want - h, limit - h) }
  y
}
#let in-margin(body, drop: 0pt) = box(width: 0pt, height: 0pt, context {
  let pos = here().position()
  let pg = here().page()
  let item = box(width: mcol, body)
  let h = measure(item).height
  let want = pos.y + drop.to-absolute()
  let limit = page.height - 24mm
  let y = settle(margin-floor.get(), pg, want, h, limit)
  margin-floor.update(f => (page: pg, y: settle(f, pg, want, h, limit) + h + 1.8mm))
  place(top + left, dx: margin-l + text-w + gutter - pos.x, dy: y - pos.y, item)
})

// A marginal note of the original, set where the original has it
#let mnote(body) = in-margin(drop: -0.72em, {
  set par(justify: false, leading: 0.5em, first-line-indent: 0pt)
  set text(size: 7.8pt, style: "italic", fill: muted, hyphenate: true)
  body
})

// Start of a source page: its number in the digitized copy (the citable
// anchor — it is the N in sourcelibrary.org/book/…/page/N) and, when the
// source prints one, its own page number
#let pagegap = block(above: 1.25em, below: 0pt, sticky: true)[]
// side "t" is the translation, "o" the source text in the back. The number
// links to that page's facsimile on the site; the small line under it jumps to
// the same page on the other side, when the edition has one.
#let current-src = state("current-src", none)
// A chapter that would run past 99 notes (sparse chapter lists: one Fludd book
// carries 470) restarts them at the source page that would cross 99 instead, so
// a marker stays two digits; every number on the page it lands on is still
// distinct (… 97 98 1 2). The generator decides where (reset: true): a reset
// computed here from the counter chains one layout pass per reset, and a
// 1,000-page book stopped converging (a tailpiece then dropped at random).
#let src(n, printed: none, side: "t", other: none, reset: false) = { if reset { counter(footnote).update(0) }; in-margin(drop: -0.7em, {
  set par(justify: false, leading: 0.4em, first-line-indent: 0pt)
  [#metadata(n)#label(side + "-" + n)]
  current-src.update(n)
  link(page-url + n, text(size: 8.5pt, fill: rust, weight: "semibold", number-type: "lining")[#n])
  if printed != none {
    text(size: 7pt, fill: muted)[#h(0.5em)orig. #printed]
  }
  if other != none {
    linebreak()
    link(label((if side == "t" { "o" } else { "t" }) + "-" + n), text(size: 7pt, fill: muted)[#other #sym.arrow.r])
  }
})}

// Headings of the source itself — display lines, never outline entries
#let dline(level, body) = block(above: if level <= 2 { 1.6em } else { 1.2em }, below: 0.9em, width: 100%, sticky: true, {
  set align(center)
  set par(justify: false, first-line-indent: 0pt, leading: 0.55em)
  // The source's chapter heads, letter-spaced as the printed book sets them
  // A book or treatise opening, set large like the original's LIBER SECUNDUS
  if level == 0 { v(2mm); text(size: 17pt, tracking: 0.2em, upper(body)); v(1mm) }
  else if level == 1 { text(size: 11.5pt, tracking: 0.16em, upper(body)) }
  else if level == 2 { text(size: 11.5pt, style: "italic", body) }
  else { text(size: 10.5pt, style: "italic", body) }
})

// The book's own printer's ornaments, where the book prints them: a headpiece
// opens a book on a fresh page, a tailpiece closes a section
#let headpiece(file) = {
  pagebreak(weak: true)
  align(center, block(above: 0pt, below: 5mm, image(file, width: text-w)))
}
// A tailpiece belongs to the end of its section: where the page has no room
// left for it, it is dropped rather than given a page of its own
#let tailpiece(file, width, id, height: none) = {
  // Measured from where the section's text ENDS (this marker), not from where
  // the ornament would land: once spilled to the next page it always "fits"
  [#metadata(none)#label(id)]
  context {
    let at = locate(label(id)).position()
    let notes = query(footnote).filter(f => f.location().page() == at.page).len()
    let room = page.height - 30mm - at.y - notes * 4.6mm - if notes > 0 { 6mm } else { 0mm }
    let orn = align(center, block(above: 1.6em, below: 1.6em, image(file, width: width)))
    // An ornament never opens a page: if the text ended at the foot of the
    // last one, the marker itself lands at the top of this one
    let opens-page = at.y < 30mm + 12mm
    // Height from the image's known proportions when the generator passes it
    let need = if height != none { (height + 3.2em + 8mm).to-absolute() } else { measure(block(width: text-w, orn)).height + 8mm }
    let fits = not opens-page and need <= room
    // Never an empty result: when this context rendered nothing, Fludd UCH I's
    // p. 23 tailpiece was dropped on a page with 80 mm free (its values read
    // 'fits' the moment anything else was rendered here). Measured, not
    // explained; keep the box.
    box(width: 0pt, height: 0pt)
    if fits { orn }
  }
}

// The source's own word for what the translation just said, after it in the line
#let orig(body) = text(size: 0.86em, fill: muted, style: "italic", hyphenate: false)[(#body)]
// A short gloss of the word before it: grey and upright, so it never reads as
// the source's own term (grey italic)
#let gl(body) = text(size: 0.86em, fill: muted, hyphenate: false)[(#body)]

// The book's own illustrations, cropped from the page images. The image keeps
// the hairline frame of a tipped-in plate; the caption names the source page,
// which links to the facsimile like the margin numbers do.
// A plate's caption carries its title AND the translation of every word on
// it; the list of illustrations shows the title alone
#let in-outline = state("in-outline", false)
#show outline: it => { in-outline.update(true); it; in-outline.update(false) }
#let plate-caption-w = state("plate-caption-w", 100mm)
// A full-page plate is centred on the PAGE, not the text column: the column
// sits left of centre to make room for the margin notes
#let plate-shift = state("plate-shift", 0mm)
#show figure.where(kind: "plate"): it => context move(dx: plate-shift.get(), block(above: 1.6em, below: 1.6em, width: 100%, breakable: false, {
  set align(center)
  it.body
  v(0.7em)
  block(width: plate-caption-w.get(), {
    set par(justify: false, first-line-indent: 0pt, leading: 0.5em, spacing: 0.55em)
    set text(size: 8.8pt, number-type: "lining", hyphenate: false)
    it.caption.body
  })
}))
#let plate(file, width, n, title: none, kind: [Illustration], labels: (), lines: (), key: (), full: false, follows: false, words: false) = {
  plate-caption-w.update(calc.max(width, 100mm))
  plate-shift.update(if full { 105mm - margin-l - text-w / 2 } else { 0mm })
  let head = [#text(fill: rust, tracking: 0.04em, smallcaps[Fig. #context counter(figure.where(kind: "plate")).display()])#h(0.6em)#if title != none [#emph(title)] else [#kind]]
  let src-link = text(fill: muted, size: 7.8pt)[source page #link(page-url + n)[#n]]
  // The words on the plate: under it, or — when they would push plate and
  // caption past the foot of a page (a float cannot break) — in the text
  // straight after it, where they may run on (words: true)
  let words-on = {
    // Labels: the English, with the word as engraved after it
    if labels.len() > 0 {
      align(center, labels.map(((o, e)) => box[#e#if o != none [ #text(fill: muted, style: "italic")[(#o)]]]).join([#h(0.5em)·#h(0.5em)]))
    }
    // Mottoes and sentences engraved on the plate, one to a line
    for (o, e) in lines {
      align(left, par(hanging-indent: 1em)[#e#if o != none [ #text(fill: muted, style: "italic", size: 0.92em)[(#o)]]])
    }
    // The page's own key to the letters on the plate
    if key.len() > 0 {
      align(left, par(hanging-indent: 1em, key.map(((m, e)) => [#text(fill: rust)[#m]#h(0.35em)#e]).join([#h(0.4em)·#h(0.4em)])))
    }
  }
  let details = {
    align(center)[#head#h(0.8em)#src-link]
    if not words { words-on }
    if follows { align(center, text(fill: muted, style: "italic")[Its text is translated on the following page.]) }
  }
  // A frontispiece or title page has a page to itself, as in the book
  if full { pagebreak(weak: true) }
  figure(
    kind: "plate",
    supplement: [Fig.],
    placement: if full { none } else { auto },
    caption: context if in-outline.get() { if title != none { title } else [#kind, source page #n] } else { details },
    box(stroke: 0.4pt + hairline, inset: 1.2mm, image(file, width: width)),
  )
  if words {
    block(above: 1em, below: 1.2em, breakable: true, {
      set par(justify: false, first-line-indent: 0pt, leading: 0.5em, spacing: 0.55em)
      set text(size: 8.8pt, number-type: "lining", hyphenate: false)
      align(center, text(fill: rust, tracking: 0.04em, smallcaps[Words on Fig. #context counter(figure.where(kind: "plate")).display()]))
      words-on
    })
  }
  if full { pagebreak(weak: true) }
}

// Lists the source sets in short lines (indexes, plant names): two columns
#let listcols(body) = block(width: 100%, above: 1em, below: 1em, {
  set par(justify: false, first-line-indent: 0pt, hanging-indent: 1em)
  set text(size: 9pt)
  columns(2, gutter: 8mm, body)
})

// ── Cover ──
// A binding in type: an ornamental border, the source page framed where a
// binder would stamp an emblem, and the Source Library mark set into the foot
// of the border. Ink on white, not gilt on navy — this PDF gets printed, and
// a full-bleed dark page costs toner and comes out of a laser printer muddy.
// The names keep the binding's vocabulary: navy is the ground, gold the ink.
#let navy = white
#let gold = rgb("#1a1612")
#let foil = gold
#let lozenge(size) = rotate(45deg, square(size: size, fill: gold))
// One 6mm repeat: a four-petalled flower with a lozenge at each corner, so
// neighbouring tiles join into a lattice. relative: "self" anchors the repeat
// to the band — anchored to the page it shows half-tiles.
#let border-tile = tiling(size: (6mm, 6mm), relative: "self", {
  let c = 3mm
  for (dx, dy) in ((0mm, -1.25mm), (0mm, 1.25mm), (-1.25mm, 0mm), (1.25mm, 0mm)) {
    place(top + left, dx: c + dx - 0.75mm, dy: c + dy - 0.75mm, lozenge(1.5mm))
  }
  place(top + left, dx: c - 0.35mm, dy: c - 0.35mm, circle(radius: 0.35mm, fill: navy))
  for (x, y) in ((0mm, 0mm), (6mm, 0mm), (0mm, 6mm), (6mm, 6mm)) {
    place(top + left, dx: x - 0.8mm, dy: y - 0.8mm, lozenge(1.6mm))
  }
})
#let sl-mark(size, ink) = box(width: size, height: size, {
  for (r, w) in ((0.5, 0.045), (0.36, 0.045), (0.2, 0.05)) {
    place(center + horizon, circle(radius: size * r - size * w / 2, stroke: size * w + ink))
  }
})
#let diamond-rule(ink) = box(width: 46mm, grid(
  columns: (1fr, auto, 1fr), column-gutter: 2.2mm, align: horizon,
  line(length: 100%, stroke: 0.5pt + ink), rotate(45deg, square(size: 1.5mm, fill: ink)), line(length: 100%, stroke: 0.5pt + ink),
))

#let running-title = state("running-title", "")
#let running-chapter = state("running-chapter", "")
#let in-body = state("in-body", false)
`;

function shorten(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 15)).replace(/[\s,;:.—–-]+$/, '')}…`;
}

const typstString = s => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Catalogue apparatus that routinely rides along in `title` / `display_title`:
 * series names, volume numbers, holdings notes, "with <other authors>". These
 * are shelf information, not part of what the book is called, and they read as
 * part of the title once set in display type on a cover.
 *
 * Deliberately a list of known junk rather than "strip any trailing
 * parenthetical": plenty of parentheticals are real alternative titles
 * (Kircher's "Iter extaticum II (Mundus subterraneus prodromus)") and a
 * blanket strip would discard them.
 */
const CATALOGUE_PARENTHETICAL = new RegExp(
  '^(?:'
  + 'vols?\\.?\\s*\\d+|[ivxlc]+|\\d{1,4}'
  + '|(?:loeb|aldine|elzevir|teubner|sbe|etcsl|cdli|budé|budae|oct|ocT)\\b.*'
  + '|(?:with|incl\\.?|including|tr\\.?|trans\\.?|comm\\.?|ed\\.?|attrib\\.?)\\s+.*'
  + '|(?:ms|mss|manuscript|facsimile|reprint|fragment)\\b.*'
  + '|.*\\b(?:manuscript|codex|papyrus|fragment|dynasty|reign|edition|series)\\b.*'
  + ')$',
  'i',
);

/**
 * A title as it should appear in display type: catalogue apparatus removed,
 * and existing hyphens made non-breaking so a name like `Ghāyat al-Ḥakīm`
 * cannot be split across two lines of a cover.
 */
/**
 * The running head's title: the work's own name, before a volume or part
 * designation ("Utriusque Cosmi Historia - Tomus Primus (De Macrocosmi)" →
 * "Utriusque Cosmi Historia"), so it is never cut off mid-word with an ellipsis.
 */
export function runningTitle(title) {
  const t = String(title || '').trim();
  const head = t.split(/\s+[-–—:]\s+|\s*\(/)[0].trim();
  return shorten(head.length >= 8 ? head : t, 52);
}

export function displayTitle(title, { author = '' } = {}) {
  let t = String(title ?? '').trim();
  // A trailing imprint tail — ", Augsburg 1518", ", London, 1653"
  t = t.replace(/,\s*[^,()]{2,40}?,?\s*\d{4}\s*$/, '').trim();
  // Trailing parentheticals, innermost last: "(Alain de Lille)", "(vol 2)"
  for (let i = 0; i < 3; i++) {
    const m = t.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!m) break;
    const inner = m[2].trim();
    const isAuthor = author && inner.toLocaleLowerCase() === String(author).trim().toLocaleLowerCase();
    if (!isAuthor && !CATALOGUE_PARENTHETICAL.test(inner)) break;
    t = m[1].trim();
  }
  // U+2011 NON-BREAKING HYPHEN: `hyphenate: false` stops Typst inventing new
  // break points but not breaking at a hyphen that is already in the string.
  return (t || String(title ?? '').trim()).replace(/(\S)-(\S)/g, '$1‑$2');
}

/**
 * The line under the title block. `language` is the EDITION's language, so a
 * 1903 English edition of a Hebrew manuscript is `language: "English"` and the
 * naive template produces "An English translation from the English".
 */
export function translationLine(language) {
  const lang = String(language ?? '').trim();
  if (!lang || /^(source language|unknown|und)$/i.test(lang)) return 'An English translation';
  if (/^en(g(lish)?)?$/i.test(lang)) return 'A modernized English edition';
  return `An English translation from the ${lang}`;
}

export function generateTypstSource(book, pages, options = {}) {
  // frontispieceFile is a filename beside the .typ (generateScholarlyPdf puts
  // it there); absent, the cover falls back to the Source Library mark
  // illustrations: [{ page_number, file, type, width, height }] beside the .typ
  // (see fetchIllustrations); each is set as a figure at its source page
  const { introduction, methodology, doi, version, frontispieceFile, credits = [], includeOriginal = true, dedication = resolveDedication(book), illustrations = [], ornaments = [] } = options;
  const bookTitle = book.display_title || book.title;
  const bookSlug = book.slug || book.id;
  const bookUrl = `https://sourcelibrary.org/book/${bookSlug}`;
  const now = new Date().toISOString().split('T')[0];
  const year = now.slice(0, 4);
  // The first title page: a page typed so, or the first full-page plate
  const titleAt = [pages.find(p => p.page_type === 'title-page')?.page_number, ...illustrations.filter(il => il.full).map(il => il.page_number)].filter(n => n != null).sort((a, b) => a - b)[0];
  const translatedPages = dropCopyMatter(pages.filter(isContentPage), titleAt);
  const author = String(book.author || 'Anonymous').replace(/\s*\|\s*/g, ', ');
  const language = book.language || 'source language';

  // "Title: Subtitle" reads better on a title page as two lines of different weight
  const coverDisplay = displayTitle(bookTitle, { author });
  // A catalogue title often joins work and volume with a spaced dash
  // ("Utriusque Cosmi Historia - Tomus Primus"): that is a subtitle too
  const sep = coverDisplay.match(/: | [-–—] /);
  const mainTitle = sep ? coverDisplay.slice(0, sep.index) : coverDisplay;
  const subTitle = sep ? coverDisplay.slice(sep.index + sep[0].length) : '';
  // The original-language line above the title, when it says something the
  // English title does not
  const coverOriginal = displayTitle(book.title, { author });

  const place = book.place_published || book.publication_place;
  const imprintLine = [[place, book.publisher && String(book.publisher).replace(/\s*\|\s*/g, ' and ')].filter(Boolean).join(': '), book.published].filter(Boolean).join(', ');
  const holder = book.image_source?.contributing_library || book.contributing_library;
  const provider = book.image_source?.provider_name;
  const { url: sourceUrl, label: sourceLabel } = resolveSourceImages(book);
  // Say so only when the holding institution stated it — an importer default is not a rights statement
  const rights = book.image_source?.rights_normalized;
  const publicDomain = rights?.class === 'public-domain' && rights?.status === 'stated';
  const persistentUrl = doi ? `https://doi.org/${doi}` : bookUrl;
  const footerId = doi ? `doi:${doi}` : `sourcelibrary.org/book/${bookSlug}`;

  const doc = [];

  // ── Document setup ──
  doc.push(`
#set document(
  title: ${typstString(`English Translation of ${bookTitle}`)},
  author: ${typstString(author)},
)
#let page-url = ${typstString(`${bookUrl}/page-number/`)}
${TYPST_PREAMBLE}
#running-title.update(${typstString(runningTitle(mainTitle))})

#set page(
  paper: "a4",
  margin: (top: 30mm, bottom: 30mm, left: margin-l, right: 210mm - margin-l - text-w),
  numbering: "i",  // front matter in roman; the translation restarts at arabic 1
  header-ascent: 9mm,
  header: context {
    let pg = here().page()
    let opens = query(heading.where(level: 1)).filter(h => h.location().page() == pg)
    if opens.len() == 0 {
      set text(size: 8pt, fill: muted, number-type: "lining")
      // The state holds what was current at the top of the page; a chapter that
      // opens on this page (a book opening under its headpiece) names the page
      let starts = query(<chapter-start>).filter(m => m.location().page() == pg)
      let chapter = if starts.len() > 0 { starts.first().value } else { running-chapter.get() }
      box(width: text-w + gutter + mcol, grid(
        columns: (text-w, gutter, mcol),
        [#text(tracking: 0.12em, smallcaps(running-title.get()))#h(1fr)#emph(chapter)], [],
        align(left, counter(page).display(page.numbering)),
      ))
    }
  },
  footer-descent: 12mm,
  // The foot of each page cites the source page current there, as a link —
  // the last page anchor set before this point, on either side of the book
  footer: context {
    set text(size: 7pt, fill: muted, tracking: 0.03em)
    // A state, not a query over every anchor before here(): the query made a
    // 940-page book take five minutes to compile instead of thirty seconds
    let n = current-src.get()
    if n != none {
      // The link carries the full address; the line shows only what a reader needs
      align(center)[#box(baseline: 0.6mm, sl-mark(2.8mm, muted))#h(0.4em)Source Library #h(0.6em)·#h(0.6em) #link(page-url + n)[facsimile of source page #n #sym.arrow.tr]]
    } else {
      align(center)[Source Library #h(0.6em)·#h(0.6em) ${escapeTypst(footerId)}]
    }
  },
)

#set text(
  font: ${FONT_STACK},
  size: 10.5pt,
  lang: "en",
  hyphenate: true,
  number-type: "old-style",
)

#set par(
  justify: true,
  leading: 0.62em,
  spacing: 0.62em,
  first-line-indent: 1.3em,
)

#set heading(numbering: none)

// Footnotes restart at 1 in each chapter. They must NOT be reset from the
// page header: a header is laid out after the body it sits above, so the
// reset lands unpredictably and the notes at the foot of a page print out of
// order (measured 18% of multi-note pages in one book, 5% in another).
// A heading is in the body flow, so the reset is deterministic — and
// per-chapter numbering is the scholarly convention anyway.
// Footnotes restart at 1 in each chapter, NOT on each page.
//
// Per-page numbering was tried in both the header and the footer and is
// structurally unreliable here: display lines are sticky, so Typst
// relocates them across a page break AFTER their markers have been numbered,
// and the moved note then prints out of sequence at the foot of its new page.
// Measured on the page-reset build: 18% of multi-note pages in one book, 5%
// in another, printing notes in the order 3 4 5 6 7 1 2 — a reader cannot
// match a marker to its note.
//
// A heading is in the body flow, so the reset is deterministic, and
// per-chapter numbering is the scholarly convention. The cost is marker
// width: a book whose chapter extraction is sparse (Iamblichus has few
// headings for 550 pages) reaches three digits. That is ugly but correct,
// and correctness of reference wins.
#let restart-notes = counter(footnote).update(0)

#show heading.where(level: 1): it => {
  // The translation's own opener is a composed part page; its heading exists
  // for the contents and bookmarks only
  if it.has("label") and it.label == <part> { return place(hide(box(width: 0pt, height: 0pt))) }
  restart-notes
  pagebreak(weak: true)
  v(16mm)
  block(below: 0pt, text(size: 21pt, weight: "regular", it.body))
  v(4mm)
  line(length: 18mm, stroke: 0.7pt + rust)
  v(9mm)
}

// Inside the translation, levels 2–3 are the book's chapter list: they feed
// the contents, the PDF bookmarks and the running head, but print nothing —
// the source's own heading is already there in the text.
#show heading.where(level: 2): it => context {
  restart-notes
  if in-body.get() { place(hide(box(width: 0pt, height: 0pt))) } else {
    block(above: 1.7em, below: 0.8em, sticky: true, text(size: 12.5pt, weight: "regular", style: "italic", it.body))
  }
}
#show heading.where(level: 3): it => context {
  restart-notes
  if in-body.get() { place(hide(box(width: 0pt, height: 0pt))) } else {
    block(above: 1.3em, below: 0.6em, sticky: true, text(size: 10.5pt, weight: "regular", tracking: 0.04em, smallcaps(it.body)))
  }
}

#set footnote.entry(separator: line(length: 18mm, stroke: 0.4pt + hairline), gap: 0.45em, clearance: 1.2em)
#show footnote.entry: set text(size: 7.9pt)
#show footnote.entry: set par(leading: 0.45em)
// A URL must never be hyphenated: Typst breaks at the hyphens already in a
// slug, so ...commentarii-insignes-fuchs-2 acquired a line break mid-slug and
// the printed reference read as two broken URLs.
#show link: set text(fill: rust, hyphenate: false)

#show outline.entry.where(level: 1): it => {
  v(0.7em, weak: true)
  text(tracking: 0.05em, smallcaps(it))
}
`);

  // ── Cover / title page ──
  const coverTitle = mainTitle.length > 60 ? shorten(mainTitle, 60) : mainTitle;
  const coverTitleSize = coverTitle.length > 42 ? 22 : coverTitle.length > 24 ? 27 : 32;
  const coverPlaceDate = [place, book.published].filter(Boolean).join('  ·  ');
  doc.push(`
#page(fill: navy, margin: 0pt, header: none, footer: none)[
  #place(top + left, dx: 12mm, dy: 10.5mm, rect(width: 186mm, height: 276mm, fill: border-tile, stroke: 0.6pt + gold))
  #place(top + left, dx: 18mm, dy: 16.5mm, rect(width: 174mm, height: 264mm, fill: navy, stroke: 0.6pt + gold))
  #place(bottom + center, dy: -5mm, circle(radius: 9.5mm, fill: navy))
  #place(bottom + center, dy: -7.5mm, sl-mark(14mm, gold))
  #set par(first-line-indent: 0pt, justify: false, leading: 0.42em)
  #set text(fill: gold, hyphenate: false)
  #align(center, block(width: 140mm, {
    v(${frontispieceFile ? 24 : 58}mm)
    ${frontispieceFile
      ? `box(stroke: 0.9pt + gold, inset: 1.6mm, box(stroke: 0.4pt + gold, image(${typstString(frontispieceFile)}, height: 122mm, fit: "contain")))`
      : 'sl-mark(40mm, gold)'}
    v(${frontispieceFile ? 10 : 15}mm)
    ${coverOriginal && coverOriginal !== coverDisplay ? `text(size: 16pt, style: "italic")[${escapeTypst(shorten(coverOriginal, 90))}]
    v(7mm)` : ''}
    text(size: ${coverTitleSize}pt, weight: "bold", tracking: 0.1em, fill: foil, upper[${escapeTypst(coverTitle)}])
    ${subTitle ? `v(3.5mm)
    text(size: 11pt, tracking: 0.08em, smallcaps[${escapeTypst(shorten(subTitle, 80))}])` : ''}
    v(8mm)
    diamond-rule(gold)
    v(7mm)
    text(size: 13pt, weight: "bold", tracking: 0.14em, upper[${escapeTypst(author)}])
    ${coverPlaceDate ? `v(3mm)
    text(size: 9.5pt, tracking: 0.22em, number-type: "lining", upper[${escapeTypst(coverPlaceDate)}])` : ''}
    v(15mm)
    text(size: 10pt)[${escapeTypst(translationLine(language))}]
    v(1.5mm)
    text(size: 9pt, style: "italic", fill: muted)[AI-assisted and not reviewed by human editors]
    v(1.5mm)
    text(size: 9pt, fill: muted, number-type: "lining")[Source Library #h(0.4em)·#h(0.4em) Embassy of the Free Mind, Amsterdam #h(0.4em)·#h(0.4em) ${year}]
  }))
]
`);

  // ── Dedication ──
  // These books open with a dedication to the patron who made them possible;
  // this edition keeps the custom and the form (see dedicationToTypst).
  if (dedication) doc.push(dedicationToTypst(dedication));

  // ── Imprint page ──
  const creditLines = [...STANDING_CREDITS, ...credits].map(c => escapeTypst(c)).join(' \\\n  ');
  // The persistent link goes on a line of its own, unbroken: a DOI split
  // across lines ("https:// / doi.org/…") is the one thing a reader copies
  const citation = `${author}. ${bookTitle}. English translation by Source Library (AI-assisted), edited by ${EDITION_EDITOR}. Amsterdam: Embassy of the Free Mind, ${year}.${version ? ` Version ${version}.` : ''}`;
  doc.push(`
#page(header: none, footer: none)[
  #set par(first-line-indent: 0pt, justify: false, leading: 0.55em, spacing: 1.1em)
  #set text(size: 8.8pt, number-type: "lining")
  #v(1fr)
  _${escapeTypst(bookTitle)}_ \\
  An English translation of ${escapeTypst(author)}, _${escapeTypst(book.title)}_${imprintLine ? ` (${escapeTypst(imprintLine)})` : ''}.

  ${holder || provider ? `Translated from the copy ${holder ? `held by ${escapeTypst(holder)}` : ''}${provider && provider !== holder ? `${holder ? ', ' : ''}digitized by ${escapeTypst(provider)}` : ''}${sourceUrl ? `: #link(${typstString(sourceUrl)})[${escapeTypst(urlDisplay(sourceUrl))}]` : ''}.` : ''}

  ${version ? `Version ${escapeTypst(version)}, ` : ''}${now}.${doi ? ` \\
  DOI #box(link(${typstString(persistentUrl)})[${escapeTypst(doi)}]) \\
 ` : ''} Each version of this edition is deposited separately and does not change; corrections appear as new versions. The current text, with page facsimiles, is at #link(${typstString(bookUrl)})[${escapeTypst(urlDisplay(`sourcelibrary.org/book/${bookSlug}`))}].

  #text(fill: rust, tracking: 0.08em, size: 7.8pt)[#upper[Cite as]] \\
  ${escapeTypst(citation)} \\
  #box(link(${typstString(persistentUrl)})[${escapeTypst(persistentUrl)}])

  To cite a passage, give the page number printed in the margin, e.g. "p. ${translatedPages[Math.min(10, translatedPages.length - 1)]?.page_number ?? 1}".

  Published by Source Library, a project of the Embassy of the Free Mind, Amsterdam, under a Creative Commons Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0).${publicDomain ? ' The source images are in the public domain.' : ''}

  ${creditLines}

  #text(fill: muted)[${frontispieceFile && (book.cover_page_number || book.cover_page) ? `Cover: page ${escapeTypst(book.cover_page_number || book.cover_page)} of the digitized copy${holder ? `, ${escapeTypst(holder)}` : ''}. ` : ''}Set in Libertinus Serif with Typst.]
]
`);

  // ── Contents ──
  const chapters = (book.chapters || []).filter(ch => ch?.pageNumber && (ch.titleEn || ch.title));
  const topLevel = chapters.filter(ch => (ch.level || 1) <= 1).length;
  // A long chapter list at full depth runs to pages of contents nobody reads
  const outlineDepth = chapters.length <= 70 ? 3 : topLevel >= 4 ? 2 : 3;
  doc.push(`
#heading(level: 1, outlined: false)[Contents]

#{
  set par(first-line-indent: 0pt, justify: false)
  set text(number-type: "lining")
  outline(title: none, depth: ${outlineDepth}, indent: 1.2em)
}
`);
  // Only figures whose page made it into the body: the list must not point
  // at a plate a --pages render left out
  const bodyPageNumbers = new Set(translatedPages.map(p => p.page_number));
  const plates = illustrations.filter(il => bodyPageNumbers.has(il.page_number));
  if (plates.length) {
    doc.push(`
#heading(level: 1, outlined: false)[Illustrations]

#{
  set par(first-line-indent: 0pt, justify: false)
  set text(number-type: "lining")
  outline(title: none, target: figure.where(kind: "plate"))
}
`);
  }

  // ── About this edition ──
  doc.push(`
= About This Edition

#block(
  width: 100%,
  inset: (left: 1em, y: 0.2em),
  stroke: (left: 1.5pt + rust),
)[
  #set par(first-line-indent: 0pt)
  *This PDF is a citable scholarly record.* It is deposited with Zenodo and assigned a DOI so that scholars can reference specific passages in academic publications. For the full reading experience --- with original page facsimiles displayed alongside the translation, searchable text, and interactive navigation --- visit #link("${bookUrl}")[sourcelibrary.org].
]

#v(0.8em)

This translation was produced using artificial intelligence by Source Library, a project of the Embassy of the Free Mind in Amsterdam. The original ${escapeTypst(language)} text was transcribed from digitized page images using optical character recognition, then translated into English page by page using large language models.

This AI-assisted translation has *not* been reviewed by human editors or translators. It captures the meaning and structure of the original text but may not reflect every nuance a specialist human translator would convey. Readers are encouraged to consult the original language text, available alongside this translation at Source Library.

== How to read the page

The translation follows the source page by page. A number in the margin marks where each page of the digitized copy begins; it is the number to cite, and it is a link: it opens that page's facsimile at sourcelibrary.org/book/${escapeTypst(bookSlug)}/page-number/_n_, where the translation can be checked against the original. Where the source prints a page number of its own, it follows in grey.

${includeOriginal ? `The ${escapeTypst(language)} text the translation was made from is printed at the back; under each margin number a small link leads to the same page on the other side. ` : ''}Notes printed in the margins of the original are set in the margin here. Footnotes are not the author's: they are explanatory notes supplied in the course of translation, and carry the same caution as the translation itself. A word in grey italics, in parentheses, is the source's own term for what the translation has just said; one in grey upright type glosses the word before it. Words in square brackets are supplied by the translation; [?] marks a reading the transcription was unsure of.

This work is licensed under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
`);

  // ── Introduction ──
  if (introduction) {
    doc.push(`\n= Introduction\n\n${markdownToTypst(introduction)}\n`);
  }

  // ── Methodology ──
  if (methodology) {
    doc.push(`\n= Methodology\n\n${markdownToTypst(methodology)}\n`);
  }

  // ── Translation ──
  doc.push(`
#set page(numbering: "1")
#counter(page).update(1)
#in-body.update(true)
#heading(level: 1)[Translation] <part>
#[
  #set par(first-line-indent: 0pt, justify: false, leading: 0.5em)
  #v(52mm)
  #text(size: 8.5pt, tracking: 0.24em, fill: rust)[#upper[The Translation]]
  #v(7mm)
  #text(size: 21pt)[${escapeTypst(mainTitle)}]
  ${subTitle ? `#v(2mm)\n  #text(size: 13pt, style: "italic")[${escapeTypst(subTitle)}]` : ''}
  #v(6mm)
  #text(size: 10.5pt)[${escapeTypst(author)}]
]
#pagebreak()
`);

  // Render both sides first: a cross-link may only point at a page that
  // made it onto the other side (Typst refuses a dangling label, which makes
  // a clean compile the proof that every link lands)
  const asText = field => p => ({ page_number: p.page_number, translation: { data: p[field]?.data || '' } });
  const render = (list, side) => {
    const runningHeads = findRunningHeads(list);
    const out = new Map();
    for (const p of list) {
      const { body } = translationToTypst(p.translation.data, {
        runningHeads,
        reflow: side === 'o',
        anchor: printedPage => `%%SRC:${side}:${p.page_number}:${printedPage ? typstString(printedPage) : 'none'}%%`,
      });
      if (body) out.set(p.page_number, body);
    }
    return out;
  };
  const english = render(translatedPages, 't');
  const original = includeOriginal ? render(translatedPages.filter(p => p.ocr?.data).map(asText('ocr')), 'o') : new Map();
  // A sentence that runs across a page break was translated in two halves
  // (each page is translated on its own); the halves stay as the model
  // wrote them, but the paragraph break between them is ours, so it goes:
  // when a page ends mid-sentence and the next begins mid-sentence, the two
  // are set as one paragraph. The translation marks its halves with an
  // ellipsis; the transcription simply stops without a full stop.
  const textOf = body => stripLeadingApparatus(
    body.replace(/^(?:%%SRC:[^%]*%%|\s)+/, '').replace(/#(?:footnote|mnote|orig|gl)\[[^\]]*\](?:#footnote\[[^\]]*\])?;?/g, ''),
  );
  const endsMidSentence = body => {
    // An unclear-reading marker at the very end ("[?money]") is a word, not punctuation
    const t = textOf(body).replace(/\\$/, '').trimEnd().replace(/\\\[\?[^\]]*\\\]$/, 'x');
    if (/[.!?:"”)\]]$/.test(t.replace(/(?:\.\.\.|…)$/, '').trimEnd())) return false;
    return /(?:\.\.\.|…|[\p{L}\p{N},;—–-])$/u.test(t);
  };
  const startsMidSentence = body => {
    const t = textOf(body).replace(/^(?:\.\.\.|…)\s*/, '');
    return !t.startsWith('#') && /^\p{Ll}/u.test(t);
  };
  const continues = (prev, next) => Boolean(prev && next && endsMidSentence(prev) && startsMidSentence(next));
  // The continuation's leading ellipsis is dropped; the first half keeps its own
  const joinedForm = body => body.replace(/^((?:%%SRC:[^%]*%%)?\s*)(?:\.\.\.|…)\s*/, '$1');

  const anchored = (body, there, label) => body.replace(/%%SRC:([to]):(\d+):(none|"[^"]*")%%/, (_, side, n, printed) =>
    `#src("${n}", printed: ${printed}, side: "${side}"${there.has(Number(n)) ? `, other: ${typstString(label)}` : ''}${resetNotes(body) ? ', reset: true' : ''});`);
  // Notes since the last restart, mirrored from the Typst side: a chapter
  // heading restarts them, and so does a source page that would cross 99
  let noteCount = 0;
  const resetNotes = body => {
    const n = (body.match(/#footnote\[/g) || []).length;
    const reset = noteCount + n > 99;
    noteCount = reset ? n : noteCount + n;
    return reset;
  };
  const placeHeads = list => { if (list.some(h => /^#heading\(level: [23]\)/.test(h))) noteCount = 0; return list; };

  // A plate floats to the top or bottom of a nearby page; it is emitted
  // between paragraphs, never inside one, so a page whose text continues the
  // previous sentence hands its plates on to the next paragraph start.
  const platesByPage = new Map();
  for (const il of plates) platesByPage.set(il.page_number, [...(platesByPage.get(il.page_number) || []), il]);
  let pendingPlates = [];
  const ornamentsByPage = new Map();
  for (const o of ornaments) if (bodyPageNumbers.has(o.page_number)) ornamentsByPage.set(o.page_number, [...(ornamentsByPage.get(o.page_number) || []), o]);
  const flushPlates = () => { const out = pendingPlates.map(plateTypst); pendingPlates = []; return out; };

  let chapterIdx = 0;
  let prevBody = null;
  let prevIdx = -1;
  let pendingHeads = [];
  for (const page of translatedPages) {
    // Every chapter that starts at or before this page and has not been
    // emitted yet — a chapter whose own page was skipped as blank still
    // gets its contents entry, on the next page that has text. The
    // headings print nothing in the body (they feed contents, bookmarks and
    // the running head), so when the page continues a sentence they go
    // after it rather than splitting it.
    const heads = [];
    while (chapterIdx < chapters.length && chapters[chapterIdx].pageNumber <= page.page_number) {
      const ch = chapters[chapterIdx++];
      const title = ch.titleEn || ch.title;
      heads.push(`#heading(level: ${(ch.level || 1) <= 1 ? 2 : 3})[${escapeTypst(title)}]`);
      heads.push(`#running-chapter.update(${typstString(shorten(title, 46))})#metadata(${typstString(shorten(title, 46))})<chapter-start>`);
    }
    // A full-page plate whose page is translated in the body (a title page)
    // does not repeat that text in its caption
    const pagePlates = (platesByPage.get(page.page_number) || []).map(il => ({ ...il, textFollows: il.full && english.has(page.page_number) }));
    pendingPlates.push(...pagePlates);
    if (!english.has(page.page_number)) { pendingHeads.push(...heads); continue; }
    let body = english.get(page.page_number);
    body = dropDescriptiveNotes(body, { figures: (platesByPage.get(page.page_number) || []).length > 0 });
    body = attachOrphanNotes(body);
    if (pagePlates.length) {
      const taken = takeInscriptions(body);
      // A page that was ALL inscription keeps its anchor and loses only the notes
      if (taken.inscriptions.length && taken.body.trim()) { body = taken.body; pagePlates[0].inscriptions = taken.inscriptions; }
    }
    const orn = ornamentsByPage.get(page.page_number) || [];
    const head = orn.filter(o => o.kind === 'headpiece').slice(0, 1).map(o => `#headpiece(${typstString(o.file)})`);
    const tail = orn.filter(o => o.kind === 'tailpiece').map((o, k) => `#tailpiece(${typstString(o.file)}, ${Math.min(42, Math.max(24, 30 * Math.sqrt(o.width / o.height))).toFixed(0)}mm, "tp-${page.page_number}-${k}", height: ${(Math.min(42, Math.max(24, 30 * Math.sqrt(o.width / o.height))) * o.height / o.width).toFixed(1)}mm)`);
    // A headpiece opens a new paragraph by nature; on a continued sentence it waits
    if (continues(prevBody, body)) {
      doc[prevIdx] = closeSplitWord(doc[prevIdx], textOf(prevBody), textOf(body));
      prevIdx = doc.push(anchored(joinedForm(body), original, language)) - 1; pendingHeads.push(...heads);
    }
    else if (head.length) {
      // A book opening reads headpiece, book title, contents — and then its
      // plate (the contents table): the plates follow the opening text
      doc.push(''); doc.push(...head); doc.push(...placeHeads([...pendingHeads, ...heads])); pendingHeads = []; doc.push(''); doc.push('#pagegap'); prevIdx = doc.push(anchored(body, original, language)) - 1; doc.push(''); doc.push(...flushPlates());
    }
    else { doc.push(''); doc.push(...placeHeads([...pendingHeads, ...heads])); pendingHeads = []; doc.push(''); doc.push(...flushPlates()); doc.push('#pagegap'); prevIdx = doc.push(anchored(body, original, language)) - 1; }
    if (tail.length) { doc.push(''); doc.push(...tail); }
    prevBody = body;
  }
  doc.push('');
  doc.push(...pendingHeads);
  doc.push(...flushPlates());

  doc.push(`#in-body.update(false)\n#running-chapter.update("")`);

  // ── The source text ──
  // What the translation was made from, so a reader can check a rendering
  // without leaving the PDF. It is the OCR transcription, unreviewed, and says so.
  if (original.size) {
    const code = LANG_CODES[String(language).toLowerCase()];
    noteCount = 0; // its part heading restarts the notes
    doc.push(`
= The ${escapeTypst(language)} Text

#[
#set par(first-line-indent: 0pt)
This is the transcription the translation was made from, produced by optical character recognition from the page images and not corrected by hand. It keeps the spelling and abbreviations of the source. Each page number opens the facsimile; "English" returns to the same page of the translation.
]

#running-chapter.update(${typstString(`${language} text`)})
#[
#set text(size: 9.5pt, ${code ? `lang: "${code}"` : 'hyphenate: false'})
`);
    let prevOrig = null;
    for (const [n, body] of original) {
      if (continues(prevOrig, body)) doc.push(anchored(body, english, 'English'));
      else { doc.push(''); doc.push('#pagegap'); doc.push(anchored(body, english, 'English')); }
      prevOrig = body;
    }
    doc.push(']\n#running-chapter.update("")');
  }

  // ── Index ──
  const index = book.index;
  if (index && (index.people?.length || index.places?.length || index.concepts?.length || index.vocabulary?.length)) {
    doc.push('\n= Index\n');
    doc.push('#[\n#set par(first-line-indent: 0pt, justify: false, hanging-indent: 1em)\n#set text(size: 9pt, number-type: "lining")\nNumbers refer to the source pages marked in the margin.\n');

    const renderSection = (title, entries) => {
      const prepared = indexEntries(entries, pages.length);
      if (!prepared.length) return;
      doc.push(`== ${title}\n`);
      doc.push('#columns(2, gutter: 8mm)[');
      for (const entry of prepared) {
        const shown = entry.pages.slice(0, INDEX_MAX_LOCATORS);
        const more = entry.pages.length > shown.length ? ' …' : '';
        const refs = shown.length ? `, ${shown.join(', ')}${more}` : '';
        doc.push(`${escapeTypst(entry.term)}${refs} \\`);
      }
      doc.push(']\n');
    };

    renderSection('People', index.people);
    renderSection('Places', index.places);
    renderSection('Concepts', index.concepts);
    // Vocabulary entries carry `pages` and never `definition` (measured: all
    // 6,438,284 of them corpus-wide). They were being rendered as a bare
    // italic word list by a glossary branch that printed `definition` and
    // dropped the locators — so 99.4% of deposits shipped an index with no
    // page numbers under a line promising page numbers.
    renderSection('Terms', index.vocabulary);
    doc.push(']');
  }

  // ── Colophon ──
  doc.push(`
= Colophon

#set par(first-line-indent: 0pt)
#set text(number-type: "lining")

This digital edition of _${escapeTypst(bookTitle)}_ was produced by Source Library, a project of the Embassy of the Free Mind in Amsterdam.

#v(0.5em)
#table(
  columns: (auto, 1fr),
  stroke: none,
  inset: (x: 0pt, y: 0.25em),
  column-gutter: 1.2em,
  [#text(fill: muted)[Author]], [${escapeTypst(author)}],
  [#text(fill: muted)[Language]], [${escapeTypst(book.language || 'Unknown')}],
  ${book.published ? `[#text(fill: muted)[Published]], [${escapeTypst(book.published)}],` : ''}
  ${place ? `[#text(fill: muted)[Place]], [${escapeTypst(place)}],` : ''}
  ${book.publisher ? `[#text(fill: muted)[Publisher]], [${escapeTypst(book.publisher)}],` : ''}
  ${book.ustc_id ? `[#text(fill: muted)[USTC]], [${escapeTypst(book.ustc_id)}],` : ''}
  ${holder ? `[#text(fill: muted)[Source copy]], [${escapeTypst(holder)}],` : ''}
  [#text(fill: muted)[Pages translated]], [${translatedPages.length}${pages.length > translatedPages.length ? ` of ${pages.length}` : ''}],
  ${version ? `[#text(fill: muted)[Version]], [${escapeTypst(version)}],` : ''}
  ${doi ? `[#text(fill: muted)[DOI]], [#link(${typstString(persistentUrl)})[${escapeTypst(doi)}]],` : ''}
  [#text(fill: muted)[Generated]], [${now}],
  [#text(fill: muted)[License]], [CC BY-SA 4.0],
)

#v(1em)
// Not justified: these are label + URL lines, and justification stretched the
// two words of "Source   Library:" across the measure to pad a short line.
#block(width: 100%)[
#set par(justify: false)
Source Library: #link("${bookUrl}")[${escapeTypst(urlDisplay(`sourcelibrary.org/book/${bookSlug}`))}]
${sourceUrl ? `\\\n${escapeTypst(sourceLabel)}: #link(${typstString(sourceUrl)})[${escapeTypst(urlDisplay(sourceUrl))}]` : ''}
]
`);

  return doc.join('\n');
}

/** A IIIF manifest or other raw JSON: a machine endpoint, not a page to read. */
const IIIF_MANIFEST = /manifest|\.json(?:\?|$)|\/iiif\//i;

/**
 * Where the colophon sends a reader for the page images, and what to call it.
 *
 * 2,648 of 11,237 deposit-eligible books record a IIIF manifest as
 * `image_source.source_url` (Munich, Harvard, EAP, e-rara…), so a quarter of
 * deposits printed "Source images: <url>" against a link that hands a scholar
 * a wall of JSON. Prefer a page a person can open when the book has one, and
 * where only the manifest exists, say that it is a manifest rather than
 * implying it is somewhere to browse.
 *
 * Deliberately NOT doing per-host manifest→viewer URL mapping: that is a
 * provider allowlist (see .claude/docs/invariants/image-host-allowlists.md)
 * and belongs in its own change, not in a typesetting fix.
 */
export function resolveSourceImages(book) {
  const recorded = book?.image_source?.source_url || null;
  const ia = book?.ia_identifier ? `https://archive.org/details/${book.ia_identifier}` : null;
  const isManifest = Boolean(recorded && IIIF_MANIFEST.test(recorded));
  if (isManifest && ia) return { url: ia, label: 'Source images' };
  const url = recorded || ia;
  if (!url) return { url: null, label: 'Source images' };
  return { url, label: isManifest ? 'Source images (IIIF manifest)' : 'Source images' };
}

/**
 * A URL as displayed text. `hyphenate: false` stops Typst INSERTING hyphens
 * but not breaking at the hyphens a slug already contains, so
 * `de-historia-stirpium-commentarii-insignes-fuchs-2` broke mid-slug and the
 * printed reference read as two broken URLs — a reader cannot tell that
 * trailing hyphen from one the typesetter added.
 *
 * So: hyphens are made non-breaking (U+2011) and a zero-width space is added
 * after each slash, which is the one place a URL may be broken unambiguously.
 *
 * TRADE-OFF, deliberate: text transformed this way no longer copy-pastes into
 * a browser, because U+2011 is not U+002D. That is acceptable ONLY because
 * every one of these is a live link (the href is untouched) and because the
 * imprint page's "Cite as" block — the string the edition actually tells a
 * reader to copy — is left raw. Do not run a citation through this.
 */
export function urlDisplay(url) {
  return String(url ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/-/g, '‑')
    .replace(/\//g, '/​');
}

/**
 * Page furniture the translation emitted as a bracketed English *description*
 * rather than a tag: "[Bottom center signature mark]", "[Bottom right
 * catchword/fragment]", "[page number]". The prompt asks for <sig>/<catchword>
 * tags (src/lib/types/prompt.ts) and mostly gets them; this is the residue.
 *
 * Only POSITION-and-furniture descriptions match. Bracketed descriptions of
 * woodcuts, ornaments and decorated initials are deliberately excluded — for
 * a book like the Fuchs herbal, whose deposit carries no plate images at all,
 * those descriptions are the only record that the illustration exists.
 *
 * Signature letters and catchwords sit between the brackets as bare tokens
 * ("[Bottom center signature mark] A [Bottom right catchword]"), so a short
 * run of them is consumed too.
 *
 * Related: `LEADING_FURNITURE` in src/lib/page-continuity.ts does the same job
 * for the reader's continuity flags, but only for TAGGED furniture and bare
 * uppercase lines — it does not know this bracketed form. Teaching it that is
 * a change to a live reading surface and belongs in its own PR.
 */
const APPARATUS_PHRASE = /^\[[^\]]{0,80}?(?:catchword|signature mark|sig\.? mark|page number|folio number|running head|(?:bottom|top)\s+(?:center|centre|left|right))[^\]]{0,40}\]/i;

/**
 * A word the printer split across a page break ("py-" | "ramids") reaches the
 * translation as two pages, each translated alone: the first ends on the
 * fragment, and the second usually renders the whole word ("…of the pyramids").
 * Joined into one paragraph that reads "each py- of the pyramids". When one of
 * the next page's first words starts with the fragment, the fragment goes;
 * otherwise it stays, since guessing the word would be inventing it.
 * `typ` is the earlier page's Typst; the two texts are the pages' plain prose.
 */
export function closeSplitWord(typ, prevText, nextText) {
  const m = String(prevText).trimEnd().match(/(?:^|[^\p{L}])(\p{L}+)-$/u);
  if (!m) return typ;
  const frag = m[1].toLowerCase();
  const words = String(nextText).replace(/^(?:\.\.\.|…)\s*/, '').replace(/[\[\]*_\\]/g, '').split(/\s+/).slice(0, 4);
  if (!words.some(w => { const l = w.toLowerCase().replace(/^\P{L}+/u, ''); return l.length > frag.length && l.startsWith(frag); })) return typ;
  const at = typ.lastIndexOf(`${m[1]}-`);
  return at < 0 ? typ : typ.slice(0, at).replace(/\s+$/, '') + typ.slice(at + m[1].length + 1);
}

/**
 * The translation describes what it sees as well as translating it: "This page
 * is blank … foxing", "An engraving shows a seven-tiered pedestal". The first
 * is never the author's and always goes. The second is the only sign of a
 * figure in a text-only edition, so it goes only where the plate itself is
 * printed (`figures`): Fludd UCH I carried 342 such notes beside its plates.
 */
const PAGE_DESC_NOTE = /^(This|The) (page|leaf|flyleaf|verso|recto|page surface)\b[\s\S]*\b(blank|foxing|stain|faded|bleed-?through|torn|worn|damaged|no (legible |primary )?(printed |handwritten )?text|ink transfer|ghosting|spotting|discolou?r)/i;
const FIGURE_DESC_NOTE = /^(A|An|This|The)\s+(?:[\w-]+\s+){0,4}(engraving|woodcut|illustration|diagram|image|ornament|tailpiece|headpiece|figure|vignette|plate|cut|border)s?\b/i;
export function dropDescriptiveNotes(body, { figures = false } = {}) {
  let out = '', i = 0;
  for (let at = body.indexOf('#footnote[', i); at >= 0; at = body.indexOf('#footnote[', i)) {
    let d = 0, j = at + 10;
    for (; j < body.length; j++) {
      if (body[j] === '\\') { j++; continue; }
      if (body[j] === '[') d++;
      else if (body[j] === ']') { if (d === 0) break; d--; }
    }
    const note = body.slice(at + 10, j);
    const end = body[j + 1] === ';' ? j + 2 : j + 1;
    const drop = PAGE_DESC_NOTE.test(note) || (figures && FIGURE_DESC_NOTE.test(note));
    out += body.slice(i, at) + (drop ? '' : body.slice(at, end));
    i = end;
  }
  return out + body.slice(i);
}

export function stripLeadingApparatus(text) {
  let t = String(text ?? '');
  for (let i = 0; i < 6; i++) {
    const before = t;
    t = t.replace(/^\s+/, '');
    const m = t.match(APPARATUS_PHRASE);
    if (m) t = t.slice(m[0].length);
    // A bare signature letter or catchword token stranded between two brackets
    else t = t.replace(/^[\p{Lu}\p{N}][\p{L}\p{N}.]{0,3}(?=\s*\[)/u, '');
    if (t === before) break;
  }
  return t.replace(/^\s+/, '');
}

/** Locators shown per index entry before the list is elided. */
export const INDEX_MAX_LOCATORS = 12;
/** Entries kept per index section, chosen by weight then sorted for reading. */
const INDEX_MAX_ENTRIES = 240;

/**
 * Turn a raw `books.index.*` array into printable index entries.
 *
 * Three things the raw arrays are not: deduplicated (`botany` and `Botany`
 * arrive as separate entries), ordered for a reader (they come out weighted,
 * so an alphabetical slice would stop at C), or filtered for usefulness — in
 * a 940-page herbal `botany` carries 300 locators, which is the subject of
 * the book rather than an index entry.
 */
const PAGE_CONDITION_TERM = /^(blank( page| leaf| verso| recto)?|bleed-?through|show-?through|foxing|stain(s|ing)?|water ?damage|fly-?leaf|end-?paper|paste-?down|binding|bookplate|shelf-?mark|ink transfer|ghosting|scan(ning)?|digiti[sz]ation|marginalia|catchword|signature mark|page number|running head)$/i;
export function indexEntries(entries, pageCount = 0) {
  if (!entries?.length) return [];
  // A term on more than a quarter of the pages is the book's subject, not a
  // way into it. The floor keeps short books (where a quarter is 3 pages)
  // from having their whole index filtered away.
  const tooCommon = Math.max(20, Math.round(pageCount * 0.25));
  const merged = new Map();
  for (const entry of entries) {
    const term = String(entry?.term ?? '').trim();
    // The index is built from page metadata, which also records the state of
    // the PAGE (Fludd UCH I indexed 'blank page' and 'bleed-through')
    if (!term || PAGE_CONDITION_TERM.test(term)) continue;
    const key = term.toLocaleLowerCase();
    const existing = merged.get(key);
    if (existing) {
      for (const p of entry.pages || []) existing.pages.add(p);
      // Prefer the capitalised form: proper nouns should not be folded to lower case.
      if (term[0] === term[0].toLocaleUpperCase()) existing.term = term;
    } else {
      merged.set(key, { term, pages: new Set(entry.pages || []) });
    }
  }
  return [...merged.values()]
    .map(e => ({ term: e.term, pages: [...e.pages].sort((a, b) => a - b) }))
    .filter(e => e.pages.length > 0 && e.pages.length <= tooCommon)
    .sort((a, b) => b.pages.length - a.pages.length)
    .slice(0, INDEX_MAX_ENTRIES)
    .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));
}

// ── Compile ─────────────────────────────────────────────────────────

/**
 * Per-book credit lines for the imprint page (`books.edition_credits`, set by
 * hand — they go into a permanent deposit). A funder is credited by the
 * dedication page instead: `books.acquisition_funder` or `books.dedication`.
 */
export function editionCredits(book) {
  return book.edition_credits || [];
}

/**
 * The dedication for a book, in precedence: the book's own, then the one
 * carried by a collection it belongs to (a funded collection dedicates every
 * book in it), then the standing line for a named funder. `collections` are
 * the collection documents for `book.collections` that carry a `dedication`.
 * Text is printed as written; a blank line separates the salutation from
 * the body ("To N.\n\nwhose generosity…").
 */
export function resolveDedication(book, collections = []) {
  if (book.dedication) return book.dedication;
  const fromCollection = (book.collections || [])
    .map(slug => collections.find(c => c.slug === slug || c.id === slug)?.dedication)
    .find(Boolean);
  if (fromCollection) return fromCollection;
  if (book.acquisition_funder) return `To ${book.acquisition_funder},\n\nwhose generosity brought this book and its companions into the library.`;
  return null;
}

/**
 * Set a dedication in the form the books themselves use — read from Fuchs
 * to Joachim of Brandenburg (1542), della Porta to Philip II (1560) and
 * Hooke to Charles II (1665): a cascade of address lines, a salutation, a
 * short body, then valediction and signature.
 *
 * The text is plain paragraphs separated by blank lines:
 *   - a first paragraph in CAPITALS (or lines beginning with #) is the
 *     address cascade — first line small and spaced ("TO"), second large
 *     (the name), the rest small capitals; a single short first line is a
 *     plain salutation instead
 *   - a one-line paragraph ending in a comma ("SIR,") is the salutation
 *   - everything after a line of three dashes is the close: valediction
 *     lines, then the signature, then (optionally) place and date
 */
export function dedicationToTypst(text) {
  const blocks = String(text).trim().split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const closeAt = blocks.findIndex(b => /^-{3,}$/.test(b));
  const close = closeAt >= 0 ? blocks.splice(closeAt).slice(1).flatMap(b => b.split('\n')) : [];

  let address = [];
  const first = blocks[0]?.split('\n').map(l => l.trim()) || [];
  if (first.length && first.every(l => l.startsWith('#') || (l === l.toUpperCase() && /\p{L}/u.test(l)))) {
    address = first.map(l => l.replace(/^#+\s*/, ''));
    blocks.shift();
  } else if (first.length === 1 && first[0].length < 70) {
    address = [first[0]];
    blocks.shift();
  }
  let salutation = null;
  if (blocks[0] && !blocks[0].includes('\n') && blocks[0].length < 40 && /[,:]$/.test(blocks[0])) salutation = blocks.shift();

  const addressTypst = address.map((line, i) => {
    if (address.length === 1) return `text(size: 12.5pt, tracking: 0.08em, smallcaps[${escapeTypst(line)}])`;
    if (i === 0) return `text(size: 9pt, tracking: 0.3em)[${escapeTypst(line.toUpperCase())}]`;
    if (i === 1) return `v(2mm)\n    text(size: 15pt, tracking: 0.12em)[${escapeTypst(line.toUpperCase())}]`;
    return `v(1.2mm)\n    text(size: 9.5pt, tracking: 0.1em, smallcaps[${escapeTypst(line.toLowerCase())}])`;
  }).join('\n    linebreak()\n    ');

  const body = blocks.map(b => escapeTypst(b.replace(/\s*\n\s*/g, ' '))).join('\n\n');
  const sig = close.length ? close[close.length - (/\d{4}/.test(close[close.length - 1]) && close.length > 1 ? 2 : 1)] : null;
  const closeTypst = close.map(line => {
    if (line === sig) return `text(size: 10.5pt, tracking: 0.12em, smallcaps[${escapeTypst(line)}])`;
    if (/\d{4}/.test(line) && close.indexOf(line) === close.length - 1) return `text(size: 9pt, fill: muted)[${escapeTypst(line)}]`;
    return `text(size: 10.5pt, style: "italic")[${escapeTypst(line)}]`;
  }).join('\n    linebreak()\n    ');

  return `
#page(header: none, footer: none)[
  #set par(first-line-indent: 0pt, justify: false, leading: 0.62em)
  #v(${body.length > 600 ? 12 : 20}%)
  #align(center, block(width: 112mm, {
    ${addressTypst}
    ${address.length > 1 ? 'v(5mm)\n    diamond-rule(gold)\n    v(5mm)' : 'v(5mm)'}
  }))
  #align(center, block(width: 112mm, {
    set par(justify: true, first-line-indent: 1.3em, leading: 0.68em, spacing: 0.68em)
    set text(size: 10.5pt)
    set align(left)
    ${salutation ? `text(tracking: 0.08em, smallcaps[${escapeTypst(salutation)}])\n    v(0.6em)` : ''}
    [${body}]
    ${close.length ? `v(2.2em)\n    align(right, {\n    ${closeTypst}\n    })` : ''}
  }))
]
`;
}

/**
 * The book's chosen cover page (usually its title page) as a JPEG buffer for
 * the frontispiece, or null — the PDF is complete without it, so every
 * failure here is soft. The URL must carry the book's own id: a page-image
 * key that does not is shared between books by construction (#3362), and a
 * frontispiece from another book is worse than none.
 */
export async function fetchFrontispiece(book) {
  const url = book.image_display || book.thumbnail;
  if (!url || !/^https:\/\//.test(url) || !url.includes(String(book.id))) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SourceLibrary-scholarly-pdf/1.0 (+https://sourcelibrary.org)' } });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    const { default: sharp } = await import('sharp');
    return await sharp(raw).rotate().resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}

// gallery_images.type → the caption's word for it
const PLATE_KINDS = {
  engraving: 'Engraving', woodcut: 'Woodcut', diagram: 'Diagram', frontispiece: 'Frontispiece',
  emblem: 'Emblem', portrait: 'Portrait', map: 'Map', chart: 'Chart', table: 'Table',
  botanical: 'Botanical illustration', anatomical: 'Anatomical illustration',
};
// The text block is 125mm wide; a plate taller than this would leave no room
// on its page for the caption and running head
const PLATE_MAX_W_MM = 125;
const SMALL_CUT_MIN_W_MM = 35;
// 140mm, not the 175mm the page allows: a 1,000-page book with 600 plates ran
// to 1,800 pages, and a smaller plate still reads at print size
const PLATE_MAX_H_MM = 140;
// A frontispiece or title page gets a page of its own, centred on the page and
// wider than the text column (A4 is 210mm; this leaves 20mm a side)
const FULL_PLATE_MAX_W_MM = 170;
const FULL_PLATE_MAX_H_MM = 188;
const FULL_PAGE_TYPES = new Set(['frontispiece', 'title-page']);
// Kinds that are always worth printing, whatever their gallery score: a
// typographic table or a faint diagram scores low as a gallery picture but is
// part of the argument
const ALWAYS_PLATE_TYPES = ['diagram', 'frontispiece', 'title-page', 'map', 'chart', 'table'];

/** The gallery_images query for an edition's plates (shared with the caption pass). */
export function illustrationQuery(book) {
  return { book_id: book.id, type: { $ne: 'decorative' }, $or: [{ gallery_quality: { $gte: 0.7 } }, { type: { $in: ALWAYS_PLATE_TYPES } }] };
}

/**
 * One caption value as Typst content. A value is its own content block, so a
 * leading "13." opens a numbered list and "- " a bullet: the Peter/Pierre
 * plate of Fludd UCH I (p. 266) lost its number lines that way.
 */
export function captionCell(text) {
  return escapeTypst(text).replace(/^(\s*)(\d+)\./, '$1$2\\.').replace(/^(\s*)([-+=])(?=\s|$)/, '$1\\$2');
}

// A plate and its caption float as one unbreakable block, so together they
// must fit the 237mm text height. The caption's height is estimated from its
// characters (8.8pt: ~1.75mm a character, 4.6mm a line); a Fludd contents
// table with a long caption ran past the foot of its page (UCH I, p. 1020).
const PLATE_PAGE_MM = 222;
const PLATE_MIN_H_MM = 100;
export function captionHeightMm({ labels = [], lines = [], key = [], follows = false }, widthMm) {
  const cpl = Math.max(100, widthMm) / 1.75;
  const rows = chars => Math.ceil(chars / cpl);
  const text = v => String(v ?? '').length;
  let h = 4.6 + 2.2; // title line, gap under the image
  h += rows(labels.reduce((n, [o, e]) => n + text(o) + text(e) + 6, 0)) * 4.6;
  for (const [o, e] of lines) h += rows(text(e) + (o ? text(o) + 3 : 0)) * 4.6 + 1.7;
  h += rows(key.reduce((n, [m, e]) => n + text(m) + text(e) + 4, 0)) * 4.6;
  return h + (follows ? 4.6 : 0);
}

function plateTypst(il) {
  const aspect = il.height / il.width;
  let widthMm = il.full
    ? Math.min(FULL_PLATE_MAX_W_MM, FULL_PLATE_MAX_H_MM / aspect)
    : Math.min(PLATE_MAX_W_MM, PLATE_MAX_H_MM / aspect);
  // A small cut prints small: scaled by how much of the source page's width it
  // takes (the 1617 text block is ~80% of the page, ours 125mm), never below
  // 35mm. A plate that filled the page is held by the caps above.
  if (!il.full && il.pageShare) widthMm = Math.min(widthMm, Math.max(SMALL_CUT_MIN_W_MM, (il.pageShare / 0.8) * PLATE_MAX_W_MM));
  const kind = PLATE_KINDS[il.type] || 'Illustration';
  const c = plateCaption(il.caption);
  const pairs = list => `(${list.map(([a, b]) => `([${captionCell(a)}], [${captionCell(b)}])`).join(', ')},)`;
  const parts = [`kind: [${kind}]`];
  if (il.full) parts.push('full: true');
  if (c?.title) parts.push(`title: [${escapeTypst(c.title)}]`);
  // A label that reads the same in English (a number, a name) prints once
  if (c?.labels.length) parts.push(`labels: (${c.labels.map(([o, e]) => `(${String(o).trim() === String(e).trim() ? 'none' : `[${captionCell(o)}]`}, [${captionCell(e)}])`).join(', ')},)`);
  // Glosses the translation set as notes on this page are the same words; the
  // caption pass read them from the plate itself, so they are used only without it
  const lines = il.textFollows ? [] : c?.lines.length ? c.lines : (il.inscriptions || []).map(t => [null, t]);
  if (il.textFollows) parts.push('follows: true');
  if (lines.length) parts.push(`lines: (${lines.map(([o, e]) => `(${o ? `[${captionCell(o)}]` : 'none'}, [${o ? captionCell(e) : e}])`).join(', ')},)`);
  if (c?.key.length) parts.push(`key: ${pairs(c.key)}`);
  // Shrink the plate to make room for its words; when even the smallest
  // plate leaves no room, the words follow it in the text instead
  const capH = captionHeightMm({ labels: c?.labels || [], lines, key: c?.key || [], follows: il.textFollows }, widthMm);
  const imgH = w => w * aspect + 2.4;
  if (imgH(widthMm) + capH > PLATE_PAGE_MM) {
    if (PLATE_PAGE_MM - capH >= PLATE_MIN_H_MM) widthMm = (PLATE_PAGE_MM - capH - 2.4) / aspect;
    else parts.push('words: true');
  }
  return `#plate(${typstString(il.file)}, ${widthMm.toFixed(1)}mm, "${il.page_number}", ${parts.join(', ')})`;
}

/**
 * The caption pass's model output, keys repaired: it sometimes writes
 * "box_ 2d" or "label" for "box_2d" and "title". A box must be four numbers
 * on the 0–1000 scale with positive area, or it is dropped (null).
 */
export function normalizeCaptionFigure(fig) {
  const out = {};
  for (const [k, v] of Object.entries(fig || {})) {
    const key = k.replace(/\s+/g, '').toLowerCase();
    if (/^box/.test(key)) out.box_2d = v;
    else if (key === 'title' || key === 'label' || key === 'caption') out.title ??= v;
    else out[key] = v;
  }
  const b = Array.isArray(out.box_2d) ? out.box_2d.map(Number) : null;
  out.box_2d = b && b.length === 4 && b.every(n => n >= 0 && n <= 1000) && b[2] > b[0] && b[3] > b[1] ? b : null;
  return out;
}

const isBareMark = s => /^[\p{L}\p{N}]{1,2}[.,]?$/u.test(String(s).trim());

/**
 * A caption-pass figure (scripts/qa/plate-captions.mjs) → what the plate
 * prints: a title, short labels run together, longer inscriptions one to a
 * line, and the page's letter key. Bare letters and numbers are reference
 * marks, not words, and repeats (a label printed on both sides) print once.
 */
export function plateCaption(fig) {
  if (!fig) return null;
  const seen = new Set();
  const labels = [], lines = [];
  for (const { original, english } of fig.inscriptions || []) {
    const o = String(original || '').trim(), e = String(english || '').trim();
    if (!o || !e || isBareMark(o) || seen.has(o.toLowerCase())) continue;
    seen.add(o.toLowerCase());
    (o.split(/\s+/).length <= 3 && e.split(/\s+/).length <= 5 ? labels : lines).push([o, e]);
  }
  const key = (fig.key || []).filter(k => k.mark && k.english).map(k => [String(k.mark).trim(), String(k.english).trim().replace(/\.$/, '')]);
  const title = String(fig.title || '').trim().replace(/\.$/, '') || null;
  return { title, labels, lines, key };
}

/** The content of each `#footnote[…];` at the start of `s`, bracket-balanced, and where they end. */
function leadingFootnotes(s) {
  const notes = [];
  let i = 0;
  while (s.startsWith('#footnote[', i)) {
    let depth = 0, j = i + '#footnote'.length;
    for (; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '[') depth++;
      else if (s[j] === ']' && --depth === 0) break;
    }
    if (depth !== 0) return null;
    notes.push(s.slice(i + '#footnote['.length, j));
    i = j + 1;
    if (s[i] === ';') i++;
    while (/\s/.test(s[i] || '')) i++;
  }
  return i === s.length && notes.length ? notes : null;
}

/**
 * A paragraph that is nothing but footnotes prints as a bare superscript on a
 * line of its own. On a page with a plate it is almost always the translated
 * text engraved on the plate (labels, mottoes) — the model has nowhere else
 * to put it — so it moves under the image, when the translation labels it so
 * ("Gloss:", "Inscription:"…; the label itself is dropped). A note nested
 * inside one (a gloss on the gloss) is kept in parentheses.
 */
/**
 * A paragraph that is nothing but footnotes prints as a bare superscript on a
 * line of its own; its notes go to the end of the paragraph before, where the
 * marker reads as belonging to that text. A labelled gloss is left in place
 * for takeInscriptions, and the page's first paragraph has nothing before it.
 */
export function attachOrphanNotes(body) {
  const paras = body.split(/\n{2,}/);
  const out = [];
  for (const para of paras) {
    const notes = leadingFootnotes(para.trim());
    if (notes && out.length && !notes.some(n => INSCRIPTION_LABEL.test(n))) out[out.length - 1] = out[out.length - 1].trimEnd() + para.trim();
    else out.push(para);
  }
  return out.join('\n\n');
}

const INSCRIPTION_LABEL = /^\s*(?:gloss|inscription|label|motto|legend)\s*:\s*/i;

export function takeInscriptions(body) {
  const inscriptions = [];
  const kept = body.split(/\n{2,}/).filter(para => {
    const notes = leadingFootnotes(para.trim());
    // Only what the translation itself labels as text on the image: a bare
    // note is as often the model describing the picture, which is not the
    // plate's to carry
    if (!notes || !notes.every(n => INSCRIPTION_LABEL.test(n))) return true;
    for (const n of notes) {
      const text = n.replace(/#footnote\[([^\[\]]*)\];?/g, ' ($1)')
        .replace(INSCRIPTION_LABEL, '').replace(/\s+\(/g, ' (').trim();
      if (text) inscriptions.push(text);
    }
    return false;
  });
  return { body: kept.join('\n\n'), inscriptions };
}

/**
 * The book's illustrations from `gallery_images`, fetched as JPEG buffers for
 * the edition's figures. Same selection as the scholarly EPUB (download route,
 * generateScholarlyEpubDownload): quality ≥ 0.7, no decorative initials or
 * headpieces — plus every diagram, map, table, frontispiece and title page
 * whatever its score (illustrationQuery). Frontispieces and title pages are
 * marked `full` and print at full page.
 * Like the frontispiece, every failure is soft (a missing plate is left out,
 * never substituted), and a crop URL must carry the book's own id (#3362).
 */
export async function fetchIllustrations(db, book, { concurrency = 6, captions = null } = {}) {
  const docs = await db.collection('gallery_images')
    .find(illustrationQuery(book), { projection: { page_number: 1, detection_index: 1, type: 1, extracted_url: 1 } })
    .sort({ page_number: 1, detection_index: 1 })
    .toArray();
  const wanted = docs.filter(d => d.extracted_url && d.extracted_url.includes(String(book.id)));
  // Title pages print whole, at full page, even where the gallery holds no
  // record for them (a typeset title page is not a "picture" to the detector)
  const titlePages = await db.collection('pages')
    .find({ book_id: book.id, page_type: 'title-page' }, { projection: { page_number: 1, archived_photo: 1 } })
    .toArray();
  const titleNumbers = new Set(titlePages.map(p => p.page_number));
  for (const p of titlePages) {
    if (!wanted.some(d => d.page_number === p.page_number) && p.archived_photo?.includes(String(book.id))) {
      wanted.push({ page_number: p.page_number, detection_index: 0, type: 'title-page', extracted_url: p.archived_photo });
    }
  }
  wanted.sort((a, b) => a.page_number - b.page_number || a.detection_index - b.detection_index);
  const isFull = d => FULL_PAGE_TYPES.has(d.type) || titleNumbers.has(d.page_number);

  // A page the caption pass has read is cut again from the full scan with its
  // tighter box, one plate per figure it found; the rest use the gallery crop
  const jobs = [];
  const captioned = new Set();
  for (const d of wanted) {
    const cap = captions?.[d.page_number];
    const figs = (cap?.figures || []).map(normalizeCaptionFigure);
    // Every figure needs a usable box, or the page keeps its gallery crop: a
    // missing box would otherwise print the whole page, text and all
    if (figs.length && figs.every(f => f.box_2d) && cap.scan_url?.includes(String(book.id))) {
      if (captioned.has(d.page_number)) continue;
      captioned.add(d.page_number);
      figs.forEach(fig => jobs.push({ page_number: d.page_number, type: d.type, full: isFull(d), url: cap.scan_url, box: fig.box_2d, caption: fig }));
    } else {
      jobs.push({ page_number: d.page_number, type: d.type, full: isFull(d), url: d.extracted_url });
    }
  }

  const { default: sharp } = await import('sharp');
  const scans = new Map(); // one fetch per page, however many figures it holds
  const getImage = url => {
    if (!scans.has(url)) {
      // Full page scans run to several MB and arrive six at a time: the
      // timeout covers the body too, and 30s dropped a fifth of the plates
      scans.set(url, fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'SourceLibrary-scholarly-pdf/1.0 (+https://sourcelibrary.org)' } })
        .then(res => (res.ok ? res.arrayBuffer() : null)).then(b => (b ? Buffer.from(b) : null)));
    }
    return scans.get(url);
  };
  const out = new Array(jobs.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const i = next++;
      const j = jobs[i];
      try {
        const raw = await getImage(j.url);
        if (!raw) { console.warn(`plate on source page ${j.page_number} left out: image fetch failed`); continue; }
        let img = sharp(raw).rotate();
        let pageShare = null;
        if (j.box) {
          // box_2d is [ymin, xmin, ymax, xmax] on 0–1000 of the whole page
          const { width: W, height: H } = await sharp(raw).rotate().metadata();
          // A model's box hugs the ink and clips a corner; give it a little paper,
          // in proportion: a fixed 12/1000 around a cut 90/1000 wide took in the
          // words beside it (Fludd UCH I, pp. 248–249)
          const [by0, bx0, by1, bx1] = j.box.map(Number);
          const padY = Math.min(12, 0.06 * (by1 - by0)), padX = Math.min(12, 0.06 * (bx1 - bx0));
          const [y0, x0, y1, x1] = [Math.max(0, by0 - padY), Math.max(0, bx0 - padX), Math.min(1000, by1 + padY), Math.min(1000, bx1 + padX)];
          const left = Math.max(0, Math.floor((x0 / 1000) * W)), top = Math.max(0, Math.floor((y0 / 1000) * H));
          const w = Math.min(W - left, Math.ceil(((x1 - x0) / 1000) * W)), h = Math.min(H - top, Math.ceil(((y1 - y0) / 1000) * H));
          if (!(w > 20 && h > 20)) continue;
          img = sharp(await img.extract({ left, top, width: w, height: h }).toBuffer());
          pageShare = (x1 - x0) / 1000;
        }
        const { data, info } = await img.resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 84 }).toBuffer({ resolveWithObject: true });
        out[i] = { page_number: j.page_number, type: j.type, full: Boolean(j.full), caption: j.caption || null, buffer: data, width: info.width, height: info.height, pageShare };
      } catch (err) {
        // Soft — the edition is complete without it — but never silent
        console.warn(`plate on source page ${j.page_number} left out: ${err.message}`);
      }
    }
  }));
  return out.filter(Boolean);
}

/**
 * The book's own headpieces and tailpieces (scripts/qa/plate-ornaments.mjs),
 * cut from the page scans. Only ornaments marked `verified` are used: the
 * finder also boxes rules and lines of type, which nothing about the box
 * shape separates from a woodcut, so a person (or a by-eye pass) signs off.
 * Soft like the plates: a failed fetch leaves the ornament out.
 */
export async function fetchOrnaments(book, cache) {
  const { default: sharp } = await import('sharp');
  const out = [];
  for (const [n, p] of Object.entries(cache || {})) {
    const verified = (p.ornaments || []).filter(o => o.verified);
    if (!verified.length || !p.scan_url?.includes(String(book.id))) continue;
    try {
      const res = await fetch(p.scan_url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const { width: W, height: H } = await sharp(raw).metadata();
      for (const o of verified) {
        // The finder's tailpiece boxes stop at the tip of the cul-de-lampe and
        // clip it (Fludd UCH I, p. 23); a tailpiece stands in blank paper, which
        // levels to white, so a margin costs nothing. A headpiece sits on text.
        const pad = o.kind === 'tailpiece' ? 12 : 0;
        const [y0, x0, y1, x1] = o.box_2d.map(Number).map((v, i) => Math.min(1000, Math.max(0, v + (i < 2 ? -pad : pad))));
        const left = Math.max(0, Math.floor((x0 / 1000) * W)), top = Math.max(0, Math.floor((y0 / 1000) * H));
        const width = Math.min(W - left, Math.ceil(((x1 - x0) / 1000) * W)), height = Math.min(H - top, Math.ceil(((y1 - y0) / 1000) * H));
        // Printed, not pasted: the scanned paper is levelled to the page's
        // white and the woodcut kept as ink, so the ornament sits on the page
        // the way the original's sits on its paper
        const { data, info } = await sharp(raw).extract({ left, top, width, height }).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .grayscale().normalise({ lower: 1, upper: 55 }).gamma(1.4)
          .jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
        out.push({ page_number: Number(n), kind: o.kind, buffer: data, width: info.width, height: info.height });
      }
    } catch (err) {
      console.warn(`ornaments on source page ${n} left out: ${err.message}`);
    }
  }
  return out;
}

/**
 * options: { introduction, methodology, doi, version, frontispiece, illustrations }
 * `illustrations` is the output of fetchIllustrations; omit for none.
 * `frontispiece` is a JPEG/PNG buffer (see fetchFrontispiece); omit for none.
 */
export async function generateScholarlyPdf(book, pages, options = {}) {
  // Write to temp dir: the .typ and the images it references by relative path
  const tmpDir = join(tmpdir(), `sourcelibrary-typst-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  const typFile = join(tmpDir, 'edition.typ');
  const pdfFile = join(tmpDir, 'edition.pdf');

  const { frontispiece, ...rest } = options;
  if (frontispiece) {
    const ext = frontispiece[0] === 0x89 ? 'png' : 'jpg';
    writeFileSync(join(tmpDir, `frontispiece.${ext}`), frontispiece);
    rest.frontispieceFile = `frontispiece.${ext}`;
  }
  rest.ornaments = (options.ornaments || []).map((o, i) => {
    const file = `ornament-${i + 1}.jpg`;
    writeFileSync(join(tmpDir, file), o.buffer);
    return { page_number: o.page_number, kind: o.kind, width: o.width, height: o.height, file };
  });
  rest.illustrations = (options.illustrations || []).map((il, i) => {
    const file = `plate-${i + 1}.jpg`;
    writeFileSync(join(tmpDir, file), il.buffer);
    return { page_number: il.page_number, type: il.type, full: il.full, caption: il.caption, width: il.width, height: il.height, pageShare: il.pageShare, file };
  });

  writeFileSync(typFile, generateTypstSource(book, pages, rest), 'utf-8');

  try {
    execSync(`typst compile --ignore-system-fonts --font-path "${FONT_DIR}" "${typFile}" "${pdfFile}"`, {
      // Large books legitimately take minutes, and a loaded machine (this box
      // often runs concurrent pipeline jobs) stretches that further
      timeout: 300000,
      // stderr passes through: a 'layout did not converge' warning means a
      // context-measured element (a tailpiece's room check) may have been set
      // on a stale measurement, and must not go unseen
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    return readFileSync(pdfFile);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
