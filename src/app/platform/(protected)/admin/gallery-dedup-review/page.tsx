/**
 * Gallery dedup spot-check — visually compare archived vs. kept gallery
 * images so a human can verify the bbox+desc-prefix dedup didn't merge
 * legitimately distinct illustrations.
 *
 * Built after the 2026-05-27 dedup pass to support FP-suspect review.
 * Loads a random 24-pair sample from `deleted_gallery_images` joined with
 * their kept canonical in `gallery_images` and the source book.
 *
 * No client JS — pure server component, native <img>, refresh = new sample.
 * Gated by the platform-protected layout (requireSuperAdmin).
 */
import { getReadDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface Pair {
  id: string;
  kept_id: string;
  book_id: string;
  description?: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  gallery_quality?: number;
  archived_url?: string;
  keeper: {
    id: string;
    extracted_url?: string;
    thumbnail_url?: string;
    description?: string;
    type?: string;
    gallery_quality?: number;
  };
  book: { id: string; slug?: string; title?: string };
}

function reconstructUrl(book_id: string, id: string): string {
  return `https://images.sourcelibrary.org/gallery/${book_id}/${id}.jpg`;
}

export default async function GalleryDedupReview({ searchParams }: { searchParams: Promise<{ size?: string; book?: string }> }) {
  const params = await searchParams;
  const size = Math.min(Math.max(Number(params.size) || 24, 4), 60);
  const bookFilter = params.book;

  const db = await getReadDb();

  const matchStage: Record<string, unknown> = {
    reason: 'recurring_template',
    kept_id: { $exists: true, $ne: null },
  };
  if (bookFilter) matchStage.book_id = bookFilter;

  const pipeline = [
    { $match: matchStage },
    { $sample: { size } },
    {
      $lookup: {
        from: 'gallery_images',
        localField: 'kept_id',
        foreignField: 'id',
        as: 'keeper',
        pipeline: [{ $project: { id: 1, extracted_url: 1, thumbnail_url: 1, description: 1, type: 1, gallery_quality: 1, _id: 0 } }, { $limit: 1 }],
      },
    },
    { $match: { 'keeper.0': { $exists: true } } },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book',
        pipeline: [{ $project: { id: 1, slug: 1, title: 1, _id: 0 } }, { $limit: 1 }],
      },
    },
  ];

  const docs = await db.collection('deleted_gallery_images').aggregate(pipeline, { allowDiskUse: true }).toArray();

  const pairs: Pair[] = docs.map((d) => ({
    id: d.id,
    kept_id: d.kept_id,
    book_id: d.book_id,
    description: d.description,
    type: d.type,
    bbox: d.bbox,
    gallery_quality: d.gallery_quality,
    archived_url: d.extracted_url || reconstructUrl(d.book_id, d.id),
    keeper: {
      id: d.keeper[0].id,
      extracted_url: d.keeper[0].extracted_url,
      thumbnail_url: d.keeper[0].thumbnail_url,
      description: d.keeper[0].description,
      type: d.keeper[0].type,
      gallery_quality: d.keeper[0].gallery_quality,
    },
    book: d.book[0] || { id: d.book_id },
  }));

  // Stats banner: total archived this round, books affected
  const [archivedCount, booksAgg] = await Promise.all([
    db.collection('deleted_gallery_images').countDocuments({ reason: 'recurring_template' }),
    db.collection('deleted_gallery_images').aggregate([
      { $match: { reason: 'recurring_template' } },
      { $group: { _id: '$book_id' } },
      { $count: 'n' },
    ]).toArray(),
  ]);
  const booksAffected = booksAgg[0]?.n ?? 0;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 16px', color: '#e6edf3' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>Gallery dedup spot-check</h1>
      <div style={{ color: '#8b949e', fontSize: 14, marginBottom: 20 }}>
        {archivedCount.toLocaleString()} rows archived across {booksAffected} books on 2026-05-27 by{' '}
        <code style={{ background: '#161b22', padding: '2px 6px', borderRadius: 3 }}>
          scripts/maintenance/dedup-book-gallery-images.mjs
        </code>
        . Showing a random sample of {pairs.length}. Left = archived (treated as a dupe of right = keeper).{' '}
        <a href="?" style={{ color: '#58a6ff' }}>Reshuffle</a>{' '}
        ·{' '}
        <a href="?size=48" style={{ color: '#58a6ff' }}>48 pairs</a>
        {bookFilter && (
          <>
            {' '}·{' '}
            <strong style={{ color: '#f0883e' }}>filtered to one book</strong>{' '}
            <a href="?" style={{ color: '#58a6ff' }}>(clear)</a>
          </>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(640px, 1fr))', gap: 16 }}>
        {pairs.map((p) => (
          <div
            key={p.id}
            style={{
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
            }}
          >
            <div style={{ marginBottom: 8, color: '#8b949e' }}>
              <a
                href={`/book/${p.book.slug || p.book.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#58a6ff', fontWeight: 600, marginRight: 8 }}
              >
                {p.book.title || p.book.id}
              </a>
              <span style={{ fontSize: 11 }}>
                · type: {p.type || '∅'}
                {p.bbox && (
                  <>
                    {' '}· bbox: {p.bbox.x.toFixed(2)}, {p.bbox.y.toFixed(2)},{' '}
                    {p.bbox.width.toFixed(2)} × {p.bbox.height.toFixed(2)}
                  </>
                )}
              </span>
              {!bookFilter && (
                <span>
                  {' '}·{' '}
                  <a href={`?book=${p.book.id}`} style={{ color: '#8b949e' }}>filter</a>
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ background: '#0d1117', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                  <a href={p.archived_url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.archived_url}
                      alt={p.description || 'archived'}
                      style={{ width: '100%', display: 'block' }}
                      loading="lazy"
                    />
                  </a>
                </div>
                <div style={{ color: '#7d8590', fontSize: 11 }}>
                  <strong style={{ color: '#f0883e' }}>archived</strong> q={p.gallery_quality ?? '?'}
                </div>
                <div style={{ color: '#c9d1d9', marginTop: 4 }}>{p.description}</div>
              </div>
              <div>
                <div style={{ background: '#0d1117', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                  <a href={p.keeper.extracted_url || reconstructUrl(p.book_id, p.keeper.id)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.keeper.thumbnail_url || p.keeper.extracted_url || reconstructUrl(p.book_id, p.keeper.id)}
                      alt={p.keeper.description || 'keeper'}
                      style={{ width: '100%', display: 'block' }}
                      loading="lazy"
                    />
                  </a>
                </div>
                <div style={{ color: '#7d8590', fontSize: 11 }}>
                  <strong style={{ color: '#3fb950' }}>keeper</strong> q={p.keeper.gallery_quality ?? '?'}
                </div>
                <div style={{ color: '#c9d1d9', marginTop: 4 }}>{p.keeper.description}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, color: '#8b949e', fontSize: 12 }}>
        Restore a book&apos;s archives:
        <code style={{ background: '#161b22', padding: '2px 6px', borderRadius: 3, marginLeft: 6 }}>
          node scripts/maintenance/dedup-book-gallery-images.mjs --book {'<id>'} (and follow the rollback recipe in the commit body of PR #2100)
        </code>
      </div>
    </div>
  );
}
