import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getReadDb } from '@/lib/mongodb';
import { checkHoldings } from '@/lib/holdings-check';

export const preferredRegion = 'fra1';
export const maxDuration = 30;

/**
 * GET /api/admin/holdings-check?q=<url-or-identifier-or-title>&author=&year=
 *
 * "Do we already hold this?" before an import — the admin door to
 * `checkHoldings()` (src/lib/holdings-check.ts, #6019). Hidden books and the
 * warehouse are included and labelled, which is why this is admin-only: the
 * public check (/api/books/check-duplicate) must not describe hidden records.
 *
 * `q` is read as a URL when it starts with http(s), as an identifier when it
 * is one token, and as a title otherwise. `url`, `id`, `title` may be passed
 * explicitly instead. Read-only.
 */
export const GET = withAuth(async (request) => {
  const sp = new URL(request.url).searchParams;
  const q = (sp.get('q') || '').trim();
  const yearRaw = sp.get('year');
  const input = {
    url: sp.get('url') || (/^https?:\/\//i.test(q) ? q : null),
    identifier: sp.get('id') || (q && !/^https?:\/\//i.test(q) && !/\s/.test(q) ? q : null),
    title: sp.get('title') || (q && /\s/.test(q) && !/^https?:\/\//i.test(q) ? q : null),
    author: sp.get('author') || null,
    year: yearRaw ? parseInt(yearRaw, 10) || null : null,
  };
  // A one-word query may be a title ("Musurgia") as much as an id.
  if (input.identifier && !input.title && !sp.get('id')) input.title = input.identifier;
  if (!input.url && !input.identifier && !input.title) {
    return NextResponse.json({ error: 'Give q (a URL, identifier or title), or url / id / title.' }, { status: 400 });
  }

  const db = await getReadDb();
  const result = await checkHoldings(db, input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}, { minRole: 'admin' });
