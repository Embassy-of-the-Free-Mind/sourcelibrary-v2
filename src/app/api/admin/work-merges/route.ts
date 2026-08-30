import { NextResponse } from 'next/server';
import { withInnerCircleAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { getBookThumbnailUrl } from '@/lib/utils';
import { applyWorkMerge, pickWorkWinner, rejectWorkMerge } from '@/lib/identity-review-apply';

export const maxDuration = 30;

/**
 * Review surface for `work_merge_queue` (#3846) — the MEDIUM-confidence
 * containment pairs that `scripts/maintenance/merge-work-clusters.mjs` queues
 * instead of auto-merging. Approving a pair here runs the exact apply
 * semantics of that script's HIGH lane (loser books rewritten to the winner,
 * `work_id_aliases` stamped on the whole cluster so /work/[id] redirects,
 * provenance doc in `work_id_merges`), with `resolver: 'human'` and the
 * per-book prior work_ids kept inside the provenance doc as the revert path.
 *
 * Titles/langs/covers shown to the reviewer are pulled LIVE from `books` —
 * the frozen `evidence` strings on the queue row are display-order-unstable
 * (the writer sorts a/b after building evidence) and can go stale.
 */

interface WorkSide {
  workId: string;
  nBooks: number;
  nVisible: number;
  bph: boolean;
  languages: string[];
  yearMin: number | null;
  yearMax: number | null;
  samples: { id: string; title: string; slug: string; visible: boolean; thumb: string | null }[];
}

function isBphBook(b: Record<string, unknown>): boolean {
  const held = b.held_by;
  if (Array.isArray(held) && held.includes('bph')) return true;
  return ((b.image_source as Record<string, string>)?.provider) === 'bph';
}

function summarizeSide(workId: string, books: Record<string, unknown>[]): WorkSide {
  const langs = new Set<string>();
  const years: number[] = [];
  for (const b of books) {
    if (typeof b.language === 'string' && b.language) langs.add(b.language);
    if (typeof b.year === 'number') years.push(b.year);
  }
  const samples = [...books]
    .sort((a, b) => Number(b.visible === true) - Number(a.visible === true) || ((b.pages_count as number) || 0) - ((a.pages_count as number) || 0))
    .slice(0, 3)
    .map((b) => ({
      id: b.id as string,
      title: (b.title as string) || '',
      slug: (b.slug as string) || '',
      visible: b.visible === true,
      thumb: getBookThumbnailUrl(b as Parameters<typeof getBookThumbnailUrl>[0], 'thumb'),
    }));
  return {
    workId,
    nBooks: books.length,
    nVisible: books.filter((b) => b.visible === true).length,
    bph: books.some(isBphBook),
    languages: [...langs].sort(),
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
    samples,
  };
}

/** Default winner: a Wikidata QID beats a local mint; else the id holding more books. */
function defaultWinner(a: WorkSide, b: WorkSide): string {
  return pickWorkWinner(a.workId, b.workId, a.nBooks, b.nBooks);
}

/**
 * GET /api/admin/work-merges?status=pending&limit=50&skip=0&verdict=unsure&author=homer
 * Lists queue rows with live book context; `verdict` filters on the optional
 * `llm` screening stamp (same|different|unsure|none).
 *
 * `ids=a,b,c` (max 50) fetches specific rows — the batch lane's spot-check
 * renders its sample through this exact read path, so what the human eyeballs
 * before a 980-row approval is the same card a single-row reviewer sees.
 */
export const GET = withInnerCircleAuth(async (request) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
  const skip = Math.max(parseInt(url.searchParams.get('skip') || '0', 10) || 0, 0);
  const verdict = url.searchParams.get('verdict');
  const author = url.searchParams.get('author');
  const bphOnly = url.searchParams.get('bph') === '1';
  const idsParam = url.searchParams.get('ids');

  const db = await getDb();
  const queue = db.collection('work_merge_queue');

  const filter: Record<string, unknown> = { status };
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (ids.length === 0) return NextResponse.json({ items: [], total: 0, counts: {} });
    filter._id = { $in: ids };
  }
  if (verdict === 'none') filter['llm'] = { $exists: false };
  else if (verdict) filter['llm.verdict'] = verdict;
  if (author) filter['evidence.author'] = { $regex: author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  // BPH lane (#3846 follow-up): pairs where either side holds a BPH/EFM book.
  // held_by is the canonical holdings marker; provider catches early imports
  // that predate held_by backfill.
  const BPH_BOOK = { $or: [{ held_by: 'bph' }, { 'image_source.provider': 'bph' }] };
  if (bphOnly) {
    const bphWids = await db.collection('books').distinct('work_id', {
      ...BPH_BOOK, work_id: { $exists: true, $nin: [null, ''] },
    });
    filter.$or = [{ a: { $in: bphWids } }, { b: { $in: bphWids } }];
  }

  const [rows, total, statusCounts] = await Promise.all([
    queue.find(filter).sort({ 'evidence.author': 1, _id: 1 }).skip(skip).limit(limit).toArray(),
    queue.countDocuments(filter),
    queue.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
  ]);

  const workIds = [...new Set(rows.flatMap((r) => [r.a as string, r.b as string]))];
  const books = workIds.length
    ? await db.collection('books').find(
        { work_id: { $in: workIds } },
        { projection: {
          _id: 0, id: 1, work_id: 1, title: 1, slug: 1, language: 1, year: 1, visible: 1,
          pages_count: 1, image_thumb: 1, image_display: 1, thumbnail: 1, thumbnail_blob: 1,
          held_by: 1, 'image_source.provider': 1,
        } }
      ).toArray()
    : [];
  const byWid = new Map<string, Record<string, unknown>[]>();
  for (const b of books) {
    const wid = b.work_id as string;
    if (!byWid.has(wid)) byWid.set(wid, []);
    byWid.get(wid)!.push(b);
  }

  const items = rows.map((r) => {
    const sideA = summarizeSide(r.a as string, byWid.get(r.a as string) || []);
    const sideB = summarizeSide(r.b as string, byWid.get(r.b as string) || []);
    return {
      id: r._id,
      status: r.status,
      author: r.evidence?.author || '',
      evidence: { cont: r.evidence?.cont ?? null, inter: r.evidence?.inter ?? null, source: r.evidence?.source || '' },
      llm: r.llm || null,
      a: sideA,
      b: sideB,
      suggestedWinner: defaultWinner(sideA, sideB),
      winner: r.winner || null,
      note: r.note || null,
      reviewed_by: r.reviewed_by || null,
      reviewed_at: r.reviewed_at || null,
    };
  });

  const counts: Record<string, number> = {};
  for (const c of statusCounts) counts[c._id as string] = c.n as number;

  return NextResponse.json({ items, total, counts });
});

