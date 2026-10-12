// PRIOR ART: scripts/eval/lib/refusals.mjs — an API refusal from the run meter's finishReason, but only when the
// output is EMPTY (a partial read cut by RECITATION counts as a read there), and it never reads the CLI's wording.
// scripts/lib/cli-chatter.mjs ocrReadProblem() — a writer's yes/no on a CLI reply's shape ("refusal or summary"
// covers a ### Summary after a good read too); neither names WHICH failure, and neither is shared by every engine.
/**
 * read-failure.mjs — did an engine actually read the page, and if not, how did the read fail? (#6523)
 *
 * Derek, 2026-10-11: "Count them but don't score them. We only want to know quality when it works." A read that
 * failed is not a 100% error and not a measurement of reading; it is a separate, counted outcome. Kinds:
 *   copy_filter  the model's recitation (copy) filter cut or blocked the read: an API finishReason RECITATION, the
 *                CLI's "blocked by Gemini's filters", or the agent's own words declining a verbatim copy. A partial
 *                read the filter cut mid-page is this kind, not a scored page.
 *   refusal      any other decline: a safety/prohibited finishReason, or a decline sentence with no copy reason
 *   empty        no text came back
 *   timeout      the call ran out of time (a CLI print timeout returns the partial reply with exit 0)
 *   other        text came back but no transcription in it: a plan note or chat only
 * A real misread (the page's own text, just wrong) is SCORED. So is a read the scorer could not place against the
 * reference: that is text the engine produced for the page (Tesseract's Armenian, an invented page written from
 * memory), and leaving it out would erase the worst misreads. It scores 100% error, as before. Deterministic and pure,
 * the same for every engine.
 */

export const READ_FAILURE_KINDS = ['copy_filter', 'refusal', 'empty', 'timeout', 'other'];

// Gemini finishReasons. RECITATION is the copy filter; the rest of refusals.mjs's set is any other decline.
const COPY_FINISH = /^RECITATION$/i;
const REFUSAL_FINISH = /^(PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|IMAGE_SAFETY|refusal)$/i;

// The wording 6523c catalogued on the CLI's 35 recitation cuts and 4 filter blocks (issue #6523, 2026-10-11): the
// agent declines in the first person, or the filter speaks in a <warning>. A decline sentence names a COPY reason
// (verbatim, recitation, copyright, a content filter, a published/protected text) → copy_filter; a decline with no
// such reason ("I cannot provide a direct transcription of this text. However, I can provide a summary") → refusal.
// Early printed books say "I cannot" too, so a decline needs a modern verb of output after it, and the sentence
// must name the transcription or the filter.
const DECLINE = /\b(?:I(?: am|'m) (?:unable|not able) to|I (?:cannot|can't|can not|could not)|unable to (?:output|provide|reproduce|transcribe))\s+(?:\w+\s+){0,2}?(?:provide|output|reproduce|transcribe|generate|continue|complete)\b|\bcannot be (?:fully )?(?:generated|transcribed|reproduced|output)\b|\bprevents? (?:me from )?(?:outputting|reproducing|generating|transcribing)\b|\b(?:generation|request|output) (?:was |is )?blocked\b/i;
const COPY_REASON = /\b(?:verbatim|recitation|copyright\w*|filter(?:s|ed|ing)?|protected (?:work|text|literary|material|textual)|published (?:work|text|historical)|resembl\w+|text[- ]matching)\b/i;
const FILTER_LINE = /This request was blocked by Gemini's filters|<warning>[^<]*\b(?:verbatim|recitation|copyright|filter)/i;
const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+|\n+/);

/** The sentence that declines a copy because of the filter, or null. */
export function copyFilterWording(text) {
  const t = String(text || '');
  const m = t.match(FILTER_LINE);
  if (m) return m[0].slice(0, 160);
  for (const s of sentences(t)) if (DECLINE.test(s) && COPY_REASON.test(s)) return s.trim().slice(0, 160);
  return null;
}

/** A decline sentence with no copy reason (an "other" refusal), or null. */
export function declineWording(text) {
  for (const s of sentences(text)) if (DECLINE.test(s) && /\b(?:transcri\w*|text|page|document|passage)\b/i.test(s)) return s.trim().slice(0, 160);
  return null;
}

const letters = (s) => (String(s || '').replace(/<[^>]*>/g, ' ').match(/[\p{L}\p{N}]/gu) || []).length;

/**
 * null when the read is scored, else { kind, why }. Every input is optional; pass what the run recorded:
 *   text          the reply as returned (null when not kept: then only the recorded signals below decide)
 *   extracted     the transcription the scorer reads, when the reply was unwrapped (extractTranscription)
 *   finishReason  the API's or the CLI meter's finishReason
 *   cli           the read came through the agent CLI, whose SAFETY means "blocked by Gemini's filters"
 *   blocked       the CLI runner saw the filter block
 *   error         the runner's error string (a timeout says so)
 *   refused       the scorer's refusal flag (refusals.mjs); refusalSource 'inferred' = an API page with no bytes
 *   contentChars  the scorer's count of content characters when no text is kept
 */
export function readFailure({ text = null, extracted = null, finishReason = null, cli = false, blocked = false, error = null,
  refused = false, refusalSource = null, contentChars = null } = {}) {
  const fr = finishReason || '';
  if (COPY_FINISH.test(fr)) return { kind: 'copy_filter', why: `finishReason ${fr}` };
  if (blocked || (cli && /^SAFETY$/i.test(fr))) return { kind: 'copy_filter', why: "CLI: blocked by Gemini's filters" };
  const said = text != null ? copyFilterWording(text) : null;
  if (said) return { kind: 'copy_filter', why: said };
  if (/timeout|timed out/i.test(error || '')) return { kind: 'timeout', why: String(error).slice(0, 120) };
  const body = extracted ?? text;
  const noText = body != null ? letters(body) < 5 : (contentChars != null && contentChars < 5);
  if (refused && refusalSource === 'inferred') return { kind: 'empty', why: 'no bytes returned (refusal inferred)' };
  if (REFUSAL_FINISH.test(fr) || refused) return { kind: 'refusal', why: fr ? `finishReason ${fr}` : 'refused' };
  const declined = text != null ? declineWording(text) : null;
  if (declined) return { kind: 'refusal', why: declined };
  if (noText) {
    if (text != null && letters(text) >= 5) return { kind: 'other', why: 'chat or a plan note only, no transcription' };
    return { kind: 'empty', why: error ? String(error).slice(0, 120) : 'no text' };
  }
  return null;
}
