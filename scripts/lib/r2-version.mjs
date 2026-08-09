/**
 * r2-version — application-level object versioning for R2 (#3756 "everything
 * versions").
 *
 * R2 has no S3-style bucket versioning, so an overwrite is a destruction.
 * That's usually fine for the pipeline's forward writes (the source library
 * still holds the original), but REPAIR paths overwrite images we may want
 * to compare against later — and the photo_original lesson says never
 * overwrite an archive without keeping a way back.
 *
 * preserveObjectVersion() copies the current object to
 *   versions/<original-key>.<unix-ts>
 * before an overwrite. NoSuchKey (first write) is silently fine. Failures
 * WARN and return false but never block the write — versioning must not make
 * repairs fragile; the caller decides whether to proceed.
 *
 * Adopt in: repair scripts that overwrite archived/* or pages/* objects.
 * Not wired into bulk forward-archiving (doubling writes on 19M pages is a
 * cost decision, and the source still holds those originals).
 */

import { CopyObjectCommand } from '@aws-sdk/client-s3';

export async function preserveObjectVersion(s3, bucket, key) {
  const versionKey = `versions/${key}.${Math.floor(Date.now() / 1000)}`;
  try {
    await s3.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
      Key: versionKey,
    }));
    return versionKey;
  } catch (err) {
    const code = err?.name || err?.Code || '';
    if (/NoSuchKey|NotFound/i.test(String(code))) return null; // first write — nothing to version
    console.warn(`  [r2-version] could not preserve ${key}: ${String(err?.message || err).slice(0, 100)}`);
    return false;
  }
}
