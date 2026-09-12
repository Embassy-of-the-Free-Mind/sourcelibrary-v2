import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { toUserId } from '@/lib/user-id';
import { storagePut } from '@/lib/storage';
import { images } from '@/lib/api-client';
import { isBrowserRenderableImageUrl } from '@/lib/csp-img-hosts';

// POST /api/me/avatar — set, replace, or remove the signed-in reader's profile
// photo. Three body shapes:
//
//   multipart/form-data           file=<image> [x,y,w,h normalized crop bbox]
//   application/json              { source_url, bbox: { x, y, w, h } }
//   application/json              { remove: true }
//
// The JSON form is "pick a picture from the library": the client sends the URL
// of a page scan / extracted illustration / artwork plus a square crop the
// reader chose. The server refetches and crops — the client never uploads
// pixels it doesn't own the bytes of, and the crop math runs against the true
// source dimensions.
//
// Output is always a 512×512 JPEG at avatars/{userId}/{hash}.jpg on R2
// (images.sourcelibrary.org is already in the CSP img-src allowlist, which is
// what makes these render where Google's lh3 avatars historically didn't).
// Content-addressed key: replacing a photo writes a new object, so the old URL
// stays valid in any cached session until the JWT refreshes.
//
// users.image discipline (see session-flags-and-forms.md): a STRING means "the
// reader chose this photo", an explicit NULL means "the reader removed it", and
// an ABSENT field means "never touched" (Google's OAuth picture keeps serving
// via token.picture). The jwt callback in src/lib/auth.ts mirrors exactly that
// three-state read.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const AVATAR_SIZE = 512;
const MIN_SOURCE_CROP_PX = 40; // refuse crops smaller than this per side

interface Bbox { x: number; y: number; w: number; h: number }

function parseBbox(raw: unknown): Bbox | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, w, h } = raw as Record<string, unknown>;
  const nums = [x, y, w, h].map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  const [nx, ny, nw, nh] = nums;
  if (nw <= 0 || nh <= 0 || nx < 0 || ny < 0 || nx + nw > 1.001 || ny + nh > 1.001) return null;
  return { x: nx, y: ny, w: nw, h: nh };
}

async function renderAvatar(input: Buffer, bbox: Bbox | null): Promise<Buffer> {
  // .rotate() with no args applies the EXIF orientation, so phone photos come
  // out upright and the bbox (chosen against the displayed orientation) aligns.
  let pipeline = sharp(input, { limitInputPixels: 100_000_000 }).rotate();

  if (bbox) {
    const meta = await pipeline.metadata();
    const iw = meta.width || 0;
    const ih = meta.height || 0;
    if (!iw || !ih) throw new Error('Could not read image dimensions');
    const left = Math.max(0, Math.round(bbox.x * iw));
    const top = Math.max(0, Math.round(bbox.y * ih));
    const width = Math.min(iw - left, Math.round(bbox.w * iw));
    const height = Math.min(ih - top, Math.round(bbox.h * ih));
    if (width < MIN_SOURCE_CROP_PX || height < MIN_SOURCE_CROP_PX) {
      throw new Error('That crop is too small to make a clear photo — zoom out a little.');
    }
    pipeline = pipeline.extract({ left, top, width, height });
  }

  return pipeline
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const contentType = request.headers.get('content-type') || '';
    let sourceBuffer: Buffer | null = null;
    let bbox: Bbox | null = null;
    let remove = false;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 });
      }
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Only image files are accepted' }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Image must be under 10 MB' }, { status: 400 });
      }
      sourceBuffer = Buffer.from(await file.arrayBuffer());
      bbox = parseBbox({
        x: form.get('x'), y: form.get('y'), w: form.get('w'), h: form.get('h'),
      });
    } else {
      const body = await request.json().catch(() => ({}));
      if (body?.remove === true) {
        remove = true;
      } else {
        const sourceUrl = String(body?.source_url || '');
        // Same allowlist the browser enforces via CSP — anything a reader can
        // see on the site is croppable, and nothing else is fetchable (the
        // fetch happens server-side, so an open URL here would be SSRF).
        if (!isBrowserRenderableImageUrl(sourceUrl)) {
          return NextResponse.json({ error: 'source_url must be a library image' }, { status: 400 });
        }
        bbox = parseBbox(body?.bbox);
        if (!bbox) {
          return NextResponse.json({ error: 'bbox { x, y, w, h } (normalized 0–1) is required' }, { status: 400 });
        }
        sourceBuffer = await images.fetchBuffer(sourceUrl, { timeout: 20000 });
        if (sourceBuffer.length > MAX_UPLOAD_BYTES * 3) {
          return NextResponse.json({ error: 'Source image is too large' }, { status: 400 });
        }
      }
    }

    const db = await getDb();

    if (remove) {
      // Explicit null, never $unset: null records "the reader removed their
      // photo" so the jwt callback clears token.picture instead of letting the
      // provider photo quietly reappear. The old R2 object is left in place —
      // cached sessions may still reference it.
      await db.collection('users').updateOne(
        { _id: toUserId(userId) as any },
        { $set: { image: null } }
      );
      return NextResponse.json({ success: true, url: null });
    }

    const avatar = await renderAvatar(sourceBuffer!, bbox);
    const hash = createHash('sha256').update(avatar).digest('hex').slice(0, 16);
    const { url } = await storagePut(`avatars/${userId}/${hash}.jpg`, avatar, {
      contentType: 'image/jpeg',
    });

    await db.collection('users').updateOne(
      { _id: toUserId(userId) as any },
      { $set: { image: url } }
    );

    return NextResponse.json({ success: true, url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update photo';
    console.error('[avatar] error:', message);
    // Sharp throws on non-image bytes and truncated files — that's a 400-class
    // problem (the reader picked a bad file), not a server fault.
    const status = /unsupported image|input buffer|too small|dimensions/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
