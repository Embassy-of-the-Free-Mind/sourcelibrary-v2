/**
 * GET /api/cite?ref=Urk.%20I,%20124        → 302 to the reader on that leaf
 * GET /api/cite?ref=ARE%20I%20§335&format=json → the resolution as JSON
 *
 * Resolve a standard Egyptological citation to the scanned page in this
 * library's copy of the edition. An Egyptologist reading a TLA lemma page sees
 * "Urk. I, 124" with no link; pasted here, it lands them beside the transcription.
 *
 *   302  Location: https://sourcelibrary.org/book/<id>?page=<n>
 *        X-Cite-Basis: printed | frame | nearest  (see src/lib/cite-egypt.ts)
 *   400  the ref could not be read as a citation (or is missing)
 *   404  the citation parsed but the volume is not held, or the page/§ is
 *        outside what was read from it — the body says which
 *
 * No auth; rate-limited like every public route (withApiAuth: anon 60/hr,
 * verified bots and keys exempt). No database: the concordances are static
 * files built from each leaf's `<page-num>` by
 * scripts/maintenance/build-cite-concordance.mjs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withApiAuth } from '@/lib/api-auth';
import { heldEditions, parseCite, resolveCite } from '@/lib/cite-egypt';

const FORMS = ['Urk. I, 124', 'Urk. I 120–131', 'Urk I 124,3', 'ARE I §335', 'Breasted I §333–336', 'ARE 1, 153', 'Wb 1, 81.8'];

export const GET = withApiAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const ref = (searchParams.get('ref') || searchParams.get('q') || '').trim();
  const wantJson = searchParams.get('format') === 'json'
    || (request.headers.get('accept') || '').split(',')[0].trim() === 'application/json';

  if (!ref) {
    return NextResponse.json(
      { error: 'ref is required', forms: FORMS, held: heldEditions() },
      { status: 400 },
    );
  }

  const cite = parseCite(ref);
  if (!cite) {
    return NextResponse.json(
      { error: `could not read "${ref}" as an Egyptological citation`, forms: FORMS },
      { status: 400 },
    );
  }

  const res = resolveCite(cite);

  if (res.status === 'not-held') {
    return NextResponse.json(
      {
        error: `${res.edition_label} volume ${cite.volume} is not held`,
        citation: cite.label,
        held: heldEditions(),
      },
      { status: 404 },
    );
  }

  if (res.status === 'not-found') {
    return NextResponse.json(
      { error: res.reason, citation: cite.label, edition: res.edition_label, held: heldEditions() },
      { status: 404 },
    );
  }

  const note = res.basis === 'nearest'
    ? 'No leaf carries this number; this is the nearest leaf before it — read forward a page.'
    : res.basis === 'frame'
      ? 'This leaf sits between two printed neighbours agreeing on the offset; its own number was not read.'
      : 'The number was read off this leaf.';

  if (wantJson) {
    return NextResponse.json(
      {
        citation: cite.label,
        edition: res.edition_label,
        book_id: res.book_id,
        page: res.page,
        basis: res.basis,
        url: res.url,
        note,
        ...(cite.sub != null ? { sub: cite.sub, sub_note: 'Line/entry numbers are not resolved; the leaf is.' } : {}),
        ...(cite.end != null ? { range_end: cite.end, range_note: 'A range resolves to its first leaf.' } : {}),
      },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' } },
    );
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: res.url,
      'X-Cite-Basis': res.basis,
      'X-Cite-Page': String(res.page),
      'Cache-Control': 'public, max-age=0, s-maxage=86400',
    },
  });
}, { route: 'cite' });
