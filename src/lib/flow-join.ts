// PRIOR ART: src/app/book/[id]/read/page.tsx renders one <section> per page (a hard break at every page);
// src/lib/export-markdown-html.ts makes each page's HTML and is reused unchanged. Nothing joined pages.
/**
 * Join pages into one continuous reading text (#7118).
 *
 * A printed page ends wherever the paper ran out, not where the sentence did. Rendered one
 * section per page, a sentence that crosses a page is cut in two by a rule and a heading. Here a
 * page whose text ends mid-sentence runs straight into the next page's first paragraph, and
 * the page boundary becomes a small marker linking to that page in the reader (scan beside it).
 * A page whose text ends a sentence still starts a new paragraph — the join never invents one.
 *
 * Input HTML is `markdownToHtml` output: blocks (`<p>…</p>`, headings, tables) joined by `\n`.
 * A page marked `block` (e.g. an untranslated page shown in its original language) is never
 * joined into or out of: running Latin into English would read as one passage.
 */

export interface FlowPage {
  n: number;
  /** The page's HTML, or null when the page has no text (its marker joins the next page). */
  html: string | null;
  /** Reader URL for this page. */
  href: string;
  block?: boolean;
  /** The page's illustrations as ready HTML (<figure>s). They are set at the first paragraph break at or after the
   *  page's start — never inside a sentence that runs over the page. */
  figures?: string;
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** The text at one edge of a paragraph, without notes and marginalia: a translator's note closing a page ends in
 *  "…]", which would read as a finished sentence and break a sentence that runs on (Albigensians, Kindle EPUB:
 *  "had to appear before [note] | the terrible tribunal"). The window is wide enough that a note cut by it lies far
 *  from the edge being read. */
function edgeText(html: string, side: 'start' | 'end'): string {
  const window = side === 'end' ? html.slice(-2000) : html.slice(0, 2000);
  const text = textOf(window.replace(/<span class="(?:note|margin)">[\s\S]*?<\/span>/g, ''));
  return side === 'end' ? text.slice(-400) : text.slice(0, 400);
}

/** Ends a sentence: terminal punctuation, optionally closed by quotes or brackets. */
const SENTENCE_END = /[.!?…:;][\s"'”’»)\]]*$/u;
const STARTS_LOWER = /^[\s"'“‘«(\[]*(?:\.\.\.|…)?\s*\p{Ll}/u;
/** The translation's own continuation marks at a page edge ("…we may reach"): a seam artifact, not text. */
const ELLIPSIS_START = /^\s*(?:\.\.\.|…)\s*/;
const ELLIPSIS_END = /\s*(?:\.\.\.|…)\s*$/;
const SHORT_PARA = 40;
const HYPHENATED = /\p{L}[-‐]$/u;

/** A paragraph that is wholly an editorial bracket ("[Blank page]", "[A woodcut of …]") is never prose to join. */
const BRACKETED = /^\[[^\]]*\]$/;
/** Page furniture the translation kept as text (measured on 14 books in 10 languages, 2026-10-22): a running head
 *  ("PROLOGUE.", "Concerning the Names of the Stone."), a running foot ("Dream Wanderings, Fascicle 3 24"), a
 *  signature mark ("a iij", "b", "… nor J 2") and the page's printed footnotes. */
const RUNNING_HEAD = /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;
const SIGNATURE = /^(?:\*{1,3}|[A-Za-z]{1,2}|[A-Za-z]{3}(?=\s?[\divxj]))\s?(?:\d{1,2}|[ivxj]{1,5})?$/;
const INLINE_SIGNATURE = /(\p{Ll}[,;]?)\s+[A-Z]{1,3}\s?(?:\d{1,2}|[ivxj]{1,5})$/u;
const NOTE_RULE = /^[-_—–*\s]{3,}$/;
const NOTE_LINE = /^(?:\d{1,2}[.)]?|[*†‡§]|\([a-z0-9]{1,2}\))\s+\S/;
/** Closing punctuation at the top of a page belongs to the sentence before it (", it becomes an error"). */
const PUNCT_START = /^[,;:.!?)\]»”’]+/;

