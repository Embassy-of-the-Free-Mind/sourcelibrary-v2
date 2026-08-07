/**
 * GET /api/locus?system=bekker&ref=1103b
 *
 * Resolve a canonical citation to every witness the library holds.
 *
 * Bekker and Stephanus numbers were fixed in 1831 and 1578 so a citation would
 * survive re-typesetting: `1103b` names the same words in every edition ever
 * printed. Until now this library could only be addressed by scan page, which
 * is a property of one copy and shareable with nobody — an MCP client verifying
 * Aristotle quotations had to reconstruct the mapping by hand and then guess
 * (#3653, #3661).
 *
 * Every row served here is a number a printer put on a page. Nothing is
 * interpolated: if no anchor was printed for the requested locus, the nearest
 * ones BELOW and ABOVE are returned and labelled as such, because "it is
 * between these two leaves" is true and "it is on this leaf" would not be.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { parseLocusQuery, formatLocus, isLocusSystem, LOCUS_SYSTEMS } from '@/lib/locus';

export const dynamic = 'force-dynamic';

interface AnchorDoc {
  system: string;
  page: number;
  section: string | null;
  locus: string;
  range_end_locus?: string;
  book_id: string;
  scan_page: number;
  book_title: string;
  author: string;
  published: string;
  language: string;
  edition_kind: string;
}

/** Sort key that treats a bare page as compatible with any section of it. */
const key = (page: number, section: string | null) =>
  page * 10 + (section ? section.charCodeAt(0) - 96 : 0);

function witness(a: AnchorDoc, exact: boolean) {
  return {
    book_id: a.book_id,
    title: a.book_title,
    author: a.author,
    language: a.language,
    published: a.published,
    page: a.scan_page,
    locus_on_page: a.locus,
    ...(a.range_end_locus ? { page_runs_to: a.range_end_locus } : {}),
    edition_kind: a.edition_kind,
    match: exact ? 'exact' : 'nearest',
    url: `https://sourcelibrary.org/book/${a.book_id}?page=${a.scan_page}`,
    quote_url: `https://sourcelibrary.org/api/books/${a.book_id}/quote?page=${a.scan_page}`,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const system = searchParams.get('system');
  const ref = searchParams.get('ref');

  if (!isLocusSystem(system)) {
    return NextResponse.json(
      { error: `Unknown system. Available: ${LOCUS_SYSTEMS.join(', ')}.` },
      { status: 400 },
    );
  }

  const parsed = parseLocusQuery(ref, system);
  if (!parsed) {
    return NextResponse.json(
      {
        error: `Could not read "${ref}" as a ${system} reference.`,
        recovery: 'Use a page number with an optional section letter, e.g. "1103b" or "509d". A line number may follow and is ignored.',
      },
      { status: 400 },
    );
  }

  const db = await getDb();
  const col = db.collection<AnchorDoc>('locus_anchors');
  const target = key(parsed.page, parsed.section);

  // Exact: same page, and same section when the caller named one. A caller
  // asking for "1103" wants any column of 1103; one asking for "1103b" wants b.
  const exactFilter: Record<string, unknown> = { system, page: parsed.page };
  if (parsed.section) {
    // Accept the bare-page anchor too — the printer set one number and the scan
    // may not have caught the column. Excluding it would report "not held" for
    // a leaf we can actually show.
    exactFilter.section = { $in: [parsed.section, null] };
  }

  const exact = await col.find(exactFilter).limit(50).toArray();

  // Books that could have answered but did not — so a caller can tell "we do
  // not hold this passage" from "we hold it and the anchor was not printed".
  const holders = await col.distinct('book_id', { system });
  const hit = new Set(exact.map((a) => a.book_id));

  // Bracket the requested locus per book: the last anchor at or below it and
  // the first at or above. A book only brackets the passage if it has BOTH —
  // one-sided means the locus falls outside the range that book covers, and
  // returning its final page as "nearest" would point a reader at the wrong
  // work entirely.
  const nearest: AnchorDoc[] = [];
  if (!exact.length) {
    for (const bookId of holders) {
      const [below] = await col
        .find({ system, book_id: bookId, page: { $lte: parsed.page } })
        .sort({ page: -1, section: -1 })
        .limit(1)
        .toArray();
      const [above] = await col
        .find({ system, book_id: bookId, page: { $gte: parsed.page } })
        .sort({ page: 1, section: 1 })
        .limit(1)
        .toArray();
      if (below && above) nearest.push(below, above);
    }
  }

  const witnesses = exact.length
    ? exact
        .sort((a, b) => Math.abs(key(a.page, a.section) - target) - Math.abs(key(b.page, b.section) - target))
        .map((a) => witness(a, true))
    : nearest.map((a) => witness(a, false));

  return NextResponse.json({
    system,
    reference: formatLocus(parsed.page, parsed.section),
    requested: ref,
    total: witnesses.length,
    exact: exact.length > 0,
    witnesses,
    coverage: {
      books_with_anchors: holders.length,
      books_answering: hit.size,
      note:
        'Anchors are read from the numbers printed on the page — no interpolation. Only editions that print canonical references carry them, so a locus absent here is not evidence the corpus lacks the passage; it means no anchor was printed on a leaf we hold.',
    },
    ...(exact.length
      ? {}
      : {
          caveat: `No anchor is printed for ${formatLocus(parsed.page, parsed.section)}. The witnesses above are the nearest anchors BELOW and ABOVE it, so the passage falls between them — read from there rather than citing these pages as the locus.`,
        }),
  });
}
