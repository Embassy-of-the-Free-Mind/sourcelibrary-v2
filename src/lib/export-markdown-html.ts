import { pipeTableToHtml } from '@/lib/markdown-table-html';
import { applyNotesOff } from '@/lib/notes-off';

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
  let html = text.replace(/!\[.*?\]\(.*?\)/g, '');

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
  }

  // Convert XML annotation tags to styled aside/span blocks BEFORE escaping HTML
  // These are our custom tags that should become actual HTML elements
  html = html.replace(/<note>([\s\S]*?)<\/note>/gi, '[[NOTE_PLACEHOLDER:$1]]');
  html = html.replace(/<margin>([\s\S]*?)<\/margin>/gi, '[[MARGIN_PLACEHOLDER:$1]]');
  html = html.replace(/<gloss>([\s\S]*?)<\/gloss>/gi, '[[GLOSS_PLACEHOLDER:$1]]');
  html = html.replace(/<term>([\s\S]*?)<\/term>/gi, '[[TERM_PLACEHOLDER:$1]]');
  html = html.replace(/<unclear>([\s\S]*?)<\/unclear>/gi, '[[UNCLEAR_PLACEHOLDER:$1]]');
  // Strip <insert> tags (keep content) and <column-break/> markers
  html = html.replace(/<insert>([\s\S]*?)<\/insert>/gi, '$1');
  html = html.replace(/<column-break\s*\/?>/gi, '');
  // Strip ->...<- centering markers (OCR convention for centered text)
  html = html.replace(/->/g, '').replace(/<-/g, '');
  // Remove metadata tags (hidden)
  html = html.replace(/<(?:lang|language|page-num|page-type|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords|columns|detected-images|blockquote)>[\s\S]*?<\/(?:lang|language|page-num|page-type|folio|sig|header|meta|warning|abbrev|vocab|summary|keywords|columns|detected-images|blockquote)>/gi, '');
  html = html.replace(/<(?:column-break|page-break)\s*\/?>/gi, '');

  // Escape HTML entities
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert placeholders to inline styled elements (no line breaks)
  html = html.replace(/\[\[NOTE_PLACEHOLDER:(.*?)\]\]/gi, '<span class="note">[$1]</span>');
  html = html.replace(/\[\[MARGIN_PLACEHOLDER:(.*?)\]\]/gi, '<span class="margin">[$1]</span>');
  html = html.replace(/\[\[GLOSS_PLACEHOLDER:(.*?)\]\]/gi, '<span class="gloss">$1</span>');
  html = html.replace(/\[\[TERM_PLACEHOLDER:(.*?)\]\]/gi, '<em class="term">$1</em>');
  html = html.replace(/\[\[UNCLEAR_PLACEHOLDER:(.*?)\]\]/gi, '<span class="unclear">$1?</span>');

  // Convert legacy [[notes: ...]] to inline
  html = html.replace(/\[\[notes?:\s*(.*?)\]\]/gi, '<span class="note">[$1]</span>');

  // Convert headers (must be done before paragraph wrapping)
  html = html.replace(/^### (.+)$/gm, '\n<h3>$1</h3>\n');
  html = html.replace(/^## (.+)$/gm, '\n<h2>$1</h2>\n');
  html = html.replace(/^# (.+)$/gm, '\n<h1>$1</h1>\n');

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
    // GFM pipe tables become real tables, not pipe-soup inside a <p>.
    const table = pipeTableToHtml(block);
    if (table) return table;
    // Replace single newlines with breaks within paragraphs
    block = block.replace(/\n/g, '<br/>');
    return `<p>${block}</p>`;
  }).filter(b => b).join('\n');

  // Clean up empty paragraphs and whitespace issues
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p><br\/><\/p>/g, '');

  return html || '<p></p>';
}
