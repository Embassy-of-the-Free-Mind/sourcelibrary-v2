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
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
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
export function translationToTypst(text, { runningHeads = new Set(), anchor = () => '' } = {}) {
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
  const footnote = content => hold(`#footnote[${escapeTypst(content)}];`);
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
  out = out.replace(/<gloss>([\s\S]*?)<\/gloss>/gi, (_, c) => {
    const clean = cleanForNote(c);
    return clean.length >= 3 ? footnote(`Gloss: ${clean}`) : '';
  });
  // <term> is used two ways: wrapping a word (keep the word) or carrying an
  // explanation of the preceding word ("hypophetas: from the Greek…") — a note
  out = out.replace(/<term>([\s\S]*?)<\/term>/gi, (_, c) => {
    const clean = cleanForNote(c);
    return clean.length > 40 || /:\s/.test(clean) ? footnote(clean) : clean;
  });

  out = out.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '[?$1]');
  out = out.replace(/<column-break\s*\/?>/gi, '\n\n');

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
      rendered.push(`#dline(${display[1]})[${takeAnchor()}${display[2]}]`);
      continue;
    }
    para = para.replace(/%%\/?DL\d?%%/g, '');
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
    const visible = l => l.replace(/%%IN\d+%%/g, '').length;
    const isList = lines.length >= 4 && lines.filter(l => visible(l) < 48).length / lines.length > 0.8;
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

  return { body: body.trim(), printedPage };
}

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

const SKIP_PAGE_TYPES = new Set(['blank']);

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
#let src(n, printed: none) = in-margin(drop: -0.7em, {
  set par(justify: false, leading: 0.4em, first-line-indent: 0pt)
  text(size: 8.5pt, fill: rust, weight: "semibold", number-type: "lining")[#n]
  if printed != none {
    text(size: 7pt, fill: muted)[#h(0.5em)orig. #printed]
  }
})

// Headings of the source itself — display lines, never outline entries
#let dline(level, body) = block(above: if level <= 2 { 1.6em } else { 1.2em }, below: 0.9em, width: 100%, sticky: true, {
  set align(center)
  set par(justify: false, first-line-indent: 0pt, leading: 0.55em)
  if level == 1 { text(size: 13pt, tracking: 0.02em, body) }
  else if level == 2 { text(size: 11.5pt, style: "italic", body) }
  else { text(size: 10.5pt, style: "italic", body) }
})

// Lists the source sets in short lines (indexes, plant names): two columns
#let listcols(body) = block(width: 100%, above: 1em, below: 1em, {
  set par(justify: false, first-line-indent: 0pt, hanging-indent: 1em)
  set text(size: 9pt)
  columns(2, gutter: 8mm, body)
})

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