/** Does the text ending `prev` carry on into the text starting `next`? */
export function continuesAcross(prev: string, next: string): boolean {
  if (!prev || !next || BRACKETED.test(prev) || BRACKETED.test(next)) return false;
  if (ELLIPSIS_END.test(prev) && ELLIPSIS_START.test(next)) return true;
  if (/^[,;:)]/.test(next)) return true;
  // A short unpunctuated paragraph before a capital is a title or heading ("THE MARRIAGE of HEAVEN and HELL"), not prose.
  if (prev.length < SHORT_PARA && !STARTS_LOWER.test(next)) return false;
  return !SENTENCE_END.test(prev) || STARTS_LOWER.test(next);
}

/** A furniture line with its numbers taken out, so "Fascicle 3 24" and "Fascicle 3 25" are the same line. */
const norm = (line: string) => line.toLowerCase().replace(/\b[ivxlcdm]+\b|[\d\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const linesOf = (para: string) => para.split('<br/>');
const firstBlock = (html: string): string | null => {
  if (!html.startsWith('<p>')) return null;
  const end = html.indexOf('</p>');
  return html.slice(3, end < 0 ? undefined : end);
};
const lastBlock = (html: string): string | null => (html.endsWith('</p>') ? html.slice(html.lastIndexOf('<p>') + 3, -4) : null);

/** Lines that open (or close) three or more pages of the run are furniture; a capitals line counts at two. */
function furniture(lines: string[]): Set<string> {
  const seen = new Map<string, number>();
  for (const line of lines) {
    const k = norm(line);
    if (line.length > 80 || k.length < 3) continue;
    seen.set(k, (seen.get(k) || 0) + (RUNNING_HEAD.test(line) ? 1.5 : 1));
  }
  return new Set([...seen].filter(([, n]) => n >= 3).map(([k]) => k));
}

/** The paragraph that ends a page, without its foot furniture; its printed footnotes come back separately. */
function trimFoot(para: string, foots: Set<string>): { para: string; notes: string[] } {
  let lines = linesOf(para);
  const last = textOf(lines[lines.length - 1]);
  if (lines.length > 1 && (SIGNATURE.test(last) || foots.has(norm(last)))) lines.pop();
  let notes: string[] = [];
  const rule = lines.findIndex((l, i) => i > 0 && NOTE_RULE.test(textOf(l)));
  if (rule > 0) {
    notes = lines.slice(rule + 1);
    lines = lines.slice(0, rule);
  } else {
    let i = lines.length;
    while (i > 1 && NOTE_LINE.test(textOf(lines[i - 1]))) i--;
    notes = lines.slice(i);
    lines = lines.slice(0, i);
  }
  lines[lines.length - 1] = lines[lines.length - 1].trimEnd().replace(INLINE_SIGNATURE, '$1');
  return { para: lines.join('<br/>'), notes };
}

/** Drop a leading running-head line from the paragraph that starts a page (only when it has text after it).
 *  A capitals line also counts when the line under it carries on in lower case ("PROLOGUE." / "truly harmonious"):
 *  no title does. A chapter title opens one page and is followed by a capital, so it is kept. */
function trimHead(para: string, heads: Set<string>): string {
  const lines = linesOf(para);
  if (lines.length < 2) return para;
  const first = textOf(lines[0]);
  if (heads.has(norm(first)) || (first.length <= 60 && RUNNING_HEAD.test(first) && STARTS_LOWER.test(textOf(lines[1])))) lines.shift();
  return lines.join('<br/>');
}

/** Trailing whitespace and line breaks off, without a `$`-anchored regex (that rescans every run of spaces). */
function trimEndBreaks(s: string): string {
  for (;;) {
    const t = s.trimEnd();
    if (t.endsWith('<br/>')) s = t.slice(0, -5);
    else return t;
  }
}

export function pageMarker(n: number, href: string): string {
  return `<a class="page-marker" id="p${n}" href="${escapeAttr(href)}" aria-label="Page ${n}, open with the scan">${n}</a>`;
}

/** A paragraph that is the translation's own account of a plate: "[An elaborate architectural engraving titled …". */
const IMAGE_ACCOUNT = /^\[(?:An?|The|Two|Three|Several)\s[^\]]{0,120}?\b(?:engraving|woodcut|illustration|diagram|drawing|figure|image|plate|emblem|portrait|map|chart|vignette|frontispiece|miniature|painting|picture|depiction)s?\b/i;

/** Seat a page's figures where the page itself describes them: the i-th figure replaces the i-th image-account
 *  paragraph, which says where the plate sits and is no longer needed once the plate is there (it is the image's
 *  alt text). Figures left over follow the last seated one; with no account on the page, none are seated. */
function seatFigures(html: string, figures: string): { html: string; rest: string } {
  if (!figures) return { html, rest: '' };
  const figs = figures.split('</figure>').filter(f => f.trim()).map(f => f + '</figure>');
  let i = 0;
  let lastEnd = -1;
  let out = '';
  let pos = 0;
  for (const m of html.matchAll(/<p>((?:<a class="page-marker"[^>]*>\d+<\/a>)*)([\s\S]*?)<\/p>/g)) {
    if (i >= figs.length) break;
    if (!IMAGE_ACCOUNT.test(textOf(m[2]))) continue;
    const at = m.index as number;
    // A page marker opening the paragraph stays; the account goes.
    out += html.slice(pos, at) + (m[1] ? `<p>${m[1]}</p>\n` : '') + figs[i++];
    pos = at + m[0].length;
    lastEnd = out.length;
  }
  if (lastEnd < 0) return { html, rest: figures };
  out += html.slice(pos);
  const left = figs.slice(i).join('');
  return { html: left ? out.slice(0, lastEnd) + left + out.slice(lastEnd) : out, rest: '' };
}

/** Put `ins` after the first closed paragraph of `html` — but never after a last paragraph whose sentence runs on. */
function placeAfterFirstBlock(html: string, ins: string): { html: string; placed: boolean } {
  if (!ins) return { html, placed: true };
  const close = html.indexOf('</p>');
  if (close >= 0 && html.length > close + 4) return { html: html.slice(0, close + 4) + '\n' + ins.trimEnd() + html.slice(close + 4), placed: true };
  if (close < 0 || SENTENCE_END.test(textOf(html.slice(-400)))) return { html: html + '\n' + ins.trimEnd(), placed: true };
  return { html, placed: false };
}
/** A page without its recurring running head and foot — page furniture, which a continuous text does not have. Only
 *  lines that recur (see `furniture`) go, and never a page's only line. */
function cleanPage(html: string, heads: Set<string>, foots: Set<string>): string {
  const fb = firstBlock(html);
  if (fb !== null) {
    const lines = linesOf(fb);
    if (heads.has(norm(textOf(fb)))) {
      const rest = html.slice(html.indexOf('</p>') + 4).trimStart();
      if (rest) html = rest;
    } else if (lines.length > 1 && heads.has(norm(textOf(lines[0])))) {
      html = '<p>' + lines.slice(1).join('<br/>').replace(/^(?:\s|<br\/>)+/, '') + html.slice(3 + fb.length);
    }
  }
  const lb = lastBlock(html);
  if (lb !== null) {
    const lines = linesOf(lb);
    const start = html.lastIndexOf('<p>');
    // A signature mark the translation set as its own paragraph ("nor" ¶ "J 2") is furniture too.
    if (foots.has(norm(textOf(lb))) || SIGNATURE.test(textOf(lb))) {
      const before = html.slice(0, start).trimEnd();
      if (before) html = before;
    } else if (lines.length > 1 && foots.has(norm(textOf(lines[lines.length - 1])))) {
      html = html.slice(0, start) + '<p>' + trimEndBreaks(lines.slice(0, -1).join('<br/>')) + '</p>';
    }
  }
  return html;
}
const isNoteBlock =(block: string) => { const first = textOf(linesOf(block)[0]); return NOTE_RULE.test(first) || NOTE_LINE.test(first); };
/** A paragraph that is nothing but notes or marginalia — the page's printed footnotes, wrapped by the translator as
 *  one <note> (Albigensians: "[1. Art. Laurac. 2. Du Mège, Hist. de Toul. …]"). */
const NOTES_ONLY = /^\s*(?:<span class="(?:note|margin)">[\s\S]*?<\/span>\s*)+$/;
/** The translator's whole-page notice on a blank leaf (0.2% of translated pages, sampled 2026-10-23). In one
 *  continuous text it reads as a line of nothing between two sentences, so the page counts as having no text. A
 *  "could not be translated" notice is NOT this: that marks text that is missing, and stays. */
const BLANK_PAGE_NOTICE = /^\[(?:blank page|this page is blank|the page is blank)\b[^\]]*\]\.?$/i;
const ZERO_WIDTH = /[\u200b-\u200f\u2060-\u2064\ufeff]/g;
/** "[Left Column]", "[Column 2]", "[Right column continued]" alone on a line: the transcriber's account of the page
 *  layout (206 in two books' indexes, 2026-10-23). Zero-width characters allowed: the provenance mark rides in them. The paged view keeps it beside the scan; read continuously it is a
 *  stray bracket between entries. */
const COLUMN_LABEL = /(<p>|<br\/>)[\s\u200b-\u200f\u2060-\u2064\ufeff]*(?:<(?:strong|em|b|i)>)?\[(?:(?:left|right|centre|center|middle|first|second|third)\s+)?column(?:\s+(?:\d+|[ivx]+))?(?:\s*[,(-]?\s*continued\)?)?\](?:<\/(?:strong|em|b|i)>)?[\s\u200b-\u200f\u2060-\u2064\ufeff]*(?:<br\/>|(?=<\/p>))/gi;
const dropColumnLabels = (html: string) => (html.search(COLUMN_LABEL) !== -1
  ? html.replace(COLUMN_LABEL, '$1').replace(/<br\/>\s*<\/p>/g, '</p>').replace(/<p>\s*<\/p>\n?/g, '')
  : html);

export function joinPagesHtml(pages: FlowPage[]): string {
  let out = '';
  let outIsBlock = false;
  let pending = '';
  /** Figures and footnotes from earlier pages still waiting for a paragraph to close. */
  let carried = '';
  const raw = pages.map(p => dropColumnLabels(p.html?.trim() || '').trim()).map(h => (BLANK_PAGE_NOTICE.test(textOf(h).replace(ZERO_WIDTH, '').trim()) ? '' : h));
  const heads = furniture(raw.map(h => { const b = firstBlock(h); return b === null ? '' : textOf(linesOf(b)[0]); }));
  const foots = furniture(raw.map(h => { const b = lastBlock(h); return b === null ? '' : textOf(linesOf(b).slice(-1)[0]); }));
  const bodies = raw.map(h => (h ? cleanPage(h, heads, foots) : h));

  pages.forEach((p, idx) => {
    const marker = pending + pageMarker(p.n, p.href);
    pending = '';
    // Figures go where the page describes them, if it does; the rest follow the page's first paragraph.
    const seated = seatFigures(bodies[idx], p.figures || '');
    const own = seated.rest;
    const whole = seated.html;
    if (!whole) {
      // A plate on a page with no text: its figure stands at the boundary, unless a sentence is still open.
      const open = out.endsWith('</p>') && !SENTENCE_END.test(textOf(out.slice(Math.max(out.lastIndexOf('<p>'), out.length - 400))));
      if ((carried || own) && !open) { out += (out ? '\n' : '') + marker + carried + own; carried = ''; } else { pending = marker; carried += own; }
      return;
    }

    // Everything here is tentative: furniture goes only if the page joins. Unjoined, both pages keep every line.
    let html = whole;
    const fb = firstBlock(html);
    if (fb !== null && heads.has(norm(textOf(fb)))) {
      const rest = html.slice(html.indexOf('</p>') + 4).trimStart();
      if (rest.startsWith('<p>')) html = rest;
    }
    let base = out;
    const stepBack = () => {
      let before = base.slice(0, base.lastIndexOf('<p>')).trimEnd();
      // The rule a translator set above the page's footnotes ("---", now an <hr/>) goes with them.
      const rule = before.match(/<hr[^>]*\/>$/);
      if (rule) before = before.slice(0, -rule[0].length).trimEnd();
      if (!before.endsWith('</p>')) return false;
      base = before;
      return true;
    };
    const lb = lastBlock(base);
    if (lb !== null && foots.has(norm(textOf(lb)))) stepBack();
    // Footnotes the translation set as paragraphs of their own after the text (Leibniz, "(a) This printing …").
    const noteBlocks: string[] = [];
    // A notes-only paragraph closing the page rides on the end of the sentence before it, where the page's notes
    // belong; as its own paragraph it would cut that sentence in two.
    let trailingNotes = '';
    for (let nb = lastBlock(base); nb !== null && (isNoteBlock(nb) || NOTES_ONLY.test(nb)); nb = lastBlock(base)) {
      if (!stepBack()) break;
      if (NOTES_ONLY.test(nb)) trailingNotes = nb.trim() + (trailingNotes ? ' ' + trailingNotes : '');
      else noteBlocks.unshift(...linesOf(nb).filter(l => !NOTE_RULE.test(textOf(l))));
    }

    const prevStart = base.endsWith('</p>') ? base.lastIndexOf('<p>') + 3 : -1;
    const nextEnd = html.startsWith('<p>') ? (html.indexOf('</p>') < 0 ? html.length : html.indexOf('</p>')) : -1;
    const foot = prevStart < 0 ? null : trimFoot(base.slice(prevStart, -4), foots);
    const nextPara = nextEnd < 0 ? null : trimHead(html.slice(3, nextEnd), heads);
    // Only the edges decide a join; testing whole paragraphs is quadratic on OCR's long runs of spaces.
    const prevText = foot === null ? '' : edgeText(foot.para, 'end');
    const nextText = nextPara === null ? '' : edgeText(nextPara, 'start');
    const join = !p.block && !outIsBlock && foot !== null && foot.para !== '' && nextPara !== null && continuesAcross(prevText, nextText);

    if (!join || foot === null || nextPara === null) {
      // The page starts a paragraph: what was waiting stands here; the page's own figures follow its first paragraph.
      const withMarker = whole.startsWith('<p>') ? `<p>${marker}${whole.slice(3)}` : marker + whole;
      const placed = placeAfterFirstBlock(withMarker, own);
      out += (out ? '\n' : '') + carried + placed.html;
      carried = placed.placed ? '' : own;
      outIsBlock = !!p.block;
      return;
    }

    let head = base.slice(0, prevStart) + trimEndBreaks(foot.para) + (trailingNotes ? ' ' + trailingNotes : '');
    const lead = nextPara.replace(/^(?:\s|<br\/>)+/, '');
    const unelided = lead.replace(ELLIPSIS_START, '');
    const elided = unelided.length !== lead.length;
    if (elided) head = head.slice(0, -40) + head.slice(-40).replace(ELLIPSIS_END, '');
    // The previous page's footnotes, then what was waiting, then this page's figures: after the joined paragraph.
    const notes = [...foot.notes, ...noteBlocks];
    const waiting = (notes.length ? `<p class="flow-footnote">${notes.join('<br/>')}</p>\n` : '') + carried + own;
    const placed = placeAfterFirstBlock(unelided + html.slice(nextEnd), waiting);
    const rest = placed.html;
    carried = placed.placed ? '' : waiting;
    const punct = rest.match(PUNCT_START)?.[0];
    if (punct) {
      out = head + punct + ' ' + marker + ' ' + rest.slice(punct.length).trimStart();
    } else if (!elided && HYPHENATED.test(prevText) && STARTS_LOWER.test(nextText) && /[-‐]$/.test(head.slice(-1))) {
      // "trea-" | "tise of" → "treatise" + marker, so the marker never splits a word.
      const cut = rest.search(/[\s<]/);
      const word = cut < 0 ? rest : rest.slice(0, cut);
      out = head.slice(0, -1) + word + marker + (cut < 0 ? '' : rest.slice(cut));
    } else {
      out = head + ' ' + marker + ' ' + rest;
    }
    outIsBlock = false;
  });
  if (pending) out += pending;
  if (carried) out += '\n' + carried.trimEnd();
  return out;
}
