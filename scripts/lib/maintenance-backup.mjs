// PRIOR ART: scripts/lib/candidate-reads.mjs — the private-bucket R2 client this reuses the shape of (its keys are
// book-scoped reads, not files); scripts/maintenance/backups/ — where backups have lived, on one box's disk only, which
// is what this replaces for a run that writes production (Derek, 2026-10-28, #7660).
/**
 * Put a maintenance run's backup files in the PRIVATE bucket as well as on the box:
 *   s3://sl-corpus-snapshots/maintenance-backups/<YYYY-MM-DD>-<run>/<file name>
 * A box disk is one `rm` or one reimage from losing the only copy of what a sweep replaced.
 *
 *   import { uploadBackup } from './maintenance-backup.mjs';
 *   await uploadBackup('/root/jobs/x/backup.json', 'authors-7660');          // -> { key, bytes }
 *
 *   node --env-file=.env.production.local scripts/lib/maintenance-backup.mjs <run> <file>...   # CLI
 *
 * Overwrites an object of the same key (a merged backup grows between runs). Throws on any failure: a caller that
 * needs the backup off the box should not proceed as if it were.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUCKET = 'sl-corpus-snapshots';
export const PREFIX = 'maintenance-backups';

let s3 = null, sdk = null;
async function client() {
  if (s3) return s3;
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) throw new Error(`${k} is not set`);
  sdk = await import('@aws-sdk/client-s3');
  s3 = new sdk.S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  return s3;
}

/** The object key for one backup file of one run. */
export function backupKey(run, file, date = new Date()) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(run)) throw new Error(`bad run name ${JSON.stringify(run)}`);
  return `${PREFIX}/${date.toISOString().slice(0, 10)}-${run}/${path.basename(file)}`;
}

/** Upload one local file. Resolves { key, bytes }. */
export async function uploadBackup(file, run, { date = new Date() } = {}) {
  const body = fs.readFileSync(file);
  const c = await client();
  const key = backupKey(run, file, date);
  await c.send(new sdk.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: file.endsWith('.json') ? 'application/json' : 'application/octet-stream' }),
    { abortSignal: AbortSignal.timeout(300_000) });
  return { key, bytes: body.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [run, ...files] = process.argv.slice(2);
  if (!run || !files.length) { console.error('usage: maintenance-backup.mjs <run> <file>...'); process.exit(2); }
  for (const f of files) {
    const r = await uploadBackup(f, run);
    console.log(`s3://${BUCKET}/${r.key}  ${r.bytes} bytes`);
  }
}
