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

// #6523: the CLI's reply around a transcription, read by eye on the 93 failed Latin / Early English pages. These
// are the agent's own sentences; none is a line of a printed page (checked on every stored API read, which carry none).
const CHAT_START = /^\s*(?:(?:I apologi[sz]e|Unfortunately)[,.]|I (?:am|'m) (?:unable|not able)|I (?:cannot|can't|can not) (?:provide|reproduce|transcribe|output|generate|continue)|However, (?:I can|if you)|Would you like|If (?:you (?:need|would like|'d like)|helpful)|Since generating|Please (?:review|confirm|let me know)|Let me know|I have (?:prepared|created|written) (?:the |an |a )?(?:transcription|implementation|plan)|#{1,4} (?:Summary|Overview|Note)|\*\*(?:Summary|Overview|Note)\b)/i;
const CHAT_LEAD = /^\s*(?:(?:Here is|Here's|Below is) (?:the |a )?(?:full |exact |complete |diplomatic )*transcription\b.*|(?:Sure|Okay|Certainly)[,.!].*|```\w*)\s*$/i;
const LEAD_NOTE = /^\s*(?:I have|I've)\b.*\b(?:plan|artifact|transcri\w*|image|manuscript)\b/i;
const LEAD_PROSE = /^\s*(?:I have|I've|I will|I'll|Please|Let me|You can|Once (?:you|approved)|If you)\b|\b(?:plan|artifact|approve|proceed|file:\/\/)\b/i;
const PLAN_TAIL = /file:\/\/|please (?:review|confirm|approve)|let me know|once (?:you )?approv|ready to proceed|approve to proceed/i;
const BLOCK_SENTINEL = /<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/;
// #6523: the instruction that asks for the sentinels (the winning dev-round config; cli-ocr.mjs and run-cli-arm.py
// --kind ocr append it to the OCR prompt). Kept here so the writer, the eval runner and the extractor share one copy.
export const OCR_SENTINEL_INSTRUCTION = 'Write the transcription between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.';

/**
 * Split a reply into what is between the <<<BEGIN>>> / <<<END>>> markers and what is outside them. `inside` is null
 * when the reply has no BEGIN marker; `outside` is the non-whitespace text before BEGIN or after END (a writer treats
 * any as chatter); `closed` is false when END never came (a cut reply).
 */
export function unwrapSentinels(raw) {
  const t = String(raw || '');
  const b = t.search(/<<<\s*BEGIN\s*>>>/);
  if (b < 0) return { inside: null, outside: t.trim(), closed: false };
  const rest = t.slice(b).replace(/^<<<\s*BEGIN\s*>>>/, '');
  const e = rest.search(/<<<\s*END\s*>>>/);
  const inside = (e < 0 ? rest : rest.slice(0, e)).trim();
  const after = e < 0 ? '' : rest.slice(e).replace(/^<<<\s*END\s*>>>/, '');
  return { inside, outside: (t.slice(0, b) + after).trim(), closed: e >= 0 };
}

const letterCount = (s) => (stripMarkupTags(s).match(/\p{L}/gu) || []).length;

/**
 * The transcription inside a CLI reply, with the agent's wrapper removed (#6523). Steps, in order:
 *   1. a reply that uses the <<<BEGIN>>> … <<<END>>> sentinels gives the first such block (or the rest of the reply
 *      when END never came);
 *   2. leading chat ("Here is the transcription:", a plan note, a ``` fence) and every ``` fence line are dropped;
 *   3. the reply is cut at the first line of trailing chat (a refusal sentence, "Would you like…", a "### Summary");
 *   4. a restarted or doubled reply (a second <scan-quality> header, or the opening 60 letters of the body starting a
 *      later line) is split into its copies, and the copy with the most letters is kept.
 * Returns { text, changed, steps } — `steps` names what was removed, for the disclosure. A reply that is all chat
 * returns ''. Pure; the same function scores every engine's stored output (API arms included) for the Pareto charts.
 */
export function extractTranscription(raw) {
  const steps = [];
  let t = String(raw || '');
  const s = t.match(BLOCK_SENTINEL);
  if (s) { t = s[1]; steps.push('sentinels'); }
  let lines = t.split('\n');
  // leading chat: plan notes and "Here is…" lines before the first line of text
  // (a reply that OPENS with chat: then every following line of agent prose goes too, as rescore-plan-note.mjs does)
  let i = 0;
  while (i < lines.length && /^\s*$/.test(lines[i])) i++;
  if (i < lines.length && (CHAT_LEAD.test(lines[i]) || CHAT_START.test(lines[i]) || LEAD_NOTE.test(lines[i]))) {
    // The note can carry a bulleted "summary of findings"; it ends at its request for approval (a file:// link,
    // "please review", "let me know"), or where the prompt's header tags begin, whichever is later.
    const zone = lines.slice(i, i + 30);
    const ask = zone.reduce((last, l, k) => (PLAN_TAIL.test(l) ? k : last), -1);
    const tag = zone.findIndex((l) => /^\s*<scan-quality>/.test(l));
    if (ask >= 0 || tag >= 0) i += Math.max(ask + 1, tag);
    while (i < lines.length && (/^\s*$/.test(lines[i]) || CHAT_LEAD.test(lines[i]) || CHAT_START.test(lines[i]) || LEAD_NOTE.test(lines[i]) || LEAD_PROSE.test(lines[i]))) i++;
  }
  if (lines.slice(0, i).some((l) => l.trim())) steps.push('leading chat');
  lines = lines.slice(i);
  const fences = lines.filter((l) => /^\s*```\w*\s*$/.test(l)).length;
  if (fences) { lines = lines.filter((l) => !/^\s*```\w*\s*$/.test(l)); steps.push('code fences'); }
  const cut = lines.findIndex((l) => CHAT_START.test(l));
  if (cut >= 0) { lines = lines.slice(0, cut); steps.push('trailing chat'); }
  while (lines.length && /^\s*(?:\*{3,}|-{3,}|_{3,})?\s*$/.test(lines.at(-1))) { if (lines.at(-1).trim()) steps.push('trailing rule'); lines.pop(); }
  // restarts: split at a second header, or where the opening of the body starts again
  const starts = [0];
  const hdr = lines.findIndex((l) => /<scan-quality>/.test(l));
  if (hdr >= 0) for (let k = hdr + 1; k < lines.length; k++) if (/<scan-quality>/.test(lines[k])) starts.push(k);
  const fold = (x) => stripMarkupTags(x).replace(/[^\p{L}]+/gu, '').toLowerCase();
  const bodyStart = lines.findIndex((l) => fold(l).length >= 20 && !/^\s*</.test(l));
  if (starts.length === 1 && bodyStart >= 0) {
    const head = fold(lines.slice(bodyStart, bodyStart + 6).join('')).slice(0, 60);
    if (head.length >= 60) for (let k = bodyStart + 1; k < lines.length; k++) if (fold(lines.slice(k, k + 6).join('')).startsWith(head)) { starts.push(k); break; }
  }
  if (starts.length > 1) {
    const copies = starts.map((a, n) => lines.slice(a, starts[n + 1] ?? lines.length).join('\n'));
    let best = copies[0];
    for (const c of copies) if (letterCount(c) > letterCount(best)) best = c;
    lines = best.split('\n');
    steps.push(`restart (${copies.length} copies, kept the longest)`);
  }
  const text = lines.join('\n').trim();
  return { text, changed: text !== String(raw || '').trim(), steps };
}
