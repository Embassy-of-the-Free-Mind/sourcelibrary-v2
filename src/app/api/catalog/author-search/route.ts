import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Search OUR canonical author thesaurus (the `authors` collection) by name for
 * the catalogue contributor picker. This is deliberately backed by the
 * thesaurus that drives /author/[slug], variant→canonical redirects, and
 * dedup — NOT VIAF (which has ~0.2% coverage on this corpus and grabs famous
 * same-name people). When a cataloguer links a contributor here, it's the same
 * canonical entity the public author page resolves to.
 *
 * Returns the canonical slug (`author_id` = authors._id) plus VIAF/Wikidata
 * anchors carried on the thesaurus doc. Public bibliographic data, mirroring
 * the existing /api/authority/author/search precedent.
 */
export const runtime = 'nodejs';

interface AuthorDoc {
  _id: string;
  canonical_name?: string;
  variants?: string[];
  viaf_id?: string | null;
  wikidata_id?: string | null;
  book_count?: number;
}

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json({ matches: [] });

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');

  const db = await getDb();
  const rows = (await db
    .collection('authors')
    .find(
      { $or: [{ canonical_name: rx }, { variants: rx }, { _id: rx }] },
      { projection: { canonical_name: 1, variants: 1, viaf_id: 1, wikidata_id: 1, book_count: 1 } },
    )
    .limit(40)
    .toArray()) as unknown as AuthorDoc[];

  // Rank: exact name match, then a prefix match on the canonical name OR any
  // variant (so a surname query like "Kircher" still scores "Athanasius
  // Kircher" via its "Kircher, Athanasius" variant), then by corpus weight so
  // the real person outranks title-fragment author stubs ("Kircher Oedipus").
  const ql = q.toLowerCase();
  const score = (r: AuthorDoc) => {
    const names = [r.canonical_name || r._id, ...(r.variants || [])].map((s) => s.toLowerCase());
    const exact = names.some((n) => n === ql) ? 1 : 0;
    const prefix = names.some((n) => n.startsWith(ql)) ? 1 : 0;
    return exact * 1e9 + prefix * 1e6 + (r.book_count || 0);
  };
  rows.sort((a, b) => score(b) - score(a));

  const matches = rows.slice(0, 12).map((r) => ({
    author_id: r._id,
    canonical_name: r.canonical_name || r._id,
    viaf_id: r.viaf_id || null,
    wikidata_id: r.wikidata_id || null,
    // A couple of variant spellings help disambiguate same-name people.
    variants: (r.variants || []).filter((v) => v !== r.canonical_name).slice(0, 3),
  }));

  return NextResponse.json({ matches });
}
