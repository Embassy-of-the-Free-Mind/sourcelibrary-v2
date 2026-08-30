/**
 * GET /api/locus?ref=1094a8
 * GET /api/locus?work=Republic&ref=328b
 * GET /api/locus?system=bekker&ref=1447
 *
 * Resolve a canonical reference — a Bekker number for Aristotle, a Stephanus
 * number for Plato — to every leaf in the library that carries it (#3661).
 *
 * ## Why this route exists
 *
 * A scan page is a property of one copy and shareable with nobody. Bekker and
 * Stephanus numbers were agreed centuries ago so that a citation survives
 * re-typesetting, and they are how the field actually addresses these texts. An
 * agent verifying attributed Aristotle quotes through MCP had to rebuild the
 * mapping by hand and then guess which leaf held 1094 (#3653 item 2).
 *
 * ## What it will and will not answer
 *
 * Every witness returned is a leaf on which the reference was **printed** (or, in
 * a root edition with a verified constant offset, a leaf bracketed exactly by two
 * printed neighbours — reported as `basis: "frame"`). There is no interpolation:
 * a reference we hold no anchor for returns no witness, and the response says
 * which editions were searched so "not found" can be told from "not covered".
 *
 * A Stephanus number without a work is genuinely ambiguous — it restarts in each
 * of the three 1578 volumes — so the response lists the candidate works rather
 * than picking one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { withApiAuth } from '@/lib/api-auth';
import { parseLocusQuery, type LocusSystem } from '@/lib/locus';
import { findWorkByName, findWorkByHead } from '@/lib/locus-works';

interface AnchorDoc {
  book_id: string;
  book_slug: string | null;
  system: LocusSystem;
  ref_page: number;
  ref_section: string | null;
  ref_label: string;
  page_number: number;
  basis: 'printed' | 'frame';
  work_header: string | null;
  work_header_alt: string | null;
}

export const GET = withApiAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const refParam = (searchParams.get('ref') || searchParams.get('locus') || '').trim();
  const workParam = (searchParams.get('work') || '').trim();
  const systemParam = (searchParams.get('system') || '').trim().toLowerCase();

  if (!refParam) {
    return NextResponse.json(
      { error: 'ref is required, e.g. ?ref=1094a8 or ?work=Republic&ref=328b' },
      { status: 400 },
    );
  }

  const parsed = parseLocusQuery(workParam ? `${workParam} ${refParam}` : refParam);
  if (!parsed) {
    return NextResponse.json(
      { error: `could not read "${refParam}" as a canonical reference. Expected forms: 1094a8, 1094a, Rep. 328b, Bekker 1447a.` },
      { status: 400 },
    );
  }

  let system: LocusSystem | null =
    systemParam === 'bekker' || systemParam === 'stephanus' ? systemParam : parsed.system;

  const workName = workParam || parsed.work;
  const work = workName ? findWorkByName(workName, system) : null;
  if (workName && !work) {
    return NextResponse.json(
      {
        error: `unknown work "${workName}"`,
        hint: 'Omit work to search by reference alone, or use a name as printed in the edition. Bekker numbers are unique across Aristotle and need no work.',
      },
      { status: 404 },
    );
  }
  if (work) system = work.system;

  const db = await getReadDb();

  // Which editions could answer at all. Reported on every response so an empty
  // result can be read correctly: "we hold no anchor there" is a different fact
  // from "the reference does not exist", and only this list distinguishes them.
  const editions = await db
    .collection('locus_books')
    .find(system ? { system } : {}, {
      projection: {
        _id: 0, book_id: 1, book_slug: 1, title: 1, author: 1, year: 1, language: 1,
        system: 1, label: 1, mechanism: 1, ref_min: 1, ref_max: 1,
        anchors_printed: 1, anchors_frame: 1,
      },
    })
    .toArray();

  // Matched on the PAGE only, never on the section.
  //
  // A leaf carries a whole Bekker page or a run of Stephanus sections, and the
  // anchor records whichever one the printer happened to put in the margin. The
  // Burnet leaf covering 328a–328c is anchored `328 c`; filtering on the
  // requested section `b` returned nothing for `Republic 328b` — a leaf we hold,
  // reported as absent. Each witness carries its own printed `reference` so the
  // caller can see what was actually on the leaf.
  const query: Record<string, unknown> = { ref_page: parsed.ref.page };
  if (system) query.system = system;

  const anchors = (await db
    .collection('locus_anchors')
    .find(query, { projection: { _id: 0 } })
    .sort({ system: 1, ref_sort: 1 })
    .limit(200)
    .toArray()) as unknown as AnchorDoc[];

  const bookById = new Map(editions.map((e) => [e.book_id as string, e]));

  const allAtRef = anchors
    .map((a) => {
      const ed = bookById.get(a.book_id);
      const w = findWorkByHead(a.work_header, a.system);
      const alt = findWorkByHead(a.work_header_alt, a.system);
      return {
        work_alt: alt ? { slug: alt.slug, label: alt.label } : null,
        book_id: a.book_id,
        title: (ed?.title as string) ?? null,
        author: (ed?.author as string) ?? null,
        year: (ed?.year as number) ?? null,
        language: (ed?.language as string) ?? null,
        edition: (ed?.label as string) ?? null,
        system: a.system,
        reference: a.ref_label,
        /** The scan page — what `/page-number/N` and get_quote both key on. */
        page: a.page_number,
        basis: a.basis,
        work: w ? { slug: w.slug, label: w.label } : null,
        /** The running head printed on that leaf. The evidence for `work`. */
        running_head: a.work_header,
        url: `https://sourcelibrary.org/book/${a.book_slug || a.book_id}/page-number/${a.page_number}`,
        quote_api: `https://sourcelibrary.org/api/books/${a.book_id}/quote?page=${a.page_number}`,
      };
    });

  // The work filter, applied after each leaf's head is resolved: this is where a
  // Stephanus number is disambiguated between the three 1578 volumes.
  const witnesses = (work ? allAtRef.filter((w) => w.work?.slug === work.slug || w.work_alt?.slug === work.slug) : allAtRef)
    .map(({ work_alt, ...w }) => ({
      ...w,
      // Say so when the match came from the boundary candidate rather than the
      // head printed on the leaf. The caller can then check the leaf itself.
      attribution: work && w.work?.slug !== work.slug
        ? `boundary: this leaf carries no running head of its own and sits under ${w.work?.label ?? 'the previous work'}; ${work_alt?.label ?? 'the requested work'} begins within two leaves`
        : 'running head',
    }));

  // A leaf whose head names a DIFFERENT work is worth reporting rather than
  // discarding, because at a work boundary the attribution is the weak link: a
  // work's opening leaves often carry the previous work's running head (the recto
  // names the work, the verso names only the author), so the first leaf or two of
  // a dialogue can sit under its predecessor. Saying "we hold this number, filed
  // under X" lets the caller judge; a bare empty result hides a leaf we have.
  const filteredOut = work
    ? allAtRef
        .filter((w) => w.work?.slug !== work.slug && w.work_alt?.slug !== work.slug)
        .map((w) => ({
          book_id: w.book_id,
          edition: w.edition,
          page: w.page,
          reference: w.reference,
          filed_under: w.work?.label ?? null,
          running_head: w.running_head,
          url: w.url,
        }))
    : [];

  const distinctWorks = [...new Map(witnesses.map((w) => [w.work?.slug ?? w.running_head, w])).keys()];
  const ambiguous = !work && system === 'stephanus' && distinctWorks.length > 1;
  const systemsHit = [...new Set(witnesses.map((w) => w.system))];

  return NextResponse.json({
    query: {
      reference: parsed.ref,
      reference_label: `${parsed.ref.page}${parsed.ref.section ?? ''}${parsed.ref.line ? `.${parsed.ref.line}` : ''}`,
      system: system ?? 'either',
      work: work ? { slug: work.slug, label: work.label } : null,
    },
    witnesses,
    witness_count: witnesses.length,
    ambiguous_work: ambiguous || undefined,
    other_works_at_this_reference: filteredOut.length ? filteredOut : undefined,
    note: buildNote({
      system, work: !!work, count: witnesses.length, ambiguous,
      line: parsed.ref.line, sectionAsked: parsed.ref.section,
      sectionsFound: [...new Set(witnesses.map((w) => w.reference))],
      otherWorks: filteredOut.length,
      systemsHit,
    }),
    // Only the editions that could answer at this reference, so an empty result
    // is readable: if this list is empty the number is outside everything we
    // hold, and if it is not, we hold the range and not the leaf.
    editions_searched: editions
      .filter((e) => (e.ref_min as number) <= parsed.ref.page && parsed.ref.page <= (e.ref_max as number))
      .map((e) => ({
        book_id: e.book_id, edition: e.label, system: e.system, language: e.language,
        mechanism: e.mechanism, covers: [e.ref_min, e.ref_max],
        anchors: (e.anchors_printed as number) + (e.anchors_frame as number),
      })),
    editions_registered: editions.length,
  });
}, { route: 'locus' });

