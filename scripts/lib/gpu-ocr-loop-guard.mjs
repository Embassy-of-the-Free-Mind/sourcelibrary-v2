/**
 * PRIOR ART: scripts/lib/ocr-loop-guard.mjs (#4850) — the write-time loop guard every OCR writer runs. It refuses a
 * page only when ONE repeating run covers half the body, by design: it guards Gemini reads of whole pages, where the
 * loop is the page. It is reused here unchanged (its verdict is the first check). It does not fit alone because an
 * open GPU engine fails differently: it reads most of the page correctly and THEN runs away to its token cap, so the
 * loop is the TAIL of an otherwise good read (#5660 by-eye 3: olmOCR read entries 3–4 of a bibliography, then looped on
 * leader dots to the cap and lost entries 6–11). The run covers well under half the body, and the leader-dot collapse
 * that keeps index pages safe in ocr-loop-guard hides it. scripts/lib/first-ocr-guard.mjs (Yigdzin first reads) judges
 * texture and blankness, not repetition.
 *
 * gpu-ocr-loop-guard — is an open GPU engine's page read a runaway? (#6871, 1800+ European print)
 *
 * Refuses on positive evidence only, and on any ONE of:
 *   1. token_cap        the engine stopped on its length cap (`finish === 'length'`). A print page that needs 4,500+
 *                       tokens is rare; a cap hit is a loop or a table run wild far more often than a real page
 *                       (#5660: 42 capped pages, 36 Greek, none a clean read).
 *   2. repetition_loop  ocr-loop-guard's own verdict (one run over half the body).
 *   3. tail_runaway     an exact periodic run of ≥ TAIL_MIN_CHARS code points and ≥ TAIL_MIN_REPS repeats that ends
 *                       within TAIL_SLACK code points of the end of the text. Leader runs are NOT collapsed here: a
 *                       real index line ends with its page number, so its dots never reach the end of the page.
 *   4. repeated_lines   the same line (≥ LINE_MIN_LETTERS letters) LINE_MIN_REPS or more times in a row. Ditto marks,
 *                       "do." and short table cells have too few letters to count; a refrain varies or is separated.
 * A refused page is not written: the caller keeps what the page has (the lite draft, or nothing).
 * Kill switch: OCR_LOOP_GUARD=off (shared with ocr-loop-guard).
 */
import { loopVerdict, periodicRuns, guardEnabled } from './ocr-loop-guard.mjs';

export const TAIL_MIN_CHARS = 150;
export const TAIL_MIN_REPS = 8;
export const TAIL_SLACK = 24;
export const LINE_MIN_LETTERS = 12;
export const LINE_MIN_REPS = 4;

/** The text with markup and engine wrappers taken out, lines kept. */
export function plainLines(text) {
  let t = String(text || '');
  t = t.replace(/^---\n(?:[A-Za-z_]+:.*\n)+---\n/, '');            // olmOCR front matter (key: value lines only;
  //                                                                  LightOnOCR opens with a bare --- rule)
  t = t.replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '');            // CHURRO
  t = t.replace(/<(scan-quality|language|script|page-type|vocab|warning|note|meta|image-desc)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|Line|Paragraph)>/gi, '\n').replace(/<[^>\n]{1,200}>/g, ' ');
  return t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const letterCount = (s) => (s.match(/\p{L}/gu) || []).length;

/** The longest block of identical consecutive lines that carry enough letters to be text, or null. */
export function repeatedLines(lines, minLetters = LINE_MIN_LETTERS) {
  let best = null;
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    if (j - i > 1 && letterCount(lines[i]) >= minLetters && (!best || j - i > best.reps)) best = { line: lines[i], reps: j - i, at: i };
    i = j;
  }
  return best;
}

/** The periodic run that reaches the end of the text, if it is long enough to be a runaway. */
export function tailRun(lines, { minChars = TAIL_MIN_CHARS, minReps = TAIL_MIN_REPS, slack = TAIL_SLACK } = {}) {
  const cp = [...lines.join(' ')];
  if (cp.length < minChars) return null;
  const from = Math.max(0, cp.length - 4 * minChars - 2000);       // a runaway is at the end: scan the end only
  const tail = cp.slice(from);
  // periodicRuns ignores a unit with no letter or digit; a leader-dot runaway has none, so test that unit apart
  const runs = periodicRuns(tail).filter((r) => r.chars >= minChars && r.reps >= minReps && tail.length - (r.at + r.chars) <= slack);
  if (runs.length) return { ...runs[0], at: runs[0].at + from };
  const m = tail.join('').match(/([.·…\-—_*=~+ ]{1,4})\1{7,}\s*$/u);
  if (m && [...m[0]].length >= minChars) return { period: [...m[1]].length, chars: [...m[0]].length, reps: Math.floor([...m[0]].length / [...m[1]].length), unit: m[1] };
  return null;
}

/**
 * Verdict on one GPU engine read. `finish` is the engine's finish reason when known ('length' = hit the cap).
 * Returns { refuse, reason, detail }.
 */
export function gpuLoopVerdict(text, { finish = null } = {}) {
  if (!guardEnabled()) return { refuse: false, reason: 'guard_disabled' };
  if (finish === 'length') return { refuse: true, reason: 'token_cap' };
  const lv = loopVerdict(text);
  if (lv.refuse) return { refuse: true, reason: 'repetition_loop', detail: { share: lv.share, period: lv.period, reps: lv.reps } };
  const lines = plainLines(text);
  const tr = tailRun(lines);
  if (tr) return { refuse: true, reason: 'tail_runaway', detail: { period: tr.period, reps: tr.reps, chars: tr.chars, unit: tr.unit } };
  const rl = repeatedLines(lines);
  if (rl && rl.reps >= LINE_MIN_REPS) return { refuse: true, reason: 'repeated_lines', detail: { reps: rl.reps, line: rl.line.slice(0, 80) } };
  return { refuse: false, reason: 'ok' };
}
