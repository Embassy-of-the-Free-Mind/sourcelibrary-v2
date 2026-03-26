/**
 * Storage abstraction — Cloudflare R2 (primary) with Vercel Blob fallback
 *
 * Drop-in replacement for @vercel/blob `put()`. All callers should use
 * `storagePut()` instead of `put()` from @vercel/blob.
 *
 * R2 is used when R2_* env vars are configured; otherwise falls back to
 * Vercel Blob so dev/preview environments keep working without R2 setup.
 *
 * Env vars for R2:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME, R2_PUBLIC_URL (e.g., https://images.sourcelibrary.org)
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// --- R2 client (lazy singleton) ---

let _r2Client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (_r2Client) return _r2Client;

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;

  _r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return _r2Client;
}

function getR2BucketName(): string {
  return process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
}

function getR2PublicUrl(): string {
  return process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
}

export function isR2Configured(): boolean {
  return getR2Client() !== null;
}

// --- Public API ---

export interface StoragePutOptions {
  access?: 'public';
  contentType?: string;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
}

export interface StoragePutResult {
  url: string;
  pathname: string;
}

/**
 * Upload a file to storage (R2 if configured, Vercel Blob otherwise).
 *
 * Returns { url, pathname } matching the shape callers expect from @vercel/blob.
 */
export async function storagePut(
  pathname: string,
  body: Buffer | Uint8Array | ReadableStream,
  options: StoragePutOptions = {}
): Promise<StoragePutResult> {
  const r2 = getR2Client();

  if (r2) {
    return r2Put(r2, pathname, body, options);
  }

  // R2 not configured — this should not happen in production
  console.warn('[storage] WARNING: R2 not configured, falling back to Vercel Blob. This costs money — check R2 env vars.');

  // Fallback to Vercel Blob
  const { put } = await import('@vercel/blob');
  const blob = await put(pathname, Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array), {
    access: options.access || 'public',
    contentType: options.contentType,
    addRandomSuffix: options.addRandomSuffix ?? false,
    allowOverwrite: options.allowOverwrite,
  });
  return { url: blob.url, pathname: blob.pathname };
}

// --- Path helpers ---
// Standard R2 path convention. All image storage should use these.
// Given bookId + pageNumber, URLs are fully predictable without DB lookups.

/** Page image paths — pages/{bookId}/{0001}.jpg, pages/{bookId}/{0001}-full.jpg, etc. */
export function pagePaths(bookId: string, pageNumber: number) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return {
    full: `${base}-full.jpg`,       // full-res original (OCR, zoom, download)
    display: `${base}.jpg`,          // 1200px wide (browser display)
    thumb: `${base}-thumb.jpg`,      // 150px (browse grids, search)
  };
}

/** Gallery image paths — gallery/{bookId}/{imageId}.jpg, etc. */
export function galleryPaths(bookId: string, imageId: string) {
  const base = `gallery/${bookId}/${imageId}`;
  return {
    full: `${base}-full.jpg`,
    display: `${base}.jpg`,
    thumb: `${base}-thumb.jpg`,
  };
}

/** Book cover path */
export function coverPath(bookId: string) {
  return `covers/${bookId}.jpg`;
}

/** Convert an R2 key to its public URL */
export function r2Url(key: string): string {
  return `${getR2PublicUrl()}/${key}`;
}

async function r2Put(
  client: S3Client,
  pathname: string,
  body: Buffer | Uint8Array | ReadableStream,
  options: StoragePutOptions
): Promise<StoragePutResult> {
  // Normalize pathname (strip leading slash)
  const key = pathname.replace(/^\//, '');

  await client.send(new PutObjectCommand({
    Bucket: getR2BucketName(),
    Key: key,
    Body: body instanceof ReadableStream
      ? Buffer.from(await new Response(body).arrayBuffer())
      : body,
    ContentType: options.contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));

  const url = `${getR2PublicUrl()}/${key}`;
  return { url, pathname: key };
}