export function generateTypstSource(book, pages, options = {}) {
  const { introduction, methodology, doi, version } = options;
  const bookTitle = book.display_title || book.title;
  const bookSlug = book.slug || book.id;
  const bookUrl = `https://sourcelibrary.org/book/${bookSlug}`;
  const now = new Date().toISOString().split('T')[0];
  const year = now.slice(0, 4);
  const translatedPages = pages.filter(isContentPage);
  const author = String(book.author || 'Anonymous').replace(/\s*\|\s*/g, ', ');
  const language = book.language || 'source language';

  // "Title: Subtitle" reads better on a title page as two lines of different weight
  const colon = bookTitle.indexOf(': ');
  const mainTitle = colon > 0 ? bookTitle.slice(0, colon) : bookTitle;
  const subTitle = colon > 0 ? bookTitle.slice(colon + 2) : '';

  const place = book.place_published || book.publication_place;
  const imprintLine = [[place, book.publisher].filter(Boolean).join(': '), book.published].filter(Boolean).join(', ');
  const holder = book.image_source?.contributing_library || book.contributing_library;
  const provider = book.image_source?.provider_name;
  const sourceUrl = book.image_source?.source_url
    || (book.ia_identifier ? `https://archive.org/details/${book.ia_identifier}` : null);
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
${TYPST_PREAMBLE}
#running-title.update(${typstString(shorten(mainTitle, 52))})

#set page(
  paper: "a4",
  margin: (top: 30mm, bottom: 30mm, left: margin-l, right: 210mm - margin-l - text-w),
  numbering: "i",
  header-ascent: 9mm,
  header: context {
    // Footnotes number from 1 on every page: a 900-page herbal otherwise
    // reaches note 9,299 and the markers outweigh the words they hang on
    counter(footnote).update(0)
    let pg = here().page()
    let opens = query(heading.where(level: 1)).filter(h => h.location().page() == pg)
    if opens.len() == 0 {
      set text(size: 8pt, fill: muted, number-type: "lining")
      let chapter = running-chapter.get()
      box(width: text-w + gutter + mcol, grid(
        columns: (text-w, gutter, mcol),
        [#emph(running-title.get())#h(1fr)#chapter], [],
        align(left, counter(page).display(page.numbering)),
      ))
    }
  },
  footer-descent: 12mm,
  footer: {
    set text(size: 7pt, fill: muted, tracking: 0.03em)
    align(center)[Source Library #h(0.6em)·#h(0.6em) ${escapeTypst(footerId)}]
  },
)

#set text(
  font: "Libertinus Serif",
  size: 10.5pt,
  lang: "en",
  hyphenate: true,
  number-type: "old-style",
)

#set par(
  justify: true,
  leading: 0.68em,
  spacing: 0.68em,
  first-line-indent: 1.3em,
)

#set heading(numbering: none)

#show heading.where(level: 1): it => {
  // The translation's own opener is a composed part page; its heading exists
  // for the contents and bookmarks only
  if it.has("label") and it.label == <part> { return place(hide(box(width: 0pt, height: 0pt))) }
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
  if in-body.get() { place(hide(box(width: 0pt, height: 0pt))) } else {
    block(above: 1.7em, below: 0.8em, sticky: true, text(size: 12.5pt, weight: "regular", style: "italic", it.body))
  }
}
#show heading.where(level: 3): it => context {
  if in-body.get() { place(hide(box(width: 0pt, height: 0pt))) } else {
    block(above: 1.3em, below: 0.6em, sticky: true, text(size: 10.5pt, weight: "regular", tracking: 0.04em, smallcaps(it.body)))
  }
}

#set footnote.entry(separator: line(length: 18mm, stroke: 0.4pt + hairline), gap: 0.45em, clearance: 1.2em)
#show footnote.entry: set text(size: 8.3pt)
#show footnote.entry: set par(leading: 0.5em)
#show link: set text(fill: rust)

#show outline.entry.where(level: 1): it => {
  v(0.7em, weak: true)
  text(tracking: 0.05em, smallcaps(it))
}
`);

  // ── Title page ──
  doc.push(`
