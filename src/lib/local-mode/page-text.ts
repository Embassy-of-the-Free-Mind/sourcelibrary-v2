/**
 * The tagged page string → the facing-page edition's blocks, glosses and furniture.
 *
 * PRIOR ART: src/components/reader/NotesRenderer.tsx — why it does not fit: it is
 * a 1,089-line client component that renders the same tags for a *different*
 * layout. It puts the printer's signature inside a collapsible metadata block,
 * renders `->…<-` as generic centred text, and sets a `<note>` inline in the
 * sentence. The three-rooms vision asks for exactly the opposite placement of all
 * three (signature in the footer beside the folio, `->…<-` as centred small caps,
 * `<note>` as a margin gloss keyed to its word), and it pulls react-markdown +
 * rehype-raw + annotation spans + AI badges that the desk reader has no use for.
 * This parser is deliberately small and returns DATA, so the renderer decides
 * placement. Production keeps NotesRenderer untouched.
 *
 * The tag set is not invented: it is a census of one page from each of 1,219 books
 * in `~/sl-corpus/books` (2026-09-12). In descending frequency, OCR emits br,
 * vocab, language, page-type, script, scan-quality, margin, gloss, page-num, meta,
 * header, unclear, image-desc, sig, column-break, columns, warning, term, insert,
 * note, sup; translations emit term, note, gloss, margin, summary, keywords, meta,
 * unclear, header, insert, page-num, column-break, sig. `->…<-` appears on 16% of
 * OCR pages and 7% of translations. Anything not in that list falls through as
 * literal text rather than being silently dropped.
 */

/** A margin gloss and the word it is keyed to. */
export interface Gloss {
  /** Stable within one parse; the matching run carries the same id. */
  id: string;
  /** The word or phrase in the text this explains. */
  anchor: string;
  /** The explanation, verbatim — never re-cased or re-punctuated. */
  text: string;
}

/** Page furniture: everything that belongs in the footer rail, not the text. */
export interface PageFurniture {
  /** Printer's signature mark, e.g. "A iii". */
  signature?: string;
  /** The number printed on the page, which need not equal its index in the scan. */
  printedNumber?: string;
  folio?: string;
  /** Running head. */
  header?: string;
  scanQuality?: string;
  script?: string;
  /** OCR's own warning about this page. */
  warning?: string;
}

export type Run =
  | { t: 'text'; s: string }
  | { t: 'anchor'; s: string; gloss: string }
  | { t: 'unclear'; s: string }
  | { t: 'sup'; s: string }
  /** Markdown emphasis the translation carries: `*x*` and `**x**`. */
  | { t: 'em'; s: string }
  | { t: 'strong'; s: string }
  | { t: 'break' };

export type Block =
  | { kind: 'para'; runs: Run[] }
  /** `->…<-`. In this corpus almost always a speaker mark in a dialogue. */
  | { kind: 'centred'; text: string }
  /** `<margin>` — a note printed in the margin of the original, not a translator's. */
  | { kind: 'marginalia'; text: string }
  /** `<column-break/>`. */
  | { kind: 'column-break' };

export interface ParsedPage {
  language?: string;
  pageType?: string;
  furniture: PageFurniture;
  blocks: Block[];
  glosses: Gloss[];
  /** `<image-desc>` — the OCR's description of a picture on the page. Not text the
   *  printer set; shown only as a caption when nothing else describes the plate. */
  imageDescription?: string;
  /** `<vocab>` — key terms the OCR pulled out. Apparatus, not reading text. */
  vocabulary: string[];
  /** True when there is nothing to read: every block is empty. */
  isEmpty: boolean;
}

/**
 * Page types where the "translation" is an AI description of a picture rather
 * than a translation of text. Kept in step with NotesRenderer's
 * DESCRIPTION_ONLY_PAGE_TYPES — a reader branch for a value the OCR prompt
 * cannot emit is dead by construction (#3591), so this list only holds values
 * the census actually saw.
 */
export const DESCRIPTION_PAGE_TYPES = new Set([
  'blank', 'frontispiece', 'illustration', 'cover', 'map', 'diagram', 'musical-score', 'table',
]);

