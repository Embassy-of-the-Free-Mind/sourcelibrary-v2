/**
 * PRIOR ART: scripts/eval/lib/sampling.mjs exports `sampleOnePagePerBook` / `samplePages` for
 * EVALUATION samples — random, seeded, one observation per book — which is the opposite need: this
 * picks a deterministic, evenly-spread set WITHIN one book so a median over it means something.
 * scripts/workers/pipeline-orchestrator.mjs held this inline for one commit; it moved here so it
 * can be tested without importing the orchestrator, which runs on import. Nothing else in
 * scripts/lib selects pages by position.
 *
 * interior-sample — N page numbers spread across the BODY of a book, skipping front and back matter.
 *
 * WHY. Everything else that samples pages here does `sort({page_number: 1}).limit(n)`, i.e. the
 * front of the book. That is right for Phase 1.5, whose output feeds metadata classification and
 * therefore WANTS the title page and contents. It is wrong for the free Internet Archive text
 * gate, which scores the Archive's reading against ours on a sample and then writes every
 * remaining page of the book on that verdict: title pages, prefaces and dot-leader contents are
 * where two OCR engines differ most on FORMATTING and least on prose. Measured on #5014, a book
 * scored 0.624 on its front matter — REJECTED at the 0.80 English gate — while its body text
 * agreed at 0.987.
 */

/** Share of a book treated as front matter, and as back matter (index, ads, colophon). */
export const FRONT_TRIM = 0.15;
export const BACK_TRIM = 0.05;

/**
 * @param {number[]} nums  candidate page numbers, ascending
 * @param {number}   n     how many to pick from the body
 * @param {number}   lead  how many pages to take from the FRONT as well (default 0)
 * @returns {number[]} up to `n` page numbers, ascending and distinct
 *
 * The trims are FRACTIONS, not page counts, because front matter is a larger share of a 40-page
 * pamphlet than of a 600-page treatise and no fixed count fits both.
 *
 * A book too short to trim is returned WHOLE rather than emptied. An empty array would reach the
 * caller as "no pages to OCR", which is indistinguishable from "this book is done" — the silent
 * skip shape. A short book should be sampled badly, not dropped silently.
 */
/**
 * WHY `lead` EXISTS, measured. Dropping the front entirely was a regression, not a saving. Today's
 * 25-page preview incidentally gives the front of every book OUR OCR; an interior-only sample
 * leaves those pages to the Archive's text, which must clear the ingester's >=20-token candidate
 * filter to be written at all. Measured 2026-09-24 on 330 real title pages (located by the
 * `page_type: 'title-page'` our own model assigned, not by position): only **50.6%** clear it,
 * median 20 tokens, p25 6. Half of all title pages would simply stay blank, including ones
 * carrying the actual title — "A VI SIT TO A GNANI Edward Carpenter" is 8 tokens.
 *
 * Two lead pages cost almost nothing and cannot distort the verdict: the gate takes a MEDIAN, and
 * a median over 10 values is unmoved by 2 unrepresentative ones. That robustness is the reason
 * this is safe to fold into the same sample rather than needing a second pass.
 */
export function interiorSpread(nums, n, lead = 0) {
  if (!Array.isArray(nums) || !nums.length || n <= 0) return [];
  if (nums.length <= n + lead) return [...nums];
  const front = lead > 0 ? nums.slice(0, lead) : [];
  const lo = Math.floor(nums.length * FRONT_TRIM);
  const hi = Math.ceil(nums.length * (1 - BACK_TRIM));
  const body = nums.slice(lo, hi);
  if (body.length <= n) return [...new Set([...front, ...(body.length ? body : nums)])];
  // Midpoint of each of n equal slices, so the picks sit inside the body rather than on its edges
  // and no two collapse onto the same page for any n < body.length.
  const step = body.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(body[Math.floor(i * step + step / 2)]);
  return [...new Set([...front, ...out])];
}