#page(margin: (x: 32mm, top: 36mm, bottom: 30mm), header: none, footer: none)[
  #set par(first-line-indent: 0pt, justify: false, leading: 0.5em)
  #set align(center)
  #text(size: 8.5pt, tracking: 0.24em, fill: rust)[#upper[Source Library Editions]]
  #v(34mm)
  #text(size: 11pt, tracking: 0.16em)[#upper[${escapeTypst(author)}]]
  #v(11mm)
  #text(size: ${mainTitle.length > 48 ? 22 : 27}pt)[${escapeTypst(mainTitle)}]
  ${subTitle ? `#v(3mm)\n  #text(size: 14.5pt, style: "italic")[${escapeTypst(subTitle)}]` : ''}
  #v(9mm)
  #line(length: 22mm, stroke: 0.7pt + rust)
  #v(9mm)
  ${book.title !== bookTitle ? `#text(size: 12pt, style: "italic")[${escapeTypst(book.title)}]\n  #v(2.5mm)` : ''}
  ${imprintLine ? `#text(size: 10pt, number-type: "lining")[${escapeTypst(imprintLine)}]` : ''}
  #v(1fr)
  #text(size: 10pt)[An English translation from the ${escapeTypst(language)}]
  #v(1.5mm)
  #text(size: 9pt, style: "italic", fill: muted)[AI-assisted and not reviewed by human editors]
  #v(16mm)
  #text(size: 10pt, tracking: 0.2em)[#upper[Source Library]]
  #v(1.5mm)
  #text(size: 9pt, fill: muted)[Embassy of the Free Mind #h(0.4em)·#h(0.4em) Amsterdam #h(0.4em)·#h(0.4em) #text(number-type: "lining")[${year}]]
]
`);

  // ── Imprint page ──
  const citation = `${author}. ${bookTitle}. English translation by Source Library (AI-assisted). Amsterdam: Embassy of the Free Mind, ${year}.${version ? ` Version ${version}.` : ''} ${persistentUrl}`;
  doc.push(`
#page(header: none, footer: none)[
  #set par(first-line-indent: 0pt, justify: false, leading: 0.55em, spacing: 1.1em)
  #set text(size: 8.8pt, number-type: "lining")
  #v(1fr)
  _${escapeTypst(bookTitle)}_ \\
  An English translation of ${escapeTypst(author)}, _${escapeTypst(book.title)}_${imprintLine ? ` (${escapeTypst(imprintLine)})` : ''}.

  ${holder || provider ? `Translated from the copy ${holder ? `held by ${escapeTypst(holder)}` : ''}${provider && provider !== holder ? `${holder ? ', ' : ''}digitized by ${escapeTypst(provider)}` : ''}${sourceUrl ? `: #link(${typstString(sourceUrl)})[${escapeTypst(sourceUrl.replace(/^https?:\/\//, ''))}]` : ''}.` : ''}

  ${version ? `Version ${escapeTypst(version)}, ` : ''}${now}. ${doi ? `DOI #link(${typstString(persistentUrl)})[${escapeTypst(doi)}]. ` : ''}Each version of this edition is deposited separately and does not change; corrections appear as new versions. The current text, with page facsimiles, is at #link(${typstString(bookUrl)})[sourcelibrary.org/book/${escapeTypst(bookSlug)}].

  #text(fill: rust, tracking: 0.08em, size: 7.8pt)[#upper[Cite as]] \\
  ${escapeTypst(citation)}

  To cite a passage, give the page number printed in the margin, e.g. "p. ${translatedPages[Math.min(10, translatedPages.length - 1)]?.page_number ?? 1}".

  Published by Source Library, a project of the Embassy of the Free Mind, Amsterdam, under a Creative Commons Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0).${publicDomain ? ' The source images are in the public domain.' : ''}

  #text(fill: muted)[Set in Libertinus Serif with Typst.]
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

The translation follows the source page by page. A number in the margin marks where each page of the digitized copy begins; it is the number to cite, and the page it names can be checked against its facsimile at sourcelibrary.org/book/${escapeTypst(bookSlug)}/page/_n_. Where the source prints a page number of its own, it follows in grey.