function buildNote(o: {
  system: LocusSystem | null;
  work: boolean;
  count: number;
  ambiguous: boolean;
  line: number | null;
  sectionAsked: string | null;
  sectionsFound: string[];
  otherWorks: number;
  systemsHit: LocusSystem[];
}): string {
  const parts: string[] = [];
  if (o.systemsHit.length > 1) {
    // The same number is a Bekker page of Aristotle AND a Stephanus page of
    // Plato. Both sets of leaves are real; taking one for the other would
    // misattribute a quotation to a different author entirely.
    parts.push(
      'This number exists in BOTH systems, so the witnesses below span Aristotle (bekker) and Plato (stephanus). Read the system field on each, and pass system= or work= to narrow.',
    );
  }
  if (!o.count) {
    parts.push(
      'No witness holds an anchor at this reference. That means this library has no leaf on which the number is printed — not that the reference is invalid. editions_searched lists what was consulted and the reference range each covers.',
    );
  }
  if (o.otherWorks) {
    parts.push(
      `${o.otherWorks} leaf/leaves carry this number under a different work — see other_works_at_this_reference. At a work boundary the running head can lag by a leaf, so if the reference is near the start of the work you asked for, one of those is probably it.`,
    );
  }
  if (o.sectionAsked && o.sectionsFound.some((r) => !r.endsWith(o.sectionAsked as string))) {
    parts.push(
      `Matching is by page, not section: you asked for ${o.sectionAsked} and the anchors printed on these leaves read ${o.sectionsFound.join(', ')}. A leaf carries a run of sections and the margin records only one of them, so this is the right leaf — read the section off it.`,
    );
  }
  if (o.ambiguous) {
    parts.push(
      'Stephanus numbers restart in each of the three 1578 volumes, so this number occurs in more than one dialogue. Pass work= to disambiguate; the running_head on each witness is the evidence for the work shown.',
    );
  }
  if (o.line) {
    parts.push(
      'Line numbers are not resolved: anchors are page- and column-level, so the witness is the right leaf and the line must be found by reading it. Use get_quote on the page.',
    );
  }
  if (o.count) {
    parts.push(
      'Every witness is a leaf on which this reference was printed, except where basis is "frame" — those sit between two printed neighbours under a verified constant offset. Nothing is interpolated.',
    );
  }
  return parts.join(' ');
}
