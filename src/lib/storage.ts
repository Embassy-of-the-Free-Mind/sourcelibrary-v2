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
import { validateR2Key } from './r2-key';

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
  // .trim() is load-bearing: a trailing "\n" in this env value once poisoned
  // 7,575 gallery_images rows with "https://images.sourcelibrary.org\n/..."
  // URLs (#4340, lesson_env_newline_phantom_sync_success). Browsers strip the
  // newline when parsing, so it shipped unnoticed; every non-browser consumer
  // got broken URLs.
  return (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').trim();
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
  // Reject undefined/null/empty path segments before anything reaches the bucket.
  // A missing interpolation (e.g. `pages/${page.book_id}/...` where book_id was
  // dropped by a projection) produces ONE object shared by every book — see #3362,
  // where that silently fed other books' page images to OCR for six days.
  validateR2Key(pathname, 'storagePut');

  const r2 = getR2Client();

  if (r2) {
    return r2Put(r2, pathname, body, options);
  }

  // R2 not configured. This used to fall through to Vercel Blob behind a
  // console.warn — which is a silent failure wearing a warning's clothes:
  // nothing reads server logs on the happy path, the write appears to succeed,
  // and the object lands in the store we are trying to retire while the row
  // records a blob.vercel-storage.com URL that no later R2 sweep will find.
  //
  // A misconfiguration must not be able to quietly resurrect the old backend.
  // Fail here instead: the caller sees a real error, and the fix (set the R2
  // env vars) is named in it.
  throw new Error(
    `[storage] R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / ` +
    `R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME) — refusing to write "${pathname}". ` +
    `Vercel Blob is retired (#3645); writing there costs money and strands the ` +
    `object outside R2. Set the R2 environment variables.`,
  );
}

// --- Path helpers ---
// Canonical R2 path convention. All NEW image storage must use these.
//
// Reality check: the corpus has accumulated six URL conventions across
// different eras. The canonical `pages/{bookId}/{NNNN}` shape below covers
// only ~7% of existing pages. The other 93% are still at legacy paths —
// dominantly `archived/{bookId}/{N}.jpg` (77%). Reader code in utils.ts
// rewrites those legacy URLs to the canonical shape at render time, but
// the rewrite is aspirational: it assumes the file exists at the canonical
// path, and for ~20% of pages it doesn't.
//
// See .claude/docs/r2-storage.md for the full path inventory, per-provider
// distribution, and link to the /admin/r2-coverage dashboard which measures
// the gap between record-level and file-level coverage.

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