Notes printed in the margins of the original are set in the margin here. Footnotes are not the author's: they are explanatory notes supplied in the course of translation, and carry the same caution as the translation itself. Words in square brackets are supplied by the translation; [?] marks a reading the transcription was unsure of.

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

  const runningHeads = findRunningHeads(translatedPages);
  let chapterIdx = 0;
  for (const page of translatedPages) {
    // Every chapter that starts at or before this page and has not been
    // emitted yet — a chapter whose own page was skipped as blank still
    // gets its contents entry, on the next page that has text
    while (chapterIdx < chapters.length && chapters[chapterIdx].pageNumber <= page.page_number) {
      const ch = chapters[chapterIdx++];
      const title = ch.titleEn || ch.title;
      doc.push(`#heading(level: ${(ch.level || 1) <= 1 ? 2 : 3})[${escapeTypst(title)}]`);
      doc.push(`#running-chapter.update(${typstString(shorten(title, 46))})`);
    }

    const { body } = translationToTypst(page.translation.data, {
      runningHeads,
      anchor: printedPage => `#src(${typstString(page.page_number)}${printedPage ? `, printed: ${typstString(printedPage)}` : ''});`,
    });
    if (!body) continue;
    doc.push('#pagegap');
    doc.push(body);
    doc.push('');
  }

  doc.push(`#in-body.update(false)\n#running-chapter.update("")`);

  // ── Index ──
  const index = book.index;
  if (index && (index.people?.length || index.places?.length || index.concepts?.length || index.vocabulary?.length)) {
    doc.push('\n= Index\n');
    doc.push('#[\n#set par(first-line-indent: 0pt, justify: false, hanging-indent: 1em)\n#set text(size: 9pt, number-type: "lining")\nNumbers refer to the source pages marked in the margin.\n');

    const renderSection = (title, entries) => {
      if (!entries?.length) return;
      doc.push(`== ${title}\n`);
      doc.push('#columns(2, gutter: 8mm)[');
      for (const entry of entries.slice(0, 80)) {
        const refs = entry.pages?.length ? `, ${entry.pages.slice(0, 8).join(', ')}` : '';
        doc.push(`${escapeTypst(entry.term)}${refs} \\`);
      }
      doc.push(']\n');
    };

    renderSection('People', index.people);
    renderSection('Places', index.places);
    renderSection('Concepts', index.concepts);

    if (index.vocabulary?.length) {
      doc.push('== Glossary\n');
      for (const entry of index.vocabulary.slice(0, 80)) {
        const def = entry.definition ? ` --- ${escapeTypst(entry.definition)}` : '';
        doc.push(`_${escapeTypst(entry.term)}_${def}\n`);
      }
    }
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
  [#text(fill: muted)[Pages translated]], [${translatedPages.length}],
  ${version ? `[#text(fill: muted)[Version]], [${escapeTypst(version)}],` : ''}
  ${doi ? `[#text(fill: muted)[DOI]], [#link(${typstString(persistentUrl)})[${escapeTypst(doi)}]],` : ''}
  [#text(fill: muted)[Generated]], [${now}],
  [#text(fill: muted)[License]], [CC BY-SA 4.0],
)

#v(1em)
Source Library: #link("${bookUrl}")[sourcelibrary.org/book/${escapeTypst(bookSlug)}]
${sourceUrl ? `\\\nSource images: #link(${typstString(sourceUrl)})[${escapeTypst(sourceUrl.replace(/^https?:\/\//, ''))}]` : ''}
`);

  return doc.join('\n');
}

// ── Compile ─────────────────────────────────────────────────────────

export async function generateScholarlyPdf(book, pages, options = {}) {
  const typstSource = generateTypstSource(book, pages, options);

  // Write to temp file
  const tmpDir = join(tmpdir(), `sourcelibrary-typst-${crypto.randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  const typFile = join(tmpDir, 'edition.typ');
  const pdfFile = join(tmpDir, 'edition.pdf');

  writeFileSync(typFile, typstSource, 'utf-8');

  try {
    execSync(`typst compile "${typFile}" "${pdfFile}"`, {
      // Large books legitimately take minutes, and a loaded machine (this box
      // often runs concurrent pipeline jobs) stretches that further
      timeout: 300000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pdfBuffer = readFileSync(pdfFile);
    return pdfBuffer;
  } finally {
    // Cleanup
    try { unlinkSync(typFile); } catch {}
    try { unlinkSync(pdfFile); } catch {}
    try { unlinkSync(tmpDir); } catch {} // rmdir if empty
  }
}
