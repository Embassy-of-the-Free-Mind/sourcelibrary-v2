// PRIOR ART: scripts/batch/cli-ocr.mjs REFUSAL regex — OCR-specific (transcription headers, summaries); a translation
// has no <page-type> header to test, so the "is this a translation at all" check for CLI output lives here, pure.
/**
 * The CLI is an agent, not an endpoint: when it goes wrong it exits 0 with prose about what it is doing instead of
 * the translation. Returns a reason string when `text` reads like that, else null.
 */
export function cliChatterReason(text) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  const head = t.slice(0, 300);
  if (/^(sure|okay|ok|certainly|of course|here(?:'s| is| are)|let me|i(?:'ll| will| need| am going| have| cannot| can't| am unable)|to translate|first,? i|now,? i|understood)\b/i.test(head)) return 'conversational opener';
  if (/\b(tool call|tool output|reading file|read_file|view_file|run_command|list_dir|shell command)\b/i.test(head)) return 'tool output';
  if (/\bI (cannot|can't|am unable to) (provide|translate|comply)|content (restrictions|policy)|safety filters/i.test(t)) return 'refusal';
  if (/^```/.test(t)) return 'code fence around the answer';
  return null;
}

import { stripMarkupTags } from './strip-markup-tags.mjs';

// #6420: the same agent failures on an OCR reply, where the shape is stricter: a transcription in the OCR prompt's
// format opens with its tags and carries exactly one <page-type>. Plan-mode markers are the #6361 ones (no page of a
// printed book carries a file:/// link to the CLI's own brain folder); the refusal/summary regex is cli-ocr.mjs's.
const OCR_PLAN = /file:\/\/\/|\.gemini\/|implementation plan|\bplan\.md\b|output contract|please (?:review|confirm|approve) the|once (?:you )?approv/i;
const OCR_REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text|This request was blocked by Gemini's filters/im;

/**
 * Why an OCR reply from the CLI is not a transcription of the page, or null. Reasons: empty, plan-mode reply,
 * refusal or summary, no <page-type> tag, restarted read (two headers), duplicated reply (the same long block twice),
 * conversational opener before the tags.
 */
export function ocrReadProblem(text) {
  const t = String(text || '').trim();
  if (t.length < 5) return 'empty';
  if (OCR_PLAN.test(t)) return 'plan-mode reply';
  if (OCR_REFUSAL.test(t)) return 'refusal or summary';
  const headers = (t.match(/<page-type>/g) || []).length;
  if (headers === 0) return 'no <page-type> tag';
  if (headers > 1 || (t.match(/<scan-quality>/g) || []).length > 1) return 'restarted read';
  const head = t.slice(0, t.indexOf('<')).trim();
  if (head.length > 0 && /^(sure|okay|ok|certainly|of course|here(?:'s| is| are)|let me|i(?:'ll| will| need| am| have)|i'm|understood|the image|this (?:page|image))\b/i.test(head)) return 'conversational opener';
  // A reply that repeats itself: the second half restates a long stretch of the first (a resent answer, not a page
  // whose running head recurs). 200 chars is far above any running head or catchword.
  const body = stripMarkupTags(t).replace(/\s+/g, ' ');
  if (body.length >= 800) {
    const probe = body.slice(Math.floor(body.length * 0.55), Math.floor(body.length * 0.55) + 200);
    if (body.indexOf(probe) < Math.floor(body.length * 0.55) - 100) return 'duplicated reply';
  }
  return null;
}
