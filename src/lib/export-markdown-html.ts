import { pipeTableToHtml, splitTableBlock } from '@/lib/markdown-table-html';
import { applyNotesOff } from '@/lib/notes-off';
import { separateTermDefinitions } from '@/lib/term-definitions';
import { stripEditorialWrapperBlocks } from '@/lib/strip-editorial-wrappers';
import { repairLeakedMarkup } from '../../scripts/lib/leaked-markup.mjs';

/**
 * Convert a page's markdown-like text to the basic HTML the EPUB/HTML exports embed.
 *
 * This lived, character-for-character, in BOTH download routes
 * (`/api/books/[id]/download` and its tenant twin `/api/[tenant]/books/[id]/download`).
 * They are not parity-tested and have measurably drifted elsewhere — 388 diff lines
 * as of #3870, with the tenant copy missing the split-page image resolver, the
 * bounded-concurrency prefetch and the zip streaming. Duplicated text markup is the
 * same hazard with a quieter failure: a served-text fix lands on one subdomain and
 * not the other, and nothing reports it. Import this; do not paste it back.
 *
 * Note ordering: tags become placeholders BEFORE HTML entities are escaped, then
 * come back as real elements after — otherwise the escape pass would eat our own
 * markup along with the page's stray angle brackets.
 */
