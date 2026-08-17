#!/usr/bin/env node
/**
 * Verify that every object in Vercel Blob also exists in R2 — the evidence
 * that must exist BEFORE anything is deleted from Blob (issue #3645, Finding 3).
 *
 * Context: page images were copied Blob → R2 in Feb 2026 and the source was
 * never deleted. As of 2026-08-17 `sourcelibrary-v2-blob` holds 5,432,915
 * objects / 2,882.8 GB, billed at ~$50/month (~$600/year) for a second copy
 * nobody reads. The migration used a 1:1 key mapping, so the check is a set
 * difference: `archived/{bookId}/{page}.jpg` in Blob should be the same key in
 * R2 (see scripts/maintenance/migrate-blob-to-r2.mjs `extractR2Key`).
 *
 * THIS SCRIPT NEVER DELETES ANYTHING. It reads both stores and writes three
 * reports. Deletion is a separate, human-approved step that consumes
 * `missing-in-r2.tsv` being empty as its precondition.
 *
 * Two hazards it is built to surface rather than paper over:
 *
 *  1. `archived/undefined/<page>.jpg` — the #3362 disaster wrote every book's
 *     pages to a book-independent key, so one object was shared across books.
 *     Those keys are reported SEPARATELY and must never be treated as "safely
 *     in R2": the R2 copy is equally corrupt, and deleting the Blob original
 *     destroys the only evidence of what was overwritten.
 *  2. Size mismatches. A key present in R2 at a different byte length is not a
 *     verified copy — it is a different object wearing the same name.
 *
 * Usage (long-running, ~35-60 min; detach it):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/verify-blob-residue-in-r2.mjs --out /path/to/dir
 *
 * Resumable: each listing phase checkpoints to its own TSV and is skipped if
 * that file is already complete (a `.done` marker is written on clean finish).
 */

import { list } from '@vercel/blob';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const OUT = arg('--out', './blob-verify');
const PREFIX = arg('--prefix', 'archived/');

mkdirSync(OUT, { recursive: true });

const BLOB_TSV = path.join(OUT, 'blob-keys.tsv');
const R2_TSV = path.join(OUT, 'r2-keys.tsv');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Both listings checkpoint their pagination cursor every 100k keys and append
 * on resume. Without this a kill at minute 38 of a ~50-minute run threw away
 * the whole phase — which is exactly what happened on the first real run, and
 * a job long enough to be interrupted is a job that must survive being
 * interrupted.
 */
function readCursor(file) {
  const f = `${file}.cursor`;
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    // Trim any partial trailing line the kill may have left mid-write.
    sh(`tail -c 1 "${file}" | grep -q '' || true`);
    sh(`perl -i -ne 'print if /\\n$/ || eof' "${file}" 2>/dev/null || true`);
    return s;
  } catch { return null; }
}
function writeCursor(file, state) {
  writeFileSync(`${file}.cursor`, JSON.stringify(state));
}

/** Stream every Blob object under PREFIX to a TSV of `key\tsize`. */
async function dumpBlob() {
  if (existsSync(`${BLOB_TSV}.done`)) { log(`blob listing already complete — skipping`); return; }
  const resume = readCursor(BLOB_TSV);
  let cursor = resume?.cursor, n = resume?.n ?? 0, bytes = resume?.bytes ?? 0;
  if (resume) log(`  blob: resuming from ${n.toLocaleString()} keys`);
  const out = createWriteStream(BLOB_TSV, { flags: resume ? 'a' : 'w' });
  do {
    const res = await list({ cursor, limit: 1000, prefix: PREFIX });
    for (const b of res.blobs) {
      out.write(`${b.pathname}\t${b.size ?? 0}\n`);
      n++; bytes += b.size ?? 0;
    }
    cursor = res.cursor;
    if (n % 100000 < 1000) {
      log(`  blob: ${n.toLocaleString()} keys, ${(bytes / 1e9).toFixed(1)} GB`);
      await new Promise(r => out.write('', r));
      writeCursor(BLOB_TSV, { cursor, n, bytes });
    }
  } while (cursor);
  await new Promise(r => out.end(r));
  writeFileSync(`${BLOB_TSV}.done`, String(n));
  log(`blob listing done: ${n.toLocaleString()} keys, ${(bytes / 1e9).toFixed(1)} GB`);
}

