// PRIOR ART: scripts/batch/cli-ocr.mjs REFUSAL regex — OCR-specific (transcription headers, summaries); a translation
// has no <page-type> header to test, so the "is this a translation at all" check for CLI output lives here, pure.
/**
 * The CLI is an agent, not an endpoint: when it goes wrong it exits 0 with prose about what it is doing instead of
 * the translation. Returns a reason string when `text` reads like that, else null.
 */
// #6361: in plan mode `agy -p` often answers "Please review the implementation plan in [translation_plan.md](file:///
// root/.gemini/…)", sometimes followed by part of the page. 5,457 of 22,636 Tengyur replies were this; 174 of them
// passed the checks below and 125 also passed the write door. ANYWHERE: markers no translation of a source text
// carries (0 hits in 23,625 stored Tengyur pages). HEAD: requests for approval, which a letter can contain mid-text.
const PLAN_ANYWHERE = /file:\/\/\/|\.gemini\/|implementation plan|translation_plan|\bplan\.md\b|output contract/i;
const PLAN_HEAD = /please (?:review|confirm|approve)|once (?:you )?approv|the user(?:'s)? (?:prompt|request|instruction)|the prompt (?:says|asks|requires)|`?\/plan\b/i;

export function cliChatterReason(text) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  const head = t.slice(0, 300);
  if (/^(sure|okay|ok|certainly|of course|here(?:'s| is| are)|let me|i(?:'ll| will| need| am going| have| cannot| can't| am unable)|to translate|first,? i|now,? i|understood)\b/i.test(head)) return 'conversational opener';
  if (/\b(tool call|tool output|reading file|read_file|view_file|run_command|list_dir|shell command)\b/i.test(head)) return 'tool output';
  if (/\bI (cannot|can't|am unable to) (provide|translate|comply)|content (restrictions|policy)|safety filters/i.test(t)) return 'refusal';
  if (/^```/.test(t)) return 'code fence around the answer';
  if (PLAN_ANYWHERE.test(t) || PLAN_HEAD.test(head)) return 'plan-mode reply';
  return null;
}