export function markdownToHtml(text: string, opts?: { stripNotes?: boolean }): string {
  // First, remove image markdown syntax (can't embed in simple EPUB)
  // Leaked markup first (#5700), before any tag below is paired or placeholdered:
  // the same repair the reader applies, so a download reads as the page does.
  let html = repairLeakedMarkup(text).replace(/!\[.*?\]\(.*?\)/g, '');

  // Remove any standalone URLs
  html = html.replace(/https?:\/\/[^\s\)]+/g, '');

  // Notes off (scholarly EPUB): the AI's commentary goes, the transcription stays.
  // This used to delete <margin>/<gloss> CONTENT along with the note, and to leave
  // <term> chips dangling with no definition once their <note> was gone — the two
  // halves of #3870, and the same class of defect as #3811 in the reader. The rule
  // is shared with the reader (@/lib/notes-off) precisely so the export cannot
  // drift from it again; do not re-inline these regexes here.
  if (opts?.stripNotes) {
    html = applyNotesOff(html);
    html = html.replace(/\[\[notes?:\s*.*?\]\]/gi, '');
  } else {
    // The model's definitions inside <term> chips are notes (#5895). Notes on only:
    // applyNotesOff splits the chips itself, and relabelling a headword's <gloss>
    // as a <note> would get the whole line deleted with notes off (#5942).
    html = separateTermDefinitions(html);
  }

  // Convert XML annotation tags to styled aside/span blocks BEFORE escaping HTML
  // These are our custom tags that should become actual HTML elements.
  // `(?:\s[^>]*)?` tolerates attributes on the opening tag — the prompts emit
  // them (see stripEditorialWrapperBlocks) and a bare `<tag>` pattern lets the
  // whole span through as literal angle-bracket text.
  html = html.replace(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/gi, '[[NOTE_PLACEHOLDER:$1]]');
  html = html.replace(/<margin(?:\s[^>]*)?>([\s\S]*?)<\/margin>/gi, '[[MARGIN_PLACEHOLDER:$1]]');
  html = html.replace(/<gloss(?:\s[^>]*)?>([\s\S]*?)<\/gloss>/gi, '[[GLOSS_PLACEHOLDER:$1]]');
  html = html.replace(/<term(?:\s[^>]*)?>([\s\S]*?)<\/term>/gi, '[[TERM_PLACEHOLDER:$1]]');
  html = html.replace(/<unclear(?:\s[^>]*)?>([\s\S]*?)<\/unclear>/gi, '[[UNCLEAR_PLACEHOLDER:$1]]');
  // Two tags the reader shows and the exporter must show too, MARKED — not as
  // running text and not silently dropped (#4782):
  //  - <image-desc> is the AI's account of a plate. With notes on the reader
  //    renders it as a labelled chip; here it becomes a labelled span. With
  //    notes off applyNotesOff has already removed it above.
  //  - <lacuna> describes a region with no legible reading. The reader shows it
  //    in BOTH note states because a dropped region reads as a complete page —
  //    the fabrication the tag exists to prevent — so it is placeholdered here
  //    before the wrapper strip, which would otherwise delete it content-and-all.
  html = html.replace(/<image-desc(?:\s[^>]*)?>([\s\S]*?)<\/image-desc>/gi, '[[IMAGE_DESC_PLACEHOLDER:$1]]');
  html = html.replace(/<lacuna(?:\s[^>]*)?>([\s\S]*?)<\/lacuna>/gi, '[[LACUNA_PLACEHOLDER:$1]]');
  // Strip <insert> tags (keep content) and <column-break/> markers
  html = html.replace(/<insert(?:\s[^>]*)?>([\s\S]*?)<\/insert>/gi, '$1');
  html = html.replace(/<column-break\s*\/?>/gi, '');
  // `<leaf-break/>` (#5260): two leaves that share one page image and are not continuous. The
  // seam stays VISIBLE in the export as a rule — dropping it would read two unrelated leaves as
  // one passage. Placeholder now (before stripEditorialWrapperBlocks turns it into a paragraph break), element after the entity escape below.
  html = html.replace(/<leaf-break\s*\/?>/gi, '\n\n[[LEAF_BREAK_PLACEHOLDER]]\n\n');
  // Strip ->...<- centering markers (OCR convention for centered text)
  html = html.replace(/->/g, '').replace(/<-/g, '');
  // Editorial wrappers — the AI's DESCRIPTION of the page (<meta>, <summary>,
  // <vocab>, <scan-quality>, <script>, <warning>, …) — go content-and-all through
  // the one canonical list. This helper used to keep its own copy of that list;
  // it drifted (no <scan-quality>, no <script>, no attribute tolerance) and the
  // housekeeping reached every downloaded book as literal text (#4782).
  html = stripEditorialWrapperBlocks(html);
  // Export-only hides: page furniture that IS printed on the page (page numbers,
  // signatures, running headers) but interrupts a continuous reading text, plus
  // legacy tags. Kept separate from the canonical list on purpose — the quote
  // surfaces are right to serve a printed page number as page text.
  html = html.replace(/<(page-num|folio|sig|header|abbrev|detected-images|blockquote)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '');
  html = html.replace(/<(?:column-break|page-break)\s*\/?>/gi, '');

  // Escape HTML entities
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // An annotation tag still here has no partner (every paired one became a placeholder above): a stray
  // `</margin>` in the stored text. Escaped, it reads as literal "</margin>" in the book (Hariri, Kindle EPUB,
  // 2026-10-22). It carries no words, so it goes.
  html = html.replace(/&lt;\/?(?:note|margin|gloss|term|unclear|lacuna|image-desc|insert)(?:\s[^&]*?)?\/?&gt;/gi, '');
  // Plain HTML the transcription or translation carries as text (#7118, a probe of 12 random books' EPUBs found
  // 242 such tags printed with their brackets): `<br>` is a line break; a PAIRED inline tag inside one block becomes
  // the real element (`<s>the metal?</s>`; `<foreign>laas</foreign>` reads as italic); any other HTML-ish tag left
  // — an unpaired one, or `<center>`, an OCR layout hint — goes, keeping its words. Only named tags: "a < b" stays.
  // Inside a pipe-table row a <br> is a line break within the cell; anywhere else it ends the line. (Turned into a
  // newline inside a row, it cut each row of Ptolemy's Handy Tables in two and the table was lost.)
  html = html.split('\n').map(line => line.replace(/&lt;br\s*\/?&gt;/gi, /^[ \t]*\|.*\|[ \t]*$/.test(line) ? '<br/>' : '\n')).join('\n');
  html = html.replace(/&lt;(sup|sub|i|b|em|strong|s|u|small)&gt;((?:(?!\n\n)[\s\S])*?)&lt;\/\1&gt;/gi, (_m, tag: string, s: string) => `<${tag.toLowerCase()}>${s}</${tag.toLowerCase()}>`);
  html = html.replace(/&lt;(foreign|italic)(?:\s[^&]{0,80})?&gt;((?:(?!\n\n)[\s\S])*?)&lt;\/\1&gt;/gi, '<i>$2</i>');
  html = html.replace(/&lt;bold&gt;((?:(?!\n\n)[\s\S])*?)&lt;\/bold&gt;/gi, '<b>$1</b>');
  // Attributes up to 300 characters: a drop cap arrives as `<span style="font-size: 200%; float: left; …">` (Giorgi).
  // `<red>` and `<rotate value="90">` are the OCR's notes on ink and orientation (Hariri), not the book's words.
  html = html.replace(/&lt;\/?(?:center|foreign|italic|bold|div|span|p|font|i|b|em|strong|s|u|sup|sub|small|big|ins|del|mark|q|cite|abbr|red|rotate)(?:\s[^&]{0,300})?\/?&gt;/gi, '');
  // A literal <hr/> on its own line is a rule, as `---` is.
  html = html.replace(/^[ \t]*&lt;hr\s*\/?&gt;[ \t]*$/gim, '---');
  // A closing tag of any name that is still here closed nothing ("…for the students.</t>"): a closing tag is never
  // the book's words.
  html = html.replace(/&lt;\/[a-z][\w-]{0,15}&gt;/gi, '');

  // Convert placeholders to inline styled elements. `[\s\S]` because a note or
  // an image description can run several lines — `.` stopped at the first
  // newline and left the placeholder itself in the book; the span's inner
  // newlines are collapsed so the paragraph split below cannot cut it in half.
  // INNER ones first: a gloss inside a note is `[[NOTE_PLACEHOLDER: … [[GLOSS_PLACEHOLDER:x]] … ]]`, and the
  // note's lazy match stopped at the gloss's `]]`, printing the rest of the note as placeholder text (Man'yōshū:
  // 36 times in one volume). Converted first, the gloss is a <span> by the time the note is matched.
  const inline = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
  html = html.replace(/\[\[GLOSS_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<span class="gloss">${inline(s)}</span>`);
  html = html.replace(/\[\[TERM_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<em class="term">${inline(s)}</em>`);
  html = html.replace(/\[\[UNCLEAR_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<span class="unclear">${inline(s)}?</span>`);
  html = html.replace(/\[\[IMAGE_DESC_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<span class="image-desc">[Image description: ${inline(s)}]</span>`);
  html = html.replace(/\[\[LACUNA_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<span class="lacuna">[Not transcribed: ${inline(s)}]</span>`);
  html = html.replace(/\[\[NOTE_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<span class="note">[${inline(s)}]</span>`);
  html = html.replace(/\[\[MARGIN_PLACEHOLDER:([\s\S]*?)\]\]/gi, (_, s) => `<span class="margin">[${inline(s)}]</span>`);
  // Its own block: the paragraph split below leaves a block that starts with `<h` unwrapped.
  html = html.replace(/\[\[LEAF_BREAK_PLACEHOLDER\]\]/g, '<hr class="leaf-break" title="next folio"/>');

  // Convert legacy [[notes: ...]] to inline
  html = html.replace(/\[\[notes?:\s*(.*?)\]\]/gi, '<span class="note">[$1]</span>');

  // A line that is only `---` / `***` / `___` is the translator's separator (283 printed as text in 12 books):
  // a rule, as its own block. Before emphasis, which would eat `***`; table separators carry pipes and are not hit.
  // A line may open with the export's invisible provenance mark (zero-width characters, markForExport), which hid
  // `# …` and `---` lines from these rules; the mark is kept (moved to the next block for a rule), never dropped.
  const ZW = '[\\u200B-\\u200D\\u2060\\uFEFF]*';
  html = html.replace(new RegExp(`^(${ZW})[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t\\r]*(${ZW})[ \\t\\r]*$`, 'gm'), '\n\n<hr/>\n\n$1$2');

  // Convert headers (must be done before paragraph wrapping). Four to six #s were printed as text.
  html = html.replace(new RegExp(`^(${ZW})(#{1,6}) (.+)$`, 'gm'), (_m, mark: string, hashes: string, s: string) => `\n<h${hashes.length}>${mark}${s}</h${hashes.length}>\n`);

  // Convert bold and italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Split by double newlines to create paragraphs
  const blocks = html.split(/\n\n+/);

  // Process each block
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    // Don't wrap headers in paragraphs
    if (block.startsWith('<h')) {
      return block;
    }
    const para = (s: string) => (s.trim() ? `<p>${s.trim().replace(/\n/g, '<br/>')}</p>` : '');
    // GFM pipe tables become real tables, not pipe-soup inside a <p> — also when the table shares its block with a
    // caption line above or below it (Ptolemy's Handy Tables: 86 pipe rows printed as text; split further down).
    const table = pipeTableToHtml(block);
    if (table) return table;
    // A bullet list ("* SOUTH" / "* SOUTH-WEST" in Ptolemy's horizon tables; "Landmasses and Regions:" over
    // "* GREENLAND" in Goos's atlas) is a list, not starred lines: any run of two or more bullet lines, with the
    // lines around it staying text. A lone "- " (dialogue) or "+ " (a printed cross) stays text.
    const lines = block.split('\n').filter(l => l.trim());
    const BULLET = /^[ \t]*[*\-+•][ \t]+(?=\S)/;
    if (lines.filter(l => BULLET.test(l)).length >= 2) {
      const out: string[] = [];
      for (let i = 0; i < lines.length;) {
        let j = i;
        while (j < lines.length && BULLET.test(lines[j])) j++;
        if (j - i >= 2) { out.push(`<ul>${lines.slice(i, j).map(l => `<li>${l.replace(BULLET, '').trim()}</li>`).join('')}</ul>`); i = j; continue; }
        let k = Math.max(j, i + 1);
        while (k < lines.length && !(BULLET.test(lines[k]) && k + 1 < lines.length && BULLET.test(lines[k + 1]))) k++;
        out.push(para(lines.slice(i, k).join('\n')));
        i = k;
      }
      return out.filter(Boolean).join('\n');
    }
    const split = splitTableBlock(block);
    if (split) return split.map(part => ('table' in part ? part.table : para(part.text))).filter(Boolean).join('\n');
    // Replace single newlines with breaks within paragraphs
    return para(block);
  }).filter(b => b).join('\n');

  // Clean up empty paragraphs and whitespace issues
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p><br\/><\/p>/g, '');

  return html || '<p></p>';
}
