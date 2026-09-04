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
export const SUMMARY_GEN_CONFIG = { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } };

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
Synthesize the material above into a plain, encyclopedic description. Ground every claim in the extracted content or in well-established fact. State significance concretely and factually, never as vague praise.

**Identify the author and say what makes the text notable (do this, concretely):**
- On first naming the author, add a short factual identifier: who they were in a few words (role, period, place), e.g. "Irenaeus, a second-century bishop of Lyon and early Church Father" or "Robert Fludd, an English physician and Paracelsian philosopher". Only state facts you are confident are well established. If the author is obscure or you are unsure, give the name alone and invent nothing.
- Say in one concrete sentence why the text is notable, when there is a real, factual answer: what it preserves, what it influenced, what it is a source for, what is unusual about it. Example: a polemic against a movement can be a principal source for that movement because it quotes it at length (as with Irenaeus and the Gnostics). This is factual significance, not a rating. If nothing concrete is known, omit it rather than padding with praise.

**Hard rules — these are the difference between a catalog note and ad copy:**
${titleRule}
- Do NOT address or refer to the reader. Ban "you", "your", "readers", "readers will discover", "imagine", "discover". The description talks about the text, never to a prospective reader.
- Do NOT open with a question. No rhetorical hooks ("What if...?", "Why did...?", "How can...?"). Open by naming the work and stating plainly what it is.
- Do NOT claim modern relevance the text does not contain. No "distractions of modern life", "still resonates today", "timeless". Describe the text in its own terms and period.
- Significance must be concrete and specific. Drop empty praise adjectives: no "seminal", "important", "fascinating", "remarkable", "essential", "profound", "rich", "masterful", "groundbreaking", "radical", "bold", "urgent". Say what the text did or preserves, not how impressive it is.

**Style:**
- Also avoid these AI tells: "delves into", "rich tapestry", "sheds light on", "offers a window into", "pulls back the curtain", "comprehensive", "intricate", "nuanced", "multifaceted", and stiff verbs like "delineates", "elucidates", "utilizes" (write "uses"), "explores the trajectory of".
- No em-dashes (—). Use commas, colons, semicolons, or separate sentences.
- Short, concrete sentences. Plain words over Latinate ones. Name people, places, and specifics instead of gesturing at them.

Example of the WRONG register (sells, addresses the reader, empty praise — do NOT write like this):
  "Willem Teellinck strips away the distractions of modern life to focus on a singular, urgent question. Readers will discover a seminal manual for the soul that delineates the trajectory toward sanctification."
Example of the RIGHT register (identifies the author, states concrete significance, factual, no reader — write like this):
  "Adversus haereses (Against Heresies) is a theological treatise by Irenaeus, a second-century bishop of Lyon and one of the early Church Fathers. Writing around 180 AD, he lays out the teachings of Valentinus and other Gnostic groups in order to refute them and defend what he held to be apostolic tradition. Because he quotes those teachings at length, the work is now a principal source for Gnostic thought that survives almost nowhere else."

1. **BRIEF** (2-4 sentences):
   - Open by naming the work and what kind of text it is (treatise, dialogue, manual, essay, collection). Identify the author in a few words. State the central subject plainly, and where there is a concrete answer, add one sentence on why the text is notable (what it preserves, influenced, or is a source for). No hook, no reader, no empty praise.

2. **ABSTRACT** (1 paragraph, 4-6 sentences):
   - What the text covers, who the author was, the author's position or method, and what the text is a source for or contributed. Factual, not promotional.

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