/**
 * POST /api/admin/work-merges
 * Body: { id, action: 'approve' | 'reject', winner?, note? }
 *
 * approve = the merge actually happens, here, attributed to the signed-in
 * admin. This is deliberate actuation-at-the-point-of-review (the #3726
 * Tier 3 shape): no second job reads these rows later.
 */
export const POST = withInnerCircleAuth(async (request, session) => {
  const body = await request.json();
  const { id, action, winner: winnerParam, note } = body as { id?: string; action?: string; winner?: string; note?: string };
  if (!id || (action !== 'approve' && action !== 'reject')) {
    return NextResponse.json({ error: 'id and action (approve|reject) required' }, { status: 400 });
  }

  const db = await getDb();
  const queue = db.collection('work_merge_queue');
  const row = await queue.findOne({ _id: id as never });
  if (!row) return NextResponse.json({ error: 'queue row not found' }, { status: 404 });
  if (row.status !== 'pending') {
    return NextResponse.json({ error: `row is already ${row.status}` }, { status: 409 });
  }

  const reviewer = session.user?.email || 'admin';

  // Both branches run the shared write path in @/lib/identity-review-apply —
  // the same code the batch lane (#4271) calls, so one approval and one row of
  // a 980-row batch are byte-for-byte the same write.
  if (action === 'reject') {
    const res = await rejectWorkMerge(db, id, { note, reviewer });
    if (res.status === 'error') return NextResponse.json({ error: res.message }, { status: 409 });
    return NextResponse.json({ status: 'rejected' });
  }

  const res = await applyWorkMerge(db, row, { winner: winnerParam, note, reviewer });
  return NextResponse.json(res);
});
