import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { linkAuthorToEntity, type AuthorAuthorityMatch } from '@/lib/author-authority';

export const dynamic = 'force-dynamic';

/**
 * POST /api/authority/author/link
 *
 * Persist a VIAF-resolved match as an entity in the existing `entities`
 * collection (shape matches `scripts/enrichment/viaf-author-linking.mjs`)
 * and return the entity's MongoDB `_id`. Callers store that string in
 * `Book.author_entity_id` / `bph_works.author_entity_id`.
 *
 * Body: { match: AuthorAuthorityMatch }
 * Returns: { entity_id: string }
 *
 * The matching search endpoint is `/api/authority/author/search` — it does
 * NOT write to the DB. Writes happen here, only when a librarian explicitly
 * picks a candidate.
 */
export const POST = withAuth(async (request: NextRequest) => {
  let body: { match?: AuthorAuthorityMatch };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const match = body?.match;
  if (!match || (!match.viaf_id && !match.wikidata_qid && !match.canonical_name)) {
    return NextResponse.json(
      { error: 'match.viaf_id, .wikidata_qid, or .canonical_name required' },
      { status: 400 },
    );
  }
  try {
    const { entity_id } = await linkAuthorToEntity(match);
    return NextResponse.json({ entity_id });
  } catch (err) {
    console.error('[authority/author/link] upsert failed', err);
    return NextResponse.json(
      { error: 'Failed to persist entity', details: (err as Error).message },
      { status: 500 },
    );
  }
}, { minRole: 'editor' });
