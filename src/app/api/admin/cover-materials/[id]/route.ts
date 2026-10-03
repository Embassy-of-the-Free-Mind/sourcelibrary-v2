import { NextRequest, NextResponse } from 'next/server';

// mongodb requires the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getPageSource, getPageImageUrl } from '@/lib/page-image-url';
import type { Page } from '@/lib/types';

/**
 * GET /api/admin/cover-materials/[id]   (admin only)
 *
 * Everything the cover maker (/admin/covers/[bookId]) can build a cover from, taken
 * from the book's own scans: the boards and endpapers, the title page, the
 * plates, and the illustrations the pipeline has already cut out.
 *
 * Read-only. Nothing here writes to the book or its pages.
 *
 * WHY THE FIRST AND LAST LEAVES. Bindings and endpapers are almost never typed
 * as such: OCR calls a dark board or a marbled pastedown `blank` and explains
 * itself in the `<warning>`/`<meta>` head ("a dark book cover", "a blank
 * flyleaf or endpaper"). So the outside of the book is found by position (the
 * first and last few leaves, where scanners photograph it) and confirmed by
 * that head text, never by `page_type` alone.
 */

const EDGE_LEAVES = 8;
const MAX_PLATES = 80;
const MAX_IMAGES = 120;

const OUTSIDE_RE = /\b(?:front|back|exterior|book|dark book) cover\b|\bbinding\b|\bboards?\b|\bspine\b|\bleather\b|\bvellum\b|\bparchment\b|\bcloth\b|\bmorocco\b|\bblind[\s-]?(?:tooled|stamped)\b|\bgilt\b|\bgold[\s-]tooled\b/i;
const ENDPAPER_RE = /\bmarbled\b|\bendpaper\b|\bpastedown\b|\bflyleaf\b|\bpaste[\s-]?paper\b/i;

type Role = 'outside' | 'endpaper' | 'title' | 'frontispiece' | 'plate' | 'leaf';

/** First readable sentence of the OCR envelope: what the model said the page is. */
function describe(head: string): string {
  const m = head.match(/<(?:warning|meta)>([^<]{0,220})/);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function roleOf(page: { page_type?: string | null; page_number: number }, head: string, total: number): Role {
  const t = page.page_type || '';
  if (t === 'title-page') return 'title';
  if (t === 'frontispiece') return 'frontispiece';
  if (t === 'cover') return 'outside';
  if (t === 'illustration') return 'plate';
  // Inside the book, "boards", "spine" or "cloth" are words in the text
  // (anatomy, botany), not a description of the binding.
  const atEdge = page.page_number <= EDGE_LEAVES || page.page_number > total - EDGE_LEAVES;
  if (!atEdge) return 'leaf';
  if (OUTSIDE_RE.test(head)) return 'outside';
  if (ENDPAPER_RE.test(head) || t === 'blank' || !t) return 'endpaper';
  return 'leaf';
}

export const GET = withAdminAuth(async (_req: NextRequest, _session, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const db = await getDb();

  const book = await db.collection('books').findOne(
    { $or: [{ id }, { slug: id }] },
    {
      projection: {
        _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1,
        publisher: 1, place_published: 1, place_of_publication: 1, language: 1,
        pages_count: 1, visible: 1,
      },
    },
  );
  // Admins may make concepts for hidden books too.
  if (!book) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  const pages = await db.collection('pages')
    .find(
      { book_id: book.id, hidden: { $ne: true } },
      {
        projection: {
          _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1,
          photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1,
          display_photo: 1, image_thumb: 1, thumbnail_blob: 1, thumbnail: 1, compressed_photo: 1,
          crop: 1, split_from_spread: 1, split_side: 1, archive_failed: 1,
          image_width: 1, image_height: 1,
          detected_images: 1,
          head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 600] },
        },
      },
    )
    .sort({ page_number: 1 })
    .toArray();

  const total = pages.length;
  const leaves = [];
  const images = [];
  let plates = 0;

  for (const raw of pages) {
    const page = raw as unknown as Page & { head?: string };
    const head = String(page.head || '');
    const thumb = getPageImageUrl(page, 'thumb');
    const source = getPageSource(page);
    if (!thumb || !source) continue;
    const role = roleOf(page, head, total);
    if (role === 'plate' && ++plates > MAX_PLATES) continue;
    leaves.push({
      n: page.page_number,
      role,
      type: page.page_type || null,
      note: role === 'leaf' ? '' : describe(head),
      thumb,
      display: getPageImageUrl(page, 'display') || source,
      full: source,
      w: page.image_width || null,
      h: page.image_height || null,
    });

    for (const img of page.detected_images || []) {
      if (images.length >= MAX_IMAGES) break;
      if (img.status === 'rejected' || !img.bbox) continue;
      images.push({
        page: page.page_number,
        type: img.type || 'unknown',
        description: img.description || '',
        bbox: img.bbox,
        rotation: img.rotation || 0,
        cut: img.extracted_url || null,
        thumb: img.thumbnail_url || null,
        quality: typeof img.gallery_quality === 'number' ? img.gallery_quality : null,
      });
    }
  }

  images.sort((a, b) => (b.quality ?? 0.3) - (a.quality ?? 0.3));

  return NextResponse.json(
    {
      book: {
        id: book.id,
        title: book.title,
        display_title: book.display_title || null,
        author: book.author || '',
        published: book.published || '',
        publisher: book.publisher || '',
        place: book.place_published || book.place_of_publication || '',
        language: book.language || '',
      },
      leaves,
      images,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
