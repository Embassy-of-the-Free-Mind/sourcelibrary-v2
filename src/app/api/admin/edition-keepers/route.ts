import { NextResponse } from 'next/server';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';

export const maxDuration = 30;

/**
 * Review surface for `edition_keeper_queue` (#3846) — both-visible clusters
 * sharing one full-quality `edition_key`, pre-classified by the 2026-08-09
 * keeper-choice triage (ingested via
 * `scripts/maintenance/ingest-keeper-choice-queue.mjs`). The human lane is
 * TOSSUP + SUSPECT_NOT_SAME; MECHANICAL/SCORED keeps stay script territory.
 *
 * "Keep" hides the other members with the same semantics as
 * /api/admin/duplicates (hidden_reason 'duplicate', duplicate_of → keeper),
 * plus the `updated_at` bump the Supabase catalog sync keys on.
 * "Dismiss" records "not the same edition" and touches no book.
 */

const HUMAN_BUCKETS = ['TOSSUP', 'SUSPECT_NOT_SAME'];

export const GET = withInnerCircleAuth(async (request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const bucket = url.searchParams.get('bucket') || 'human';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 100);
  const skip = Math.max(parseInt(url.searchParams.get('skip') || '0', 10) || 0, 0);

  const db = await getDb();
  const queue = db.collection('edition_keeper_queue');

  const filter: Record<string, unknown> = { status };
  if (bucket === 'human') filter.bucket = { $in: HUMAN_BUCKETS };
  else if (bucket !== 'all') filter.bucket = bucket;

  const [rows, total, statusCounts, bucketCounts] = await Promise.all([
    queue.find(filter).sort({ ft_flag: -1, _id: 1 }).skip(skip).limit(limit).toArray(),
    queue.countDocuments(filter),
    queue.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
    queue.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: '$bucket', n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const memberIds = [...new Set(rows.flatMap((r) => ((r.members as { id: string }[]) || []).map((m) => m.id)))];
  const books = memberIds.length
    ? await db.collection('books').find(
        { id: { $in: memberIds } },
        { projection: {
          _id: 0, id: 1, title: 1, author: 1, slug: 1, language: 1, year: 1, visible: 1,
          pages_count: 1, pages_ocr: 1, pages_translated: 1, is_first_translation: 1,
          'image_source.provider': 1,
          image_thumb: 1, image_display: 1, thumbnail: 1, thumbnail_blob: 1,
        } }
      ).toArray()
    : [];
  const byId = new Map(books.map((b) => [b.id as string, b]));

  const items = rows.map((r) => ({
    editionKey: r._id,
    bucket: r.bucket,
    status: r.status,
    ftFlag: r.ft_flag === true,
    pageRatio: r.page_ratio ?? null,
    suggestedKeeper: r.keeper_suggested || null,
    keeper: r.keeper || null,
    reviewed_by: r.reviewed_by || null,
    members: ((r.members as { id: string; quality?: number }[]) || []).map((m) => {
      const live = byId.get(m.id);
      return {
        id: m.id,
        // quality is the triage-time score snapshot; everything else is live
        quality: m.quality ?? null,
        found: !!live,
        title: (live?.title as string) || '',
        author: (live?.author as string) || '',
        slug: (live?.slug as string) || '',
        language: (live?.language as string) || '',
        year: (live?.year as number) ?? null,
        visible: live?.visible === true,
        pages: (live?.pages_count as number) || 0,
        ocr: (live?.pages_ocr as number) || 0,
        translated: (live?.pages_translated as number) || 0,
        ft: live?.is_first_translation === true,
        provider: ((live?.image_source as Record<string, string>)?.provider) || '',
        thumb: live ? getBookThumbnailUrl(live as Parameters<typeof getBookThumbnailUrl>[0], 'thumb') : null,
      };
    }),
  }));

  const counts: Record<string, number> = {};
  for (const c of statusCounts) counts[c._id as string] = c.n as number;
  const buckets: Record<string, number> = {};
  for (const c of bucketCounts) buckets[c._id as string] = c.n as number;

  return NextResponse.json({ items, total, counts, buckets });
});

/**
 * POST /api/admin/edition-keepers
 * Body: { editionKey, action: 'keep' | 'dismiss', keeperId?, note? }
 */
export const POST = withInnerCircleAuth(async (request, session) => {
  const body = await request.json();
  const { editionKey, action, keeperId, note } = body as { editionKey?: string; action?: string; keeperId?: string; note?: string };
  if (!editionKey || (action !== 'keep' && action !== 'dismiss')) {
    return NextResponse.json({ error: 'editionKey and action (keep|dismiss) required' }, { status: 400 });
  }

  const db = await getDb();
  const queue = db.collection('edition_keeper_queue');
  const row = await queue.findOne({ _id: editionKey as never });
  if (!row) return NextResponse.json({ error: 'cluster not found' }, { status: 404 });
  if (row.status !== 'pending') {
    return NextResponse.json({ error: `cluster is already ${row.status}` }, { status: 409 });
  }

  const now = new Date();
  const reviewer = session.user?.email || 'admin';

  if (action === 'dismiss') {
    await queue.updateOne({ _id: editionKey as never }, { $set: { status: 'dismissed', note: note || null, reviewed_by: reviewer, reviewed_at: now, updated_at: now } });
    return NextResponse.json({ status: 'dismissed' });
  }

  const memberIds = ((row.members as { id: string }[]) || []).map((m) => m.id);
  if (!keeperId || !memberIds.includes(keeperId)) {
    return NextResponse.json({ error: 'keeperId must be a member of the cluster' }, { status: 400 });
  }
  const others = memberIds.filter((m) => m !== keeperId);

  const hidden = await db.collection('books').updateMany(
    { id: { $in: others }, visible: true },
    { $set: {
      hidden: true, visible: false,
      hidden_reason: 'duplicate', hidden_at: now,
      duplicate_of: keeperId,
      updated_at: now, // books_catalog sync keys on this — a flip without it is invisible to Supabase
    } }
  );

  await queue.updateOne(
    { _id: editionKey as never },
    { $set: { status: 'kept', keeper: keeperId, note: note || null, reviewed_by: reviewer, reviewed_at: now, updated_at: now } }
  );

  return NextResponse.json({ status: 'kept', keeper: keeperId, hidden: hidden.modifiedCount });
});
