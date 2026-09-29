// PRIOR ART: scripts/lib/source-column.mjs — splits `ocr.data` on the OCR prompt's own
// `<column-break/>`, the self-closing marker this one is modelled on; it reads columns and never
// writes a marker. scripts/split-book.mjs — splits stored text on `<page-break/>` into SEPARATE page
// documents (the inverse of keeping two leaves on one page). scripts/lib/page-break-devices.mjs —
// resolves the devices BETWEEN pages; a leaf seam sits INSIDE a page and needs no join or catchword
// logic, only a boundary the translator and the reader can see. scripts/lib/block-drift.mjs and
// scripts/lib/page-integrity.mjs — the drift and echo detectors; imported here and run per leaf,
// not rewritten.
/**
 * leaf-break — the seam between two leaves that share one served page (#5260).
 *
 * The EAP two-leaf captures of the Tibetan cohort (#4523) photograph two pecha leaves per frame,
 * and both carry a recto folio label in the margin: the frame holds two CONSECUTIVE RECTOS, the
 * verso between them lies on another frame. The per-leaf Yigdzin read concatenates the leaves
 * upper-then-lower, so `pages.ocr.data` is two text halves that are not continuous. The 2026-09-29
 * translation pilot found the translator bridging that seam: every invention (3 of 5 pages) and
 * omission (2 of 5) sat at a leaf seam or a page end.
 *
 * The fix is a marker the machinery already understands the shape of:
 *
 *   <leaf-break/>   self-closing, on its own line, between the leaves — the same form as the OCR
 *                   prompt's `<column-break/>` (rendered by NotesRenderer, dropped by the exports,
 *                   masked by every generic tag strip).
 *
 * Three consumers, one module:
 *   - the BACKFILL (scripts/maintenance/backfill-leaf-break-markers.mjs) and the apply writer
 *     insert it from the per-leaf ledger's line counts (`insertLeafBreaks`) — CPU only;
 *   - the TRANSLATOR (translate-core resolvePageBreakForPage / buildBlockTranslationPrompt) is told
 *     the leaves are separate units and must return the marker between them (`leafBreakNote`);
 *   - the WRITE GATE (translate-core assessTranslationHealth) refuses a translation whose marker
 *     count differs from its source's — a bridged seam has no marker to come back — and runs the
 *     echo and drift guards PER LEAF (`leafUnitsHealth`), since a whole-page share hides a
 *     half-page defect.
 *
 * Nothing here is Tibetan-specific: any page whose text holds `<leaf-break/>` gets the treatment,
 * and a page without it is untouched byte for byte (the negative controls in
 * tests/unit/translate-leaf-break.test.ts pin that).
 */
import { echoedSource } from './page-integrity.mjs';
import { blockDriftBoundaries } from './block-drift.mjs';

/** The marker as written. Matching tolerates `<leaf-break />` and `<leaf-break>` from a model. */
export const LEAF_BREAK = '<leaf-break/>';
export const LEAF_BREAK_RE = /<leaf-break\s*\/?>/gi;

/** How many seams a text carries. */
export function countLeafBreaks(text) {
  return (String(text || '').match(LEAF_BREAK_RE) || []).length;
}

/** The text split at its seams: one string per leaf, trimmed. A text without a seam is one unit. */
export function splitLeafUnits(text) {
  return String(text || '').split(LEAF_BREAK_RE).map((s) => s.trim());
}

/**
 * Does a translation carry the same seams as its source? A translator that bridged the seam
 * returns one block; one that dropped a leaf returns fewer; one that invented a seam returns more.
 * Only equality passes. A source with no seam is trivially preserved.
 */
export function leafSeamsPreserved(ocrText, translationText) {
  const ocr = countLeafBreaks(ocrText);
  const tr = countLeafBreaks(translationText);
  return { ok: ocr === tr, ocr, tr };
}

/**
 * The #5176 guards, per leaf (#5260 item 4). `echo` — the leaf's translation is its source
 * verbatim (page-integrity echoedSource, whole-unit share) — needs the book's `lang` like the
 * page-level tier and is skipped without it. `leaf-drift` — the translation of leaf k absorbed
 * the opening clause of leaf k+1 (block-drift detectBlockDrift, with the leaves standing in for
 * consecutive pages). Returns { healthy, reason, unit } with `unit` the 0-based leaf that failed.
 * A text with no seam returns healthy: the page-level gate already judged it.
 */
export function leafUnitsHealth(ocrText, translationText, { lang } = {}) {
  const src = splitLeafUnits(ocrText);
  if (src.length < 2) return { healthy: true, reason: null, unit: null };
  const tr = splitLeafUnits(translationText);
  if (tr.length !== src.length) return { healthy: false, reason: 'leaf-seam', unit: null };
  if (lang) {
    for (let i = 0; i < src.length; i++) {
      const e = echoedSource({ ocr: src[i], tr: tr[i], lang });
      if (e.judged && e.wholePage) return { healthy: false, reason: 'echo', unit: i };
    }
  }
  // The leaves as a block of consecutive "pages": a clause moved across a seam is a drift.
  const pages = src.map((data, i) => ({ page_number: i + 1, ocr: { data } }));
  const map = new Map(tr.map((t, i) => [i + 1, t]));
  const drifted = blockDriftBoundaries(pages, map);
  if (drifted.length) return { healthy: false, reason: 'leaf-drift', unit: drifted[0].prev - 1, drift: drifted[0] };
  return { healthy: true, reason: null, unit: null };
}