const one = (src: string, tag: string): { value?: string; rest: string } => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(src);
  if (!m) return { rest: src };
  return { value: m[1].trim() || undefined, rest: src.replace(re, '') };
};

const all = (src: string, tag: string): { values: string[]; rest: string } => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const values: string[] = [];
  const rest = src.replace(re, (_, inner) => {
    const v = String(inner).trim();
    if (v) values.push(v);
    return '';
  });
  return { values, rest };
};

/**
 * Reflow the printed lineation. The specimen in the three-rooms doc joins
 * "continge-\nret" back into one word and lets the measure decide where lines
 * fall, because a facing-page edition only works when both columns share a
 * baseline grid — keeping the original's line breaks on the left and reflowing
 * the English on the right pulls them apart within three lines. An explicit
 * `<br>` survives (see stripInline), because where the OCR emits one it means a
 * line the compositor intended: verse, a title page, a colophon.
 */
function reflow(s: string): string {
  return s
    // "continge-\nret" and the OCR's spaced variant "flucti -\nbus".
    .replace(/(\p{L}) ?[-‐‑–][ \t]*\n[ \t]*(\p{L})/gu, '$1$2')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** A centred line's text: tags, heading hashes and emphasis asterisks out. */
function cleanLine(s: string): string {
  return reflow(s.replace(/<\/?[a-z-]+[^>]*>/gi, '').replace(/#{1,6}\s*/g, '').replace(/\*{1,2}/g, ''));
}

/** Split the surviving text into paragraphs on blank lines. */
function paragraphs(s: string): string[] {
  return s.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
}

/** The word a `<note>` is keyed to: the last word before it, punctuation stripped. */
function anchorBefore(s: string): string {
  const m = /([\p{L}\p{N}'’-]+)[^\p{L}\p{N}]*$/u.exec(s);
  return m ? m[1] : '';
}

/**
 * One paragraph → runs, appending any glosses it contains to `glosses`.
 * Inline tags only; block tags were pulled out before this ran.
 */
function inlineRuns(para: string, glosses: Gloss[], nextId: () => string): Run[] {
  const runs: Run[] = [];
  // <term>X</term> optionally followed by <gloss>Y</gloss>; <note>Y</note> keyed
  // to the preceding word; <unclear>, <sup>, <br>. Everything else is text.
  const re = /<term[^>]*>([\s\S]*?)<\/term>\s*(?:<gloss[^>]*>([\s\S]*?)<\/gloss>)?|<gloss[^>]*>([\s\S]*?)<\/gloss>|<note[^>]*>([\s\S]*?)<\/note>|<unclear[^>]*>([\s\S]*?)<\/unclear>|<sup[^>]*>([\s\S]*?)<\/sup>|<br\s*\/?>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    if (!s) return;
    // `**term**` and `*phrase*` — the translation's own markdown emphasis. Split
    // it into runs rather than showing the asterisks.
    const em = /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*/g;
    let at = 0;
    let e: RegExpExecArray | null;
    while ((e = em.exec(s)) !== null) {
      if (e.index > at) runs.push({ t: 'text', s: s.slice(at, e.index) });
      runs.push(e[1] !== undefined ? { t: 'strong', s: e[1] } : { t: 'em', s: e[2] });
      at = em.lastIndex;
    }
    if (at < s.length) runs.push({ t: 'text', s: s.slice(at).replace(/\*{1,2}/g, '') });
  };
  /** Text emitted so far, for keying a note to the word before it. */
  let emitted = '';
  while ((m = re.exec(para)) !== null) {
    const before = para.slice(last, m.index);
    pushText(before);
    emitted += before;
    last = re.lastIndex;
    const [, term, termGloss, bareGloss, note, unclear, sup] = m;
    if (term !== undefined) {
      const text = term.trim();
      if (termGloss !== undefined && termGloss.trim()) {
        const id = nextId();
        glosses.push({ id, anchor: text, text: termGloss.trim() });
        runs.push({ t: 'anchor', s: text, gloss: id });
      } else {
        pushText(text);
      }
      emitted += text;
    } else if (bareGloss !== undefined) {
      // A <gloss> with no <term> in front of it explains the word just emitted.
      const anchor = anchorBefore(emitted);
      const id = nextId();
      glosses.push({ id, anchor, text: bareGloss.trim() });
      keyLastWord(runs, anchor, id);
    } else if (note !== undefined) {
      const anchor = anchorBefore(emitted);
      const id = nextId();
      glosses.push({ id, anchor, text: note.trim() });
      keyLastWord(runs, anchor, id);
    } else if (unclear !== undefined) {
      runs.push({ t: 'unclear', s: unclear.trim() });
      emitted += unclear;
    } else if (sup !== undefined) {
      runs.push({ t: 'sup', s: sup.trim() });
      emitted += sup;
    } else {
      runs.push({ t: 'break' });
    }
  }
  const tail = para.slice(last);
  pushText(tail);
  return runs.filter((r) => r.t !== 'text' || r.s.length > 0);
}

/**
 * Turn the final occurrence of `anchor` in the last text run into an anchor run,
 * so the gloss has something to point at. When the word cannot be found (the note
 * opened the paragraph, or the anchor was itself inside a tag) the gloss still
 * exists — it just renders unkeyed, which is the honest outcome and never drops
 * a translator's note on the floor.
 */
function keyLastWord(runs: Run[], anchor: string, glossId: string) {
  if (!anchor) return;
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if (run.t !== 'text' && run.t !== 'em' && run.t !== 'strong') continue;
    const at = run.s.lastIndexOf(anchor);
    if (at === -1) continue;
    const head = run.s.slice(0, at);
    const tail = run.s.slice(at + anchor.length);
    const replacement: Run[] = [];
    if (head) replacement.push({ t: run.t, s: head });
    replacement.push({ t: 'anchor', s: anchor, gloss: glossId });
    if (tail) replacement.push({ t: run.t, s: tail });
    runs.splice(i, 1, ...replacement);
    return;
  }
}

/**
 * Parse one `pages.ocr.data` / `pages.translation.data` string.
 * Never throws: a page that parses to nothing renders as an empty pane's
 * "nothing transcribed here" line rather than a crash at 35,000 feet.
 */
export function parsePageText(raw: string | null | undefined): ParsedPage {
  const furniture: PageFurniture = {};
  const glosses: Gloss[] = [];
  let n = 0;
  const nextId = () => `g${++n}`;

  if (!raw || !raw.trim()) {
    return { furniture, blocks: [], glosses, vocabulary: [], isEmpty: true };
  }

  let s = String(raw);

  // Model preamble and code fences, which the pipeline occasionally leaves in.
  s = s.replace(/^\s*```(?:markdown|xml|html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  s = s.replace(/^(?:Here (?:is|are)|Below is|The following is)[^:\n]{0,80}:\s*\n+/i, '');

  // --- apparatus: read it, then take it out of the reading text -------------
  let r = one(s, 'language'); const language = r.value; s = r.rest;
  r = one(s, 'lang'); const language2 = r.value; s = r.rest;
  r = one(s, 'page-type'); const pageType = r.value; s = r.rest;
  r = one(s, 'script'); furniture.script = r.value; s = r.rest;
  r = one(s, 'scan-quality'); furniture.scanQuality = r.value; s = r.rest;
  r = one(s, 'sig'); furniture.signature = r.value; s = r.rest;
  r = one(s, 'page-num'); furniture.printedNumber = r.value; s = r.rest;
  r = one(s, 'folio'); furniture.folio = r.value; s = r.rest;
  r = one(s, 'header'); furniture.header = r.value; s = r.rest;
  r = one(s, 'warning'); furniture.warning = r.value; s = r.rest;

  const vocab = all(s, 'vocab'); s = vocab.rest;
  const vocab2 = all(s, 'vocabulary'); s = vocab2.rest;
  const vocabulary = [...vocab.values, ...vocab2.values]
    .flatMap((v) => v.split(/[,;]/))
    .map((v) => v.trim())
    .filter(Boolean);

  const desc = /<image-desc[^>]*>([\s\S]*?)<\/image-desc>/i.exec(s);
  const imageDescription = desc ? reflow(desc[1].replace(/<\/?[a-z-]+[^>]*>/gi, '')) || undefined : undefined;

  // Apparatus the desk reader does not surface at all. `<summary>`/`<keywords>`
  // are indexing aids; `<meta>` is editorial; `<image-desc>` describes ornament
  // rather than transcribing it; `<insert>`/`<detected-images>`/`<columns>` are
  // structural. Dropping them is the #2232 invariant — never show an editorial
  // wrapper as page text.
  for (const tag of ['summary', 'keywords', 'meta', 'image-desc', 'insert', 'detected-images', 'columns', 'split-position', 'color']) {
    s = all(s, tag).rest;
    s = s.replace(new RegExp(`<${tag}[^>]*/>`, 'gi'), '');
  }
  // Bare self-closing / unpaired apparatus openers left behind by the above.
  s = s.replace(/<image-desc[^>]*>/gi, '');

  // Legacy [[bracket:]] apparatus. Still present on older pages.
  s = s.replace(/\[\[(?:markup|language|page\s*number|page\s*type|folio|signature|warning|meta|abbrev|vocabulary|summary|keywords|header):\s*[\s\S]*?\]\]/gi, '');

  // A note is written "Lethe <note>…</note>." — the space belongs to the note,
  // and left behind it strands the full stop: "Lethe .". Close it up.
  s = s.replace(/[ \t]+(<(?:note|gloss)[^>]*>)/gi, '$1');
  // A note can run across a blank line; the paragraph splitter below would cut
  // it in two and leave a bare "<note>" in the text. Keep each note on one line.
  s = s.replace(/<(note|gloss|term)([^>]*)>([\s\S]*?)<\/\1>/gi, (_, tag, attrs, inner) => `<${tag}${attrs}>${String(inner).replace(/\s*\n\s*/g, ' ')}</${tag}>`);

  // --- blocks ---------------------------------------------------------------
  // Marginalia and centred lines are pulled out as whole blocks in document
  // order, with the surrounding prose split into paragraphs around them.
  const blocks: Block[] = [];
  const blockRe = /<margin[^>]*>([\s\S]*?)<\/margin>|->\s*([\s\S]*?)\s*<-|<column-break\s*\/?>/gi;
  let cursor = 0;
  let bm: RegExpExecArray | null;
  const flushProse = (chunk: string) => {
    for (const p of paragraphs(chunk)) {
      // A markdown heading ("### Volume I, Chapter III") is the translator marking
      // a heading the printer centred; the desk sets it the same way as `->…<-`.
      const heading = /^#{1,6}\s+([\s\S]+)$/.exec(p);
      if (heading) {
        const text = cleanLine(heading[1]);
        if (text) blocks.push({ kind: 'centred', text });
        continue;
      }
      const runs = inlineRuns(reflow(p), glosses, nextId);
      if (runs.length) blocks.push({ kind: 'para', runs });
    }
  };
  while ((bm = blockRe.exec(s)) !== null) {
    flushProse(s.slice(cursor, bm.index));
    cursor = blockRe.lastIndex;
    const [, margin, centred] = bm;
    if (margin !== undefined) {
      const text = reflow(margin.replace(/<\/?[a-z-]+[^>]*>/gi, ''));
      if (text) blocks.push({ kind: 'marginalia', text });
    } else if (centred !== undefined) {
      // `->## Heading<-` and `## ->Heading<-` both occur; the hashes are markdown
      // emphasis the desk reader expresses with small caps instead.
      const text = cleanLine(centred);
      if (text) blocks.push({ kind: 'centred', text });
    } else {
      blocks.push({ kind: 'column-break' });
    }
  }
  flushProse(s.slice(cursor));

  const isEmpty = !blocks.some((b) =>
    (b.kind === 'para' && b.runs.some((run) => run.t !== 'break')) ||
    b.kind === 'centred' ||
    b.kind === 'marginalia');

  return {
    language: language || language2,
    pageType,
    furniture,
    blocks,
    glosses,
    imageDescription,
    vocabulary,
    isEmpty,
  };
}