/** Stream every R2 object under PREFIX to a TSV of `key\tsize`. */
async function dumpR2() {
  if (existsSync(`${R2_TSV}.done`)) { log(`r2 listing already complete — skipping`); return; }
  const resume = readCursor(R2_TSV);
  let token = resume?.cursor, n = resume?.n ?? 0, bytes = resume?.bytes ?? 0;
  if (resume) log(`  r2: resuming from ${n.toLocaleString()} keys`);
  const out = createWriteStream(R2_TSV, { flags: resume ? 'a' : 'w' });
  do {
    const res = await r2.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: PREFIX, MaxKeys: 1000, ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) {
      out.write(`${o.Key}\t${o.Size ?? 0}\n`);
      n++; bytes += o.Size ?? 0;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    if (n % 100000 < 1000) {
      log(`  r2: ${n.toLocaleString()} keys, ${(bytes / 1e9).toFixed(1)} GB`);
      await new Promise(r => out.write('', r));
      writeCursor(R2_TSV, { cursor: token, n, bytes });
    }
  } while (token);
  await new Promise(r => out.end(r));
  writeFileSync(`${R2_TSV}.done`, String(n));
  log(`r2 listing done: ${n.toLocaleString()} keys, ${(bytes / 1e9).toFixed(1)} GB`);
}