/**
 * Remove from a parsed block every page whose translation does not carry its source's seams, so
 * the caller's "missing from batch" path re-translates it single-page (where the retry and the
 * write gate apply). Mutates and returns `translations`, like block-drift dropDriftedPages.
 */
export function dropLeafSeamBreaches(pages, translations) {
  const breached = [];
  for (const p of pages) {
    const tr = translations.get(p.page_number);
    if (tr == null) continue;
    const ocr = typeof p.ocr === 'string' ? p.ocr : p.ocr?.data;
    const r = leafSeamsPreserved(ocr, tr);
    if (!r.ok) { translations.delete(p.page_number); breached.push({ page: p.page_number, ...r }); }
  }
  return { translations, breached };
}

/**
 * The prompt note for a page with `n` seams — the leaves are units, the marker comes back.
 * Deliberately says nothing about which leaf follows which: on the EAP frames the two are
 * consecutive rectos, but the note only has to stop the translator carrying a sentence across.
 */
export function leafBreakNote(n) {
  const leaves = n + 1;
  return `This page holds ${leaves} separate leaves of the manuscript, divided by the marker <leaf-break/>. The leaves are separate units of text and are not continuous with one another: the text before a marker ends where its leaf ends, and the text after it begins another leaf. Translate each leaf on its own, in order, and write the marker <leaf-break/> on its own line between the translated leaves, exactly ${n} time${n === 1 ? '' : 's'}. Never carry a sentence across the marker, never complete a sentence that a leaf cuts off, and never move words from one leaf into another.`;
}

/**
 * Split `served` (the text on the page, or about to be written) at the seams the per-leaf ledger
 * records, and return it with `<leaf-break/>` between the leaves.
 *
 * `leafLines` is the ledger's line count per leaf of the RAW leaf read (`raw`); the served text
 * may have fewer lines than the raw read because the acceptance rule stripped non-Tibetan filler
 * lines (leaf_v4, 2026-09-28), so the seam is mapped line by line: served lines are a subsequence
 * of raw lines, and the seam falls after the last served line that came from the earlier leaf.
 * Pure. Returns { text, seams } with `seams` the 0-based served-line indices a marker precedes,
 * or { text: null, reason } when the seam cannot be placed:
 *
 *   single-leaf         one leaf: nothing to mark
 *   already-marked      the served text carries the marker
 *   ledger-mismatch     raw line count ≠ Σ leafLines: the ledger does not describe this read
 *   unalignable         a served line is not in the raw read (the text was edited since)
 *   leaf-empty          every line of a leaf was stripped: the marker would open or close the
 *                       page, and a seam at the edge marks nothing
 */
export function insertLeafBreaks({ served, raw, leafLines }) {
  if (!Array.isArray(leafLines) || leafLines.length < 2) return { text: null, reason: 'single-leaf' };
  if (countLeafBreaks(served)) return { text: null, reason: 'already-marked' };
  const rawLines = splitLines(raw);
  const total = leafLines.reduce((n, k) => n + k, 0);
  if (rawLines.length !== total) return { text: null, reason: 'ledger-mismatch', rawLines: rawLines.length, ledgerLines: total };
  const servedLines = splitLines(served);
  // Which leaf each raw line belongs to.
  const leafOfRaw = [];
  leafLines.forEach((k, leaf) => { for (let i = 0; i < k; i++) leafOfRaw.push(leaf); });
  // Walk the served lines through the raw lines (a subsequence match, exact after trimming).
  const leafOfServed = [];
  let j = 0;
  for (const line of servedLines) {
    const want = line.trim();
    while (j < rawLines.length && rawLines[j].trim() !== want) j++;
    if (j >= rawLines.length) return { text: null, reason: 'unalignable', line: servedLines.indexOf(line) };
    leafOfServed.push(leafOfRaw[j]);
    j++;
  }
  const seams = [];
  for (let i = 1; i < leafOfServed.length; i++) if (leafOfServed[i] !== leafOfServed[i - 1]) seams.push(i);
  // Every leaf must keep at least one served line, else the seam sits at an edge.
  const present = new Set(leafOfServed);
  if (present.size !== leafLines.length) return { text: null, reason: 'leaf-empty', leaves: leafLines.length, present: present.size };
  const out = [];
  servedLines.forEach((line, i) => { if (seams.includes(i)) out.push(LEAF_BREAK); out.push(line); });
  return { text: out.join('\n'), seams };
}

/** Lines of a text, a trailing newline not counted as an empty line. */
function splitLines(text) {
  const s = String(text || '');
  if (!s) return [];
  return s.replace(/\n$/, '').split('\n');
}

/**
 * Write-time tag check for a lane whose text carries NO model tags (#5130 item 4, narrowed to
 * what this lane can assert): the only tag allowed in the text is the marker. Returns the
 * offending tags, empty when clean.
 */
export function foreignTags(text) {
  const tags = String(text || '').match(/<\/?[a-zA-Z][^<>]*>/g) || [];
  return tags.filter((t) => !/^<leaf-break\s*\/?>$/i.test(t));
}
