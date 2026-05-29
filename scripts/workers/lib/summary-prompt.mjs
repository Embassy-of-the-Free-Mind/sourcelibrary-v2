/**
 * Shared "About This Book" summary prompt — single source of truth.
 *
 * Used by:
 *   - scripts/workers/enrich-worker.mjs  (Phase 6, full pipeline from translated pages)
 *   - scripts/maintenance/resynthesize-summaries.mjs  (cheap re-write from stored index data)
 *
 * Keeping the prompt here prevents the two callers from drifting. If you tune
 * the voice, bump SUMMARY_PROMPT_VERSION so generated records are traceable to
 * a prompt revision.
 *
 * Voice: plain encyclopedic — a library catalog note / museum wall label, not
 * marketing copy. See PR (fix/about-book-prompt) for the before/after rationale.
 */

export const SUMMARY_PROMPT_VERSION = '2026-05-29-plain-encyclopedic';

// Low temperature keeps the prose factual. At the default (~1.0) flash-lite
// reaches for grand register ("seminal", "delineates the trajectory of...")
// and slips into copywriter mode ("Readers will discover...").
export const SUMMARY_GEN_CONFIG = { temperature: 0.2 };

/**
 * Build the synthesis prompt from already-assembled inputs.
 * @param {object} o
 * @param {string} o.bookTitle      Original-language title (do not pre-translate)
 * @param {string} [o.englishTitle] English/display title, used only as a gloss
 * @param {string} o.bookAuthor
 * @param {string} o.languageContext  e.g. " The original text is in Dutch." or ''
 * @param {string} o.researchSection  Wikipedia context block or ''
 * @param {string} o.chapterSection   Detected chapter structure block or ''
 * @param {string[]} o.themes
 * @param {string[]} o.people
 * @param {string[]} o.places
 * @param {string[]} o.concepts
 * @param {string} o.sectionSummariesText  Pre-joined "Pages a-b: ..." lines
 * @param {string} o.quotesText            Pre-joined "- "quote" (p. N)" lines
 * @param {boolean} o.hasChapters
 * @returns {string}
 */
export function buildSummaryPrompt(o) {
  const {
    bookTitle, englishTitle = '', bookAuthor, languageContext = '', researchSection = '',
    chapterSection = '', themes = [], people = [], places = [], concepts = [],
    sectionSummariesText = '', quotesText = '', hasChapters = false,
  } = o;

  // Only treat the English title as a distinct gloss when it actually differs.
  const hasGloss = englishTitle && englishTitle.trim() && englishTitle.trim() !== bookTitle.trim();
  const titleRule = hasGloss
    ? `- Refer to the work by its original title exactly as given: "${bookTitle}". Lead the BRIEF with that original title, then add the English gloss in parentheses once: ("${englishTitle}"). Do not translate the title yourself or use only the English form.`
    : `- Refer to the work by its original title exactly as given: "${bookTitle}". Do not translate the title. You may add a short English gloss in parentheses once, after the first mention.`;

  return `Write a clear, factual reference description of "${bookTitle}" by ${bookAuthor}.${languageContext} Think of a good library catalog note or a museum wall label: it tells the reader plainly what the text is, what it argues, how it is structured, and who would want to read it. It does not sell.

${researchSection}
${chapterSection}
## Extracted from the text:

**Themes:** ${themes.join(', ')}

**Key People:** ${people.join(', ') || 'None identified'}

**Key Places:** ${places.join(', ') || 'None identified'}

**Key Concepts:** ${concepts.join(', ')}

## Section-by-section summaries:
${sectionSummariesText}

## Notable quotes extracted:
${quotesText}

## Your Task
Synthesize the material above into a plain, encyclopedic description. Ground every claim in the extracted content; do not embellish or invent significance.

**Hard rules — these are the difference between a catalog note and ad copy:**
${titleRule}
- Do NOT address or refer to the reader. Ban "you", "your", "readers", "readers will discover", "imagine", "discover". The description talks about the text, never to a prospective reader.
- Do NOT open with a question. No rhetorical hooks ("What if...?", "Why did...?", "How can...?"). Open by naming the work and stating plainly what it is.
- Do NOT claim modern relevance the text does not contain. No "distractions of modern life", "still resonates today", "timeless". Describe the text in its own terms and period.
- Never rate the text. Drop all praise vocabulary: no "seminal", "important", "fascinating", "remarkable", "essential", "profound", "rich", "masterful", "groundbreaking", "radical", "bold", "urgent".

**Style:**
- Also avoid these AI tells: "delves into", "rich tapestry", "sheds light on", "offers a window into", "pulls back the curtain", "comprehensive", "intricate", "nuanced", "multifaceted", and stiff verbs like "delineates", "elucidates", "utilizes" (write "uses"), "explores the trajectory of".
- No em-dashes (—). Use commas, colons, semicolons, or separate sentences.
- Short, concrete sentences. Plain words over Latinate ones. Name people, places, and specifics instead of gesturing at them.

Example of the WRONG register (sells, addresses the reader, rates the text — do NOT write like this):
  "Willem Teellinck strips away the distractions of modern life to focus on a singular, urgent question. Readers will discover a seminal manual for the soul that delineates the trajectory toward sanctification."
Example of the RIGHT register (states what it is, factual, no reader — write like this):
  "'t Nieuwe Jerusalem is a devotional treatise cast as a dialogue between the Lord and a woman named Maria. It describes how the soul moves from worldly attachment toward sanctification, joining strict Reformed doctrine to the practice of daily piety. Willem Teellinck wrote it as practical guidance for lay believers of the Dutch Second Reformation."

1. **BRIEF** (2-3 sentences):
   - Open by naming the work and what kind of text it is (treatise, dialogue, manual, essay, collection). Then state its central subject in plain terms. No hook, no reader.

2. **ABSTRACT** (1 paragraph, 4-6 sentences):
   - What the text covers, the author's position or method, and the kind of reader it serves. Factual, not promotional.

3. **DETAILED** (2-4 paragraphs):
   - How the text is organized and how the argument or material unfolds. Concrete content: the actual ideas, people, and claims in the text.

4. **SECTIONS**: ${hasChapters ? 'Use the detected chapter structure.' : 'Group into 5-8 thematic sections.'} For each:
   - Title and page range
   - What it covers (2-3 sentences)
   - 2-4 notable quotes with page numbers and significance
   - Key concepts

Output as JSON:
{
  "brief": "...",
  "abstract": "...",
  "detailed": "...",
  "sections": [
    {
      "title": "Section Title",
      "startPage": 1,
      "endPage": 10,
      "summary": "What this section covers...",
      "quotes": [
        {"text": "Exact quote", "page": 3, "significance": "Why this matters"}
      ],
      "concepts": ["Key Term", "Important Concept"]
    }
  ]
}

IMPORTANT: Use the actual quotes provided above. Don't invent new ones.`;
}
