/**
 * Where does a chapter END?
 *
 * `endPage` is a DERIVED field — nothing in the model output carries it. Each
 * entry runs until the next entry AT OR ABOVE its own level begins.
 *
 * The level check is the whole point. Every copy of this used to look at
 * `chapters[i + 1]` flatly, which is correct for a single-level list and wrong
 * for every nested one: a "Book I" heading is immediately followed by its own
 * "Chapter I", usually on the SAME page, so the book got
 * `endPage = pageNumber - 1` and every level-1 span came back inverted.
 *
 * Measured 2026-08-07: 29,037 such entries across 6,901 books, 6,045 of them
 * visible — essentially every multi-level book in the corpus. Reported from an
 * MCP session that found Book I of Taylor's Nicomachean Ethics spanning
 * pp. 12–11 (#3653 follow-up).
 *
 * A child is still bounded by the next sibling OR by the end of its parent,
 * whichever comes first; that falls out of "next entry at or above my level"
 * for free.
 *
 * TWIN: `src/lib/chapter-text.ts` exports the same function for the request
 * path. Both must change together — the four independent copies that existed
 * before are how one flat implementation stayed wrong in four places at once.
 *
 * Callers must pass chapters already sorted by pageNumber. Mutates in place
 * and returns the array.
 */
/**
 * How far does this entry's own MATERIALIZED TEXT run?
 *
 * This is deliberately NOT `endPage`. The two answer different questions:
 *
 *   endPage      — "where does Book I end?"   → p.57, children included.
 *                  What a reader, the API, and a range query want.
 *   chunkEndPage — "which pages are Book I's OWN text?" → p.12–11, i.e. the
 *                  preamble before Chapter I starts. Usually empty.
 *
 * `chapter_texts` is a RETRIEVAL store, so its rows must PARTITION the book.
 * If a container were chunked over its full span, "Book I" (pp. 12–57) would
 * be stored on top of its ten chapters — every page twice, and a RAG caller
 * handed the same passage under two labels.
 *
 * Keeping these separate is what lets `endPage` be fixed without touching a
 * single materialized row: a container's chunk range here is exactly what the
 * old flat rule produced, so `chapter_texts` output is unchanged.
 *
 * Entries are sorted by pageNumber, so a container is exactly an entry whose
 * immediate successor sits at a deeper level.
 *
 * TWIN: `chunkEndPage` in `src/lib/chapter-text.ts`.
 */
export function chunkEndPage(chapters, i, totalPages) {
  const next = chapters[i + 1];
  if (next && (next.level ?? 1) > (chapters[i].level ?? 1)) {
    return next.pageNumber - 1; // container: its own preamble only
  }
  return chapters[i].endPage ?? totalPages;
}

export function computeEndPages(chapters, totalPages) {
  for (let i = 0; i < chapters.length; i++) {
    const level = chapters[i].level ?? 1;
    let end = totalPages;
    for (let j = i + 1; j < chapters.length; j++) {
      if ((chapters[j].level ?? 1) <= level) {
        end = chapters[j].pageNumber - 1;
        break;
      }
    }
    // A heading whose successor starts on the same page would otherwise get an
    // inverted span. It is at minimum one page long — the page it opens on.
    chapters[i].endPage = Math.max(end, chapters[i].pageNumber);
  }
  return chapters;
}
