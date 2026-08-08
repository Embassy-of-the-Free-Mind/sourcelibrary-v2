/**
 * GET /work/republic/at/328b — a citable canonical-reference URL.
 *
 * Resolves a Bekker/Stephanus reference against `locus_anchors` and 307s to the
 * leaf that carries it (via /book/[id]/page-number/[num], which finds the exact
 * reader page). Only canon works with a `locus` config resolve here; everything
 * else bounces to the work page. A miss bounces back with ?locus_miss=<ref> so
 * the jump box can explain, because "we hold no anchor there" must never look
 * like a dead link.
 *
 * Same discipline as /api/locus (#3661): a witness is a leaf on which the
 * reference was PRINTED (or frame-bracketed in a verified root edition) —
 * nothing interpolated. Matching is by page, never section: the leaf carrying
 * 328a–328c may be anchored "328 c" and is still the right leaf for 328b.
 * Work attribution accepts the boundary alternate (`work_header_alt`) because a
 * work's opening leaves often sit under the previous work's running head.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { canonWork } from '@/lib/canon-works';
import { parseLocusQuery, type LocusSystem } from '@/lib/locus';
import { findWorkByHead } from '@/lib/locus-works';

interface AnchorDoc {
  book_id: string;
  book_slug: string | null;
  system: LocusSystem;
  ref_label: string;
  page_number: number;
  basis: 'printed' | 'frame';
  work_header: string | null;
  work_header_alt: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ref: string }> }
) {
  const { id: rawId, ref: rawRef } = await params;
  const id = decodeURIComponent(rawId);
  const refStr = decodeURIComponent(rawRef);

  const canon = canonWork(id);
  const workUrl = new URL(`/work/${encodeURIComponent(id)}`, request.url);
  if (!canon?.locus) return NextResponse.redirect(workUrl, 307);

  const miss = () => {
    workUrl.searchParams.set('locus_miss', refStr);
    return NextResponse.redirect(workUrl, 307);
  };

  const parsed = parseLocusQuery(refStr);
  if (!parsed) return miss();

  const db = await getReadDb();
  const anchors = (await db
    .collection('locus_anchors')
    .find(
      { ref_page: parsed.ref.page, system: canon.locus.system },
      { projection: { _id: 0 } }
    )
    .sort({ ref_sort: 1 })
    .limit(200)
    .toArray()) as unknown as AnchorDoc[];

  const target = canon.locus.workSlug;
  const hits = anchors.filter((a) => {
    const w = findWorkByHead(a.work_header, a.system);
    const alt = findWorkByHead(a.work_header_alt, a.system);
    return w?.slug === target || alt?.slug === target;
  });
  if (hits.length === 0) return miss();

  // Root editions (the very books the numbering systems come from) outrank
  // margin editions; printed anchors outrank frame-bracketed ones.
  const rootBookIds = new Set(
    (await db
      .collection('locus_books')
      .find({ system: canon.locus.system, mechanism: 'pagination' }, { projection: { _id: 0, book_id: 1 } })
      .toArray()).map((b) => b.book_id as string)
  );
  const rank = (a: AnchorDoc) =>
    (rootBookIds.has(a.book_id) ? 0 : 2) + (a.basis === 'printed' ? 0 : 1);
  const witness = [...hits].sort((a, b) => rank(a) - rank(b))[0];

  return NextResponse.redirect(
    new URL(`/book/${witness.book_slug || witness.book_id}/page-number/${witness.page_number}`, request.url),
    307
  );
}
