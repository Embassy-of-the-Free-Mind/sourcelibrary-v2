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
