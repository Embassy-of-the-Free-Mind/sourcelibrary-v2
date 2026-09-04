/**
 * Shared types + rating config for review queues.
 */

export type RatingOption = {
  key: string;        // single-letter keyboard shortcut
  rating: string;     // canonical rating value (must match server-side ALLOWED_RATINGS)
  label: string;      // UI label
  color: string;      // hex / css color for the button border accent
  hint: string;       // short explanation
};

export const QUEUE_RATINGS: Record<string, RatingOption[]> = {
  hallucination: [
    { key: 'k', rating: 'matches',       label: '✓ matches',       color: '#10b981', hint: 'Description matches the page' },
    { key: 'p', rating: 'partial',       label: '~ partial',       color: '#f59e0b', hint: 'Description mentions real element but adds invented detail' },
    { key: 'j', rating: 'hallucination', label: '✗ hallucination', color: '#ef4444', hint: 'Description is fictional / page is blank or bleedthrough' },
    { key: 'u', rating: 'unclear',       label: '? unclear',       color: '#6b7280', hint: "Can't tell" },
  ],
  'gallery-quality': [
    { key: 'h', rating: 'hero',    label: '★ hero',    color: '#a855f7', hint: 'Iconic — could be the book\'s cover image' },
    { key: 'k', rating: 'yes',     label: '✓ yes',     color: '#10b981', hint: 'Belongs in the curated gallery' },
    { key: 'j', rating: 'no',      label: '✗ no',      color: '#ef4444', hint: 'Decorative / fragment / not gallery-worthy' },
    { key: 'u', rating: 'unclear', label: '? unclear', color: '#6b7280', hint: "Can't tell" },
  ],
  'scan-quality': [
    { key: 'p', rating: 'pristine',         label: '★ pristine',         color: '#a855f7', hint: 'Crisp color scan, sharp, no defects' },
    { key: 'k', rating: 'good',             label: '✓ good',             color: '#10b981', hint: 'Acceptable — minor age/discoloration' },
    { key: 'b', rating: 'bitonal',          label: '◐ bitonal',          color: '#3b82f6', hint: 'Black-and-white, but clean and readable' },
    { key: 'm', rating: 'microfilm',        label: '⚠ microfilm',        color: '#f59e0b', hint: 'Microfilm/microfiche, washed out, low contrast' },
    { key: 'j', rating: 'degraded',         label: '✗ degraded',         color: '#ef4444', hint: 'Blurry / cropped / corrupt — unusable' },
    { key: 'n', rating: 'blank',            label: '∅ blank',            color: '#6b7280', hint: 'Effectively blank page' },
    // Added 2026-09-01 because volunteers kept typing it. Of the three
    // qualitative notes this queue has ever received, all three said the same
    // thing — "This is not a page" — because every button above assumes the
    // image IS a page of the book and only asks how well it scanned. A rater
    // looking at a colour target or a ruler had no honest answer, so the
    // signal arrived as prose that nothing reads. If a queue's notes keep
    // repeating one sentence, that sentence is a missing option.
    { key: 'x', rating: 'not-a-page',       label: '⊘ not a page',       color: '#6366f1', hint: 'Colour chart, ruler, scanner furniture, box or shelf — not a page of the book' },
    { key: 'u', rating: 'unclear',          label: '? unclear',          color: '#9ca3af', hint: "Can't tell" },
  ],
  // UI copy, not book pages. The item is a translated interface string and the
  // question is whether the Spanish says what the English says and reads like a
  // person wrote it. No image, no page — see review-candidates.ts, which cares
  // only about `queue`.
  'spanish-copy': [
    { key: 'k', rating: 'natural',  label: '\u2713 natural',  color: '#10b981', hint: 'Correct, and reads like Spanish' },
    { key: 'a', rating: 'awkward',  label: '~ awkward',  color: '#f59e0b', hint: 'Understandable but stiff, or the wrong register' },
    { key: 'j', rating: 'wrong',    label: '\u2717 wrong',    color: '#ef4444', hint: 'Says something the English does not, or is a mistranslation' },
    { key: 'u', rating: 'unclear',  label: '? unclear',  color: '#6b7280', hint: "Can't tell without seeing where it appears" },
  ],
  // The generic queue: an item is a URL and a question, the answer is prose.
  // Adding a task type becomes inserting rows, not writing a component.
  //
  // The two verdict buttons are NOT decoration next to the note box. Collecting
  // only comments means you cannot tell "someone checked this and it was fine"
  // from "nobody has looked yet" — you hear about problems and never learn
  // coverage. One click is what makes the queue drain visibly.
  'page-check': [
    { key: 'k', rating: 'fine',    label: '\u2713 looks right', color: '#10b981', hint: 'I looked, nothing wrong' },
    { key: 'j', rating: 'problem', label: '\u2717 found something', color: '#ef4444', hint: 'Something is off \u2014 please say what in the box' },
    { key: 'u', rating: 'unclear', label: '? unclear', color: '#6b7280', hint: "Couldn't tell, or the page wouldn't load" },
  ],
  // Translation fidelity, judged by someone who reads the original language.
  //
  // THE VERDICTS SEPARATE TWO LAYERS ON PURPOSE. A page has to pass through
  // transcription before it can be translated, and the two fail differently:
  // where the OCR invented the original, the English can be perfectly faithful
  // TO THAT INVENTION and still tell the reader something the book never said.
  // One "is this translation any good?" button would fold those together and
  // the resulting number would be uninterpretable — we could not tell a
  // translation problem from an OCR problem, and they have different fixes.
  // This is the failure that produced 529 books of invented Tibetan scripture
  // (#4523): the translation layer did its job faithfully on a fabricated text.
  'translation-check': [
    { key: 'k', rating: 'both_sound',        label: '✓ both sound',           color: '#10b981', hint: 'The transcription matches the page, and the English matches the original' },
    { key: 'j', rating: 'translation_drift', label: '✗ translation drifts',   color: '#ef4444', hint: 'The transcription is right, but the English departs from it' },
    { key: 'x', rating: 'transcription_off', label: '✗ transcription wrong',  color: '#f59e0b', hint: "The text doesn't match the page — so the English can't be judged" },
    { key: 'b', rating: 'both_off',          label: '✗✗ both wrong',          color: '#b91c1c', hint: 'Neither the transcription nor the English can be trusted here' },
    { key: 'u', rating: 'unclear',           label: '? unclear',              color: '#6b7280', hint: "Can't tell — say why in the box if you can" },
  ],
  // Wikipedia contribution events. Not a rating queue — used as an event log
  // for the /contribute/wikipedia playbook (claim → post → response → merged).
  // No keyboard shortcuts; events come from explicit button clicks.
  wikipedia: [
    { key: '',  rating: 'claimed',    label: 'Claimed',    color: '#3b82f6', hint: "I'll post this one" },
    { key: '',  rating: 'released',   label: 'Released',   color: '#6b7280', hint: 'Giving up my claim — someone else take it' },
    { key: '',  rating: 'posted',     label: 'Posted',     color: '#10b981', hint: 'Posted on Wikipedia Talk page' },
    { key: '',  rating: 'responded',  label: 'Responded',  color: '#a855f7', hint: 'A Wikipedia editor responded to my post' },
    { key: '',  rating: 'merged',     label: 'Merged',     color: '#16a34a', hint: 'The article was actually updated' },
    { key: '',  rating: 'declined',   label: 'Declined',   color: '#ef4444', hint: 'A Wikipedia editor declined the suggestion' },
    { key: '',  rating: 'abandoned',  label: 'Abandoned',  color: '#9ca3af', hint: 'No response after a while; giving up' },
  ],
};