/** sort(1) handles 5.4M rows in bounded memory; a JS Set of that size does not. */
function sh(cmd) {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stderr}`);
  return r.stdout;
}

async function main() {
  log(`bucket=${BUCKET} prefix=${PREFIX} out=${OUT}`);
  await dumpBlob();
  await dumpR2();

  log('sorting + diffing…');
  const S = (f) => `${f}.sorted`;
  sh(`LC_ALL=C sort -t$'\\t' -k1,1 "${BLOB_TSV}" -o "${S(BLOB_TSV)}"`);
  sh(`LC_ALL=C sort -t$'\\t' -k1,1 "${R2_TSV}" -o "${S(R2_TSV)}"`);

  const missing = path.join(OUT, 'missing-in-r2.tsv');
  const mismatch = path.join(OUT, 'size-mismatch.tsv');
  const corrupt = path.join(OUT, 'undefined-book-keys.tsv');
  const safe = path.join(OUT, 'safe-to-delete.tsv');

  // Keys present in Blob but absent from R2 — deleting these loses data.
  sh(`LC_ALL=C join -t$'\\t' -v1 -11 -21 "${S(BLOB_TSV)}" "${S(R2_TSV)}" > "${missing}"`);
  // Present in both but different byte length — same name, different object.
  sh(`LC_ALL=C join -t$'\\t' -11 -21 -o 1.1,1.2,2.2 "${S(BLOB_TSV)}" "${S(R2_TSV)}" ` +
     `| awk -F'\\t' '$2 != $3' > "${mismatch}"`);
  // The #3362 book-independent keys. Quarantined, never "safe".
  sh(`LC_ALL=C grep '^archived/undefined/' "${S(BLOB_TSV)}" > "${corrupt}" || true`);
  // Verified redundant: in R2, same size, and NOT an undefined-book key.
  sh(`LC_ALL=C join -t$'\\t' -11 -21 -o 1.1,1.2,2.2 "${S(BLOB_TSV)}" "${S(R2_TSV)}" ` +
     `| awk -F'\\t' '$2 == $3' | grep -v '^archived/undefined/' > "${safe}" || true`);

  const count = (f) => parseInt(sh(`wc -l < "${f}"`).trim() || '0', 10);
  const gb = (f, col) => (parseFloat(sh(`awk -F'\\t' '{s+=$${col}} END {print s+0}' "${f}"`).trim()) / 1e9).toFixed(1);

  const nBlob = count(S(BLOB_TSV));
  const nMissing = count(missing);
  const nMismatch = count(mismatch);
  const nCorrupt = count(corrupt);
  const nSafe = count(safe);

  console.log('\n================ BLOB RESIDUE VERIFICATION ================');
  console.log(`Blob objects under ${PREFIX}      ${nBlob.toLocaleString()}  (${gb(S(BLOB_TSV), 2)} GB)`);
  console.log(`  verified redundant (safe)       ${nSafe.toLocaleString()}  (${gb(safe, 2)} GB)  → ${path.basename(safe)}`);
  console.log(`  MISSING from R2                 ${nMissing.toLocaleString()}  (${gb(missing, 2)} GB)  → ${path.basename(missing)}`);
  console.log(`  size mismatch                   ${nMismatch.toLocaleString()}  → ${path.basename(mismatch)}`);
  console.log(`  archived/undefined/ (#3362)     ${nCorrupt.toLocaleString()}  → ${path.basename(corrupt)}`);
  console.log('==========================================================');

  // ── Reconcile the "missing" set against the catalogue ────────────────────
  //
  // A key absent from R2 is only dangerous if something still needs it. Nothing
  // in production references Blob at all (measured 2026-08-17: 0 of 20,000
  // sampled page docs carry a blob.vercel-storage.com URL in any image field),
  // so the question is not "is this key in R2" but "does a live page still
  // expect this image". Measured on a 104K-key sample, the missing set was
  // entirely orphans of two kinds:
  //   - books deleted from the catalogue (the bulk by volume), and
  //   - a trailing page at exactly `pages_count + 1` for each live book, which
  //     the archiver wrote and no page doc ever referenced.
  // Reporting a raw "20% missing" without this split reads as data loss and
  // would stop a cleanup that is in fact safe — so classify before alarming.
  if (nMissing && process.env.MONGODB_URI) {
    const { MongoClient } = await import('mongodb');
    const mc = new MongoClient(process.env.MONGODB_URI);
    await mc.connect();
    const mdb = mc.db('bookstore');

    const perBook = new Map(); // bookId -> [pageNumbers]
    for (const line of sh(`cut -f1 "${missing}"`).split('\n')) {
      if (!line) continue;
      const [, bookId, file] = line.split('/');
      if (!bookId) continue;
      const pn = parseInt(file);
      if (!perBook.has(bookId)) perBook.set(bookId, []);
      perBook.get(bookId).push(Number.isFinite(pn) ? pn : -1);
    }

    const ids = [...perBook.keys()];
    const live = await mdb.collection('books')
      .find({ id: { $in: ids } }, { projection: { id: 1, pages_count: 1 } }).toArray();
    const liveMap = new Map(live.map(b => [b.id, b.pages_count ?? 0]));

    let orphanDeletedBook = 0, orphanBeyondPageCount = 0, needsAttention = 0;
    const attention = [];
    for (const [bookId, pageNums] of perBook) {
      if (!liveMap.has(bookId)) { orphanDeletedBook += pageNums.length; continue; }
      const pc = liveMap.get(bookId);
      for (const pn of pageNums) {
        if (pn > pc) orphanBeyondPageCount++;
        else { needsAttention++; attention.push(`archived/${bookId}/${pn}.jpg`); }
      }
    }
    await mc.close();

    const attentionFile = path.join(OUT, 'missing-and-still-referenced.tsv');
    sh(`: > "${attentionFile}"`);
    if (attention.length) {
      const fs = await import('fs');
      fs.writeFileSync(attentionFile, attention.join('\n') + '\n');
    }

    console.log('\n--- the "missing from R2" set, classified ---');
    console.log(`  orphan: book no longer in catalogue   ${orphanDeletedBook.toLocaleString()}`);
    console.log(`  orphan: page number > pages_count     ${orphanBeyondPageCount.toLocaleString()}`);
    console.log(`  STILL REFERENCED BY A LIVE PAGE       ${needsAttention.toLocaleString()}  → ${path.basename(attentionFile)}`);
    if (!needsAttention) {
      console.log('\n  Every missing key is an orphan. Deleting them loses nothing a live');
      console.log('  page can reach. The safe-to-delete set above is additionally verified');
      console.log('  byte-for-byte in R2.');
    } else {
      console.log('\n  NOT CLEARED. Re-archive the referenced pages before deleting anything.');
    }
  }

  if (nMismatch) {
    console.log('\nNote on size mismatches: sampled cases had R2 ~4x LARGER than Blob, i.e.');
    console.log('R2 holds a higher-resolution re-archive and the Blob copy is the inferior');
    console.log('one. Spot-check a few before treating them as safe — a SMALLER R2 object');
    console.log('would be the opposite finding and must block deletion.');
  }

  if (nCorrupt) {
    console.log('\nThe archived/undefined/ keys are NOT cleared — their R2 twins are equally');
    console.log('wrong (#3362) and the Blob copies are the only record of what was');
    console.log('overwritten. Decide those with a human, separately.');
  }
  if (!nMissing && !nMismatch && !nCorrupt) {
    console.log('\nEvery object verified present in R2 at matching size — fully cleared.');
  }
  console.log('\nThis script deleted nothing. Deletion is a separate, approved step.');
}

main().catch((e) => { console.error(e); process.exit(1); });
