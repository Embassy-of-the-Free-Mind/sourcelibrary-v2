import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Browser-proxied image ingest — mirror one page image into R2 and wire it onto
 * the page doc. Built for sources whose IIIF images are reachable only from a
 * real browser (Gallica/BnF blocks datacenter fetches at the Cloudflare edge, so
 * /api/import/gallica and the Hetzner archiver both 403). A logged-in operator
 * runs an in-browser loop that fetches each page from the source origin (where it
 * holds Cloudflare clearance) and POSTs the bytes here; this route resizes and
 * uploads to R2 server-side, sidestepping both the source block and R2 CORS.
 *
 * POST /api/admin/ingest-image?bookId=<id>&page=<n>
 *   Authorization: Bearer <CRON_SECRET>
 *   body: raw JPEG/PNG bytes (Content-Type: image/jpeg)
 *
 * CORS is open (ACAO *) because auth is a bearer token, not a cookie — so a
 * cross-origin browser POST needs no credentials. The token gates all writes.
 */

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  // Prefer a dedicated, scoped INGEST_TOKEN (so operators never expose CRON_SECRET
  // in a browser call); fall back to CRON_SECRET for server-side/cron use. Inert
  // (503) unless at least one is configured.
  const auth = req.headers.get('authorization') || '';
  const ingestTok = process.env.INGEST_TOKEN;
  const cronTok = process.env.CRON_SECRET;
  if (!ingestTok && !cronTok) {
    return NextResponse.json({ error: 'ingest disabled (no token configured)' }, { status: 503, headers: CORS });
  }
  const ok = (ingestTok && auth === `Bearer ${ingestTok}`) || (cronTok && auth === `Bearer ${cronTok}`);
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: CORS });
  }

  const { searchParams } = new URL(req.url);
  const bookId = searchParams.get('bookId');
  const page = parseInt(searchParams.get('page') || '', 10);
  if (!bookId || !Number.isFinite(page) || page < 1) {
    return NextResponse.json({ error: 'bookId and page (>=1) required' }, { status: 400, headers: CORS });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length < 1000) {
    return NextResponse.json({ error: 'image too small / empty' }, { status: 400, headers: CORS });
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const base = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
  if (!accountId || !bucket || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    return NextResponse.json({ error: 'R2 env not configured' }, { status: 500, headers: CORS });
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const padded = String(page).padStart(4, '0');
  const archivedKey = `archived/${bookId}/${page}.jpg`;
  const displayKey = `pages/${bookId}/${padded}.jpg`;
  const thumbKey = `pages/${bookId}/${padded}-thumb.jpg`;

  let archivedBuf: Buffer, displayBuf: Buffer, thumbBuf: Buffer;
  try {
    archivedBuf = await sharp(buf).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    displayBuf = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    thumbBuf = await sharp(buf).rotate().resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  } catch (e) {
    return NextResponse.json({ error: `decode failed: ${String(e)}` }, { status: 400, headers: CORS });
  }

  const put = (Key: string, Body: Buffer) =>
    s3.send(new PutObjectCommand({
      Bucket: bucket, Key, Body, ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  await Promise.all([put(archivedKey, archivedBuf), put(displayKey, displayBuf), put(thumbKey, thumbBuf)]);

  const archived_photo = `${base}/${archivedKey}`;
  const display_photo = `${base}/${displayKey}`;
  const thumbnail = `${base}/${thumbKey}`;

  const db = await getDb();
  const r = await db.collection('pages').updateOne(
    { book_id: bookId, page_number: page },
    { $set: { archived_photo, display_photo, thumbnail, updated_at: new Date() } }
  );

  return NextResponse.json(
    { ok: true, page, matched: r.matchedCount, modified: r.modifiedCount, display_photo, archived_photo },
    { headers: CORS }
  );
}
