import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { storagePut } from '@/lib/storage';
import { guardPublicSubmission } from '@/lib/public-submission-guard';
import { feedbackImageKey } from '@/lib/feedback-images';
import { MAX_FEEDBACK_IMAGE_BYTES, FEEDBACK_IMAGE_MAX_EDGE } from '@/lib/feedback-limits';

/**
 * POST /api/feedback/upload — one image attachment for a feedback message.
 *
 *   multipart/form-data   file=<image>
 *   → { url, width, height, bytes }
 *
 * Public and unauthenticated, like `/api/feedback` itself: a reader who found
 * a broken page should be able to show it without signing in. What bounds it:
 *   - the shared limiter (`feedback-upload`, per address per hour);
 *   - a byte cap on the request;
 *   - re-encoding through sharp, so what lands on R2 is always a WebP we
 *     produced from decoded pixels — EXIF (including GPS) is dropped, the
 *     longest edge is capped, and a file that only claims to be an image is
 *     rejected at decode.
 *
 * The object is content-addressed under `feedback/`; the URL only becomes
 * attached to anything when `/api/feedback` accepts it in `images[]`, and that
 * route only accepts URLs of this exact shape (`isFeedbackImageUrl`). An
 * upload with no message behind it is an orphan object of at most a few
 * hundred KB.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await guardPublicSubmission(request, 'feedback-upload');
    if (limited) return limited;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Send the image as multipart/form-data with a "file" field' }, { status: 400 });
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted' }, { status: 400 });
    }
    if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
      return NextResponse.json({
        error: `Image too large: ${file.size} bytes received, maximum ${MAX_FEEDBACK_IMAGE_BYTES}`,
        max_bytes: MAX_FEEDBACK_IMAGE_BYTES,
        received_bytes: file.size,
      }, { status: 400 });
    }

    const input = Buffer.from(await file.arrayBuffer());
    // .rotate() with no args applies EXIF orientation, so a phone photo of a
    // page comes out upright — and then the EXIF itself is not carried over.
    const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(FEEDBACK_IMAGE_MAX_EDGE, FEEDBACK_IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });

    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    const { url } = await storagePut(feedbackImageKey(hash), data, { contentType: 'image/webp' });

    return NextResponse.json({ url, width: info.width, height: info.height, bytes: data.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload image';
    console.error('[feedback/upload] error:', message);
    // Sharp throws on non-image bytes and truncated files — the reader picked a
    // bad file, not a server fault. Same split as /api/me/avatar.
    const status = /unsupported image|input buffer|input file|corrupt|premature|too large/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? 'That file could not be read as an image' : message }, { status });
  }
}