/**
 * A volunteer_id has TWO valid shapes: the signed-in account id (NextAuth
 * MongoDBAdapter ObjectId string — 24 hex chars, what useReviewQueue sends
 * since ratings became account-attributed) or the anonymous per-browser uuid
 * (36 chars, the signed-out fallback). The submit route validated only the
 * uuid shape, so every signed-in submission 400'd — zero ratings landed
 * between 2026-08-05 and 2026-08-19 while volunteers saw "Submit failed".
 * Every route that checks a volunteer_id must use this, not its own regex.
 */
export function isValidVolunteerId(id: string): boolean {
  return (
    /^[0-9a-fA-F]{24}$/.test(id) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

export function isValidRating(queue: string, rating: string): boolean {
  return QUEUE_RATINGS[queue]?.some(r => r.rating === rating) ?? false;
}

export function getRatingOptions(queue: string): RatingOption[] {
  return QUEUE_RATINGS[queue] ?? [];
}

export const QUEUE_KEYS = ['hallucination', 'gallery-quality', 'scan-quality', 'spanish-copy', 'page-check', 'translation-check', 'wikipedia'] as const;
export type QueueKey = (typeof QUEUE_KEYS)[number];

// Wikipedia event ordering: defines what's a "later" status. Used to roll up
// per-item state from the event log.
export const WIKIPEDIA_EVENT_ORDER: Record<string, number> = {
  claimed: 1,
  released: 0,    // a release wipes the claim
  posted: 2,
  responded: 3,
  declined: 4,    // terminal-but-negative
  merged: 5,      // terminal-and-positive
  abandoned: 4,   // terminal-but-incomplete
};
