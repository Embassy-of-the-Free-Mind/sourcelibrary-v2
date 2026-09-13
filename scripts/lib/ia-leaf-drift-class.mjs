// PRIOR ART: this was `classOf()` inline in scripts/maintenance/repair-ia-ocr-leaf-offset.mjs
// (2026-09-13); it moved here so the pipeline hold (hold-pipeline-books.mjs) and the drift audit
// read the SAME class from a joined row instead of each re-deriving it. scripts/audit/ia-ocr-leaf-drift.mjs
// produces the rows and does not classify them; nothing else reads `cls`.
//
// The four classes of an IA-OCR book after the leaf-offset finding (#4790), from one joined row of
// scripts/audit/ia-ocr-leaf-drift.mjs:
//
//   A   text written at a non-zero offset, images ALIGNED with IIIF → the reader sees the wrong
//       text NOW; repaired by repair-ia-ocr-leaf-offset.mjs (39 books, 2026-09-13).
//   C   text at a non-zero offset AND images #3368-shifted the same way (or the image side cannot
//       be classified) → text and image agree on screen, but both point at the neighbouring
//       leaf. Re-pointing the text alone would make the error visible, so the book waits for the
//       image repair; until then it is HELD out of the derived lane (translation, chapters, index,
//       embeddings would all be built on a page mapping that the joint repair will move).
//   B   text at offset 0 (correct) but images SHIFTED → the image side's problem, not ours.
//   OK  offset 0 and images aligned — nothing to do.

export const LEAF_DRIFT_CLASSES = /** @type {const} */ (['A', 'B', 'C', 'OK']);

/** CLASS from a joined row: A = repair, C = hold (agree on screen / cannot classify), B = not ours, OK = nothing to do. */
export function leafDriftClass(r) {
  if (r.offset === 0) return r.cls?.includes('SHIFTED') ? 'B' : 'OK';
  if (r.cls?.includes('SHIFTED') || r.cls?.includes('ambiguous') || r.cls?.includes('no scandata')) return 'C';
  return 'A'; // iiif-archived, images ALIGNED, or no excluded leaf before the written pages
}

/** Bucket joined rows by class. */
export function bucketByLeafDriftClass(rows) {
  const by = { A: [], B: [], C: [], OK: [] };
  for (const r of rows) by[leafDriftClass(r)].push(r);
  return by;
}
