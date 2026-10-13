// PRIOR ART: scripts/lib/cli-chatter.mjs extractTranscription() (#6523, job cli-ocr-fix-6523c) — it CUTS a CLI reply
// deterministically; this module is the check that any cut (that extractor's, a second CLI pass's, or a hand cut on a
// production page) removed text and added none. src/lib/search-grounding.ts checks a quote against a page with fuzzy
// alignment, which is the wrong test here: a cut must be exact.
/**
 * The verbatim guard for rescued CLI output (#6523). A rescue may only CUT the agent's wrapper (chat before or after,
 * a plan note, a fence, a second copy of the same reply); it may never repair, reword or add. So the rescued span,
 * after whitespace normalisation, must be one contiguous substring of the raw reply. Keeping one copy of a doubled
 * reply passes by construction (the kept copy is a substring); stitching two pieces together does not. And since a
 * substring can still be a truncation, what was removed must be copies or chat (removedIsChat, below).
 */

/** Whitespace normalisation shared by both sides: every run of whitespace is one space, ends trimmed. */
export const normWs = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const letters = (s) => (String(s).match(/\p{L}/gu) || []).length;

export const VERBATIM_GUARD_VERSION = 'verbatim-cut/2';

// A line the agent wrote, not the page: an opener, a request, a refusal, a summary header, a filter warning, a fence.
const CHAT_LINE = /^\s*(?:I\b|I'm|I've|Here(?:'s| is| are)\b|Sure\b|Okay\b|OK\b|Certainly\b|Of course\b|Please\b|Would you\b|Let me\b|If you\b|However\b|Unfortunately\b|Note\b|Since\b|Below is\b|The (?:image|page|transcription|translation|text above)\b|This (?:page|image|request|transcription|translation)\b|This document (?:appears|is|seems)\b|Due to (?:automated|the automated|content|safety|copyright)\b|Let's (?:read|transcribe|look|start|go)\b|#{1,4} |\*\*[A-Z]|<warning>[^\n]*(?:filter|unable|verbatim|cannot)|```|-{3,}\s*$|\*{3,}\s*$)/i;
const HEADER_TAGS = new Set(['scan-quality', 'language', 'script', 'page-type', 'page-num', 'header', 'footer', 'meta', 'unclear', 'image-desc', 'catchword', 'signature', 'warning']);
const fold = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

/**
 * The second half of the guard (verbatim-cut/2): a substring can still be a TRUNCATION (the 2026-10-11 control: a
 * second pass kept the short first copy of a restarted read and passed the substring test). So what was removed
 * must be either a copy of text that was kept (a doubled or restarted reply) or a block of the agent's own: after the
 * span, its first line that is not a copy is a CHAT_LINE; before the span, its first or its last such line is.
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function removedIsChat(raw, cut) {
  const r = String(raw ?? ''), c = String(cut ?? '').trim();
  const at = r.indexOf(c.slice(0, Math.min(80, c.length)));
  // Locate the kept span in the raw by its first and last lines (whitespace may differ inside).
  const firstLine = c.split('\n').find((l) => l.trim()) || '';
  const lastLine = c.split('\n').reverse().find((l) => l.trim()) || '';
  const a = at >= 0 ? at : r.indexOf(firstLine.trim());
  const bEnd = r.lastIndexOf(lastLine.trim());
  if (a < 0 || bEnd < 0) return { ok: false, reason: 'cannot locate the kept span' };
  const head = r.slice(0, a), tail = r.slice(bEnd + lastLine.trim().length);
  // A copy need not be exact: each restart of a read differs a little (a catchword, a cut-off last word). A line is
  // a copy when 60% of its 8-letter shingles occur in the kept text, or when it is only a header tag the kept text
  // also carries (a restarted read repeats <scan-quality>, <language>, <meta>catchword…, each worded its own way).
  const kept = fold(c);
  const keptTags = new Set([...c.matchAll(/<([a-z][\w-]*)/gi)].map((m) => m[1].toLowerCase()));
  const isCopy = (line) => {
    const tagOnly = line.match(/^\s*<([a-z][\w-]*)[^>]*>[^<]*(?:<\/\1>)?\s*$/i);
    if (tagOnly && HEADER_TAGS.has(tagOnly[1].toLowerCase()) && keptTags.has(tagOnly[1].toLowerCase())) return true;
    const f = fold(line);
    if (f.length < 12 || kept.includes(f)) return true;
    let hit = 0, n = 0;
    for (let i = 0; i + 8 <= f.length; i += 4) { n++; if (kept.includes(f.slice(i, i + 8))) hit++; }
    return hit / n >= 0.6;
  };
  for (const [name, part] of [['before', head], ['after', tail]]) {
    const lines = part.split('\n').filter((l) => l.trim() && !isCopy(l));
    if (!lines.length) continue;
    // Before the span the block may also END with the agent's line ("…here is the translation:") after a separate
    // reply of its own (the Tengyur p261 shape); after the span it must open with one.
    if (!CHAT_LINE.test(lines[0]) && !(name === 'before' && CHAT_LINE.test(lines.at(-1)))) return { ok: false, reason: `text removed ${name} the span is neither a copy nor chat: ${JSON.stringify(lines[0].slice(0, 80))}` };
  }
  return { ok: true, reason: null };
}

/**
 * @param {string} raw  the stored reply, untouched
 * @param {string} cut  the proposed rescued text
 * @param {{ minLetters?: number }} [opts]  a cut with fewer letters than this is no rescue (default 20)
 * @returns {{ ok: boolean, reason: string|null, kept_share: number, start: number }}
 *   kept_share: rescued letters / raw letters; start: offset of the span in the normalised raw (−1 when absent)
 */
export function verbatimCut(raw, cut, { minLetters = 20 } = {}) {
  const r = normWs(raw), c = normWs(cut);
  const share = letters(r) ? +(letters(c) / letters(r)).toFixed(3) : 0;
  if (!c) return { ok: false, reason: 'empty cut', kept_share: 0, start: -1 };
  if (letters(c) < minLetters) return { ok: false, reason: 'too short', kept_share: share, start: -1 };
  const start = r.indexOf(c);
  if (start < 0) return { ok: false, reason: 'not a contiguous substring of the raw reply', kept_share: share, start };
  const removed = removedIsChat(raw, cut);
  if (!removed.ok) return { ok: false, reason: removed.reason, kept_share: share, start };
  return { ok: true, reason: null, kept_share: share, start };
}
