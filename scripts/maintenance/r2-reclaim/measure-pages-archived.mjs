/**
 * Pass 1 (display bloat) + Pass 2 (byte-identical full-res duplicates).
 *
 * Both need the same two prefixes joined by (bookId, pageNum), so we do ONE
 * streaming merge-join of `pages/` and `archived/` — constant memory (one book
 * at a time), no per-object HEADs. Read-only.
 *
 *   Pass 1: a `pages/{id}/{NNNN}.jpg` (display) whose size is >= RATIO of its
 *           master (`-full` if present else `archived/{id}/{N}.jpg`) was never
 *           downsized. Manifest = regeneration candidates (NOT deletes).
 *   Pass 2: `pages/{id}/{NNNN}-full.jpg` and `archived/{id}/{N}.jpg` with equal
 *           ETag (or size within 2%) are byte-identical. Manifest = one copy is
 *           redundant; deletion decision is per-page (which key the reader's
 *           pointer resolves through) and is left for the sign-off/repoint step.
 *
 * Usage: set -a; source .env.production.local; set +a;
 *        node scripts/maintenance/r2-reclaim/measure-pages-archived.mjs
 */
import {
  makeS3, bookGroups, mergeBookGroups, NdjsonWriter, outPath, human,
} from './lib.mjs';
import fs from 'node:fs';

const RATIO = Number(process.env.BLOAT_RATIO || 0.9); // display >= 90% of master = "not downsized"
const TARGET_KB = Number(process.env.DISPLAY_TARGET_KB || 220); // expected size of a true 1200px display
const DUP_SIZE_TOL = 0.02;
const SHARD_CONCURRENCY = Number(process.env.SHARD_CONCURRENCY || 24);

const s3 = makeS3();

// Shard the crawl by the first 3 hex chars of the bookId (4096 shards) run
// through a concurrency pool. bookIds are lowercase-hex-ish (UUIDs + ObjectIds,
// the latter clustered in the 6xx- range), so 3-char sharding parallelizes ~24×
// AND balances the heavy ObjectId cluster across 256 sub-buckets (near-uniform
// work per active worker). Empty prefixes cost one fast 0-key list. Each shard
// is an independent merge-join writing its own manifest parts; concat at the end.
const HEX = '0123456789abcdef';
const SHARDS = [];
for (const a of HEX) for (const b of HEX) for (const d of HEX) SHARDS.push(a + b + d);
// ONLY_SHARDS=6a,6b restricts the crawl (smoke tests / resume of a subset).
if (process.env.ONLY_SHARDS) {
  const only = new Set(process.env.ONLY_SHARDS.split(',').map((x) => x.trim()));
  SHARDS.length = 0;
  for (const p of only) SHARDS.push(p);
}

const s = {
  books: 0,
  pagesObjs: 0, archivedObjs: 0,
  pagesBytes: 0, archivedBytes: 0,
  displayN: 0, displayBytes: 0,
  fullN: 0, fullBytes: 0,
  thumbN: 0, thumbBytes: 0,
  otherPagesN: 0, otherPagesBytes: 0, // BPH sp*, unexpected shapes
  // Pass 1
  bloatN: 0, bloatCurrentBytes: 0, bloatMasterBytes: 0, bloatReclaimEst: 0,
  // Pass 2
  dupPairs: 0, dupEtagMatch: 0, dupSizeNear: 0, dupReclaimBytes: 0,
  fullWithArchived: 0,
};

let lastLog = Date.now();
let shardsDone = 0;
function progress() {
  if (Date.now() - lastLog < 15000) return;
  lastLog = Date.now();
  process.stderr.write(
    `[${new Date().toISOString()}] shards ${shardsDone}/${SHARDS.length} ` +
    `books=${s.books} pagesObjs=${s.pagesObjs} archivedObjs=${s.archivedObjs} ` +
    `bloat=${s.bloatN} dup=${s.dupPairs}\n`,
  );
}

function parsePages(entries) {
  const map = new Map(); // pageNum -> {display, full, thumb}
  for (const e of entries) {
    s.pagesObjs++; s.pagesBytes += e.size;
    let m;
    if ((m = e.file.match(/^(\d{4,})-full\.jpg$/))) {
      const n = parseInt(m[1], 10);
      const p = map.get(n) || {}; p.full = e; map.set(n, p);
      s.fullN++; s.fullBytes += e.size;
    } else if ((m = e.file.match(/^(\d{4,})-thumb\.jpg$/))) {
      const n = parseInt(m[1], 10);
      const p = map.get(n) || {}; p.thumb = e; map.set(n, p);
      s.thumbN++; s.thumbBytes += e.size;
    } else if ((m = e.file.match(/^(\d{4,})\.jpg$/))) {
      const n = parseInt(m[1], 10);
      const p = map.get(n) || {}; p.display = e; map.set(n, p);
      s.displayN++; s.displayBytes += e.size;
    } else {
      // BPH sp*, spdm*, or anything unexpected — count, don't analyze
      s.otherPagesN++; s.otherPagesBytes += e.size;
    }
  }
  return map;
}

function parseArchived(entries) {
  const map = new Map(); // pageNum -> entry
  for (const e of entries) {
    s.archivedObjs++; s.archivedBytes += e.size;
    const m = e.file.match(/^(\d+)\.jpg$/);
    if (!m) continue;
    map.set(parseInt(m[1], 10), e);
  }
  return map;
}

function detect(bookId, pmap, amap, bloatW, dupW) {
  for (const [n, p] of pmap) {
    const master = p.full || amap.get(n);
    // Pass 1: display never downsized
    if (p.display && master && p.display.size > master.size * RATIO) {
      s.bloatN++;
      s.bloatCurrentBytes += p.display.size;
      s.bloatMasterBytes += master.size;
      const reclaim = Math.max(0, p.display.size - TARGET_KB * 1024);
      s.bloatReclaimEst += reclaim;
      bloatW.write({
        bookId, page: n,
        displayKey: p.display.key, displaySize: p.display.size,
        masterKey: master.key, masterSize: master.size,
        ratio: +(p.display.size / master.size).toFixed(3),
        reclaimEst: reclaim,
      });
    }
    // Pass 2: byte-identical -full vs archived
    if (p.full && amap.has(n)) {
      const a = amap.get(n);
      s.fullWithArchived++;
      const etagMatch = p.full.etag && a.etag && p.full.etag === a.etag;
      const sizeNear = Math.abs(p.full.size - a.size) <= Math.max(p.full.size, a.size) * DUP_SIZE_TOL;
      if (etagMatch || sizeNear) {
        s.dupPairs++;
        if (etagMatch) s.dupEtagMatch++;
        if (sizeNear) s.dupSizeNear++;
        s.dupReclaimBytes += Math.min(p.full.size, a.size);
        dupW.write({
          bookId, page: n,
          fullKey: p.full.key, fullSize: p.full.size, fullEtag: p.full.etag,
          archivedKey: a.key, archivedSize: a.size, archivedEtag: a.etag,
          etagMatch: !!etagMatch, sizeNear,
        });
      }
    }
  }
}

async function runShard(prefix) {
  const bloatW = new NdjsonWriter(outPath(`.part-bloat-${prefix}.ndjson`));
  const dupW = new NdjsonWriter(outPath(`.part-dup-${prefix}.ndjson`));
  const pagesGen = bookGroups(s3, `pages/${prefix}`, { basePrefix: 'pages/', onPage: progress });
  const archGen = bookGroups(s3, `archived/${prefix}`, { basePrefix: 'archived/', onPage: progress });
  await mergeBookGroups(pagesGen, archGen, (bookId, pagesEntries, archEntries) => {
    s.books++;
    detect(bookId, parsePages(pagesEntries), parseArchived(archEntries), bloatW, dupW);
  });
  bloatW.close();
  dupW.close();
  shardsDone++;
}

// Pool the shards.
{
  let idx = 0;
  await Promise.all(Array.from({ length: SHARD_CONCURRENCY }, async () => {
    while (idx < SHARDS.length) {
      const prefix = SHARDS[idx++];
      await runShard(prefix);
    }
  }));
}

// Concat shard manifest parts into the canonical files, then clean up.
for (const [glob, out] of [['bloat', 'manifest-display-bloat.ndjson'], ['dup', 'manifest-full-dup.ndjson']]) {
  const outFd = fs.openSync(outPath(out), 'w');
  for (const prefix of SHARDS) {
    const part = outPath(`.part-${glob}-${prefix}.ndjson`);
    if (fs.existsSync(part)) {
      const data = fs.readFileSync(part);
      if (data.length) fs.writeSync(outFd, data);
      fs.unlinkSync(part);
    }
  }
  fs.closeSync(outFd);
}

const summary = {
  measured_at: new Date().toISOString(),
  config: { RATIO, TARGET_KB, DUP_SIZE_TOL },
  crawl: {
    books: s.books,
    pages_objects: s.pagesObjs, pages_bytes: s.pagesBytes, pages_human: human(s.pagesBytes),
    archived_objects: s.archivedObjs, archived_bytes: s.archivedBytes, archived_human: human(s.archivedBytes),
    display: { n: s.displayN, bytes: s.displayBytes, human: human(s.displayBytes) },
    full: { n: s.fullN, bytes: s.fullBytes, human: human(s.fullBytes) },
    thumb: { n: s.thumbN, bytes: s.thumbBytes, human: human(s.thumbBytes) },
    other_pages: { n: s.otherPagesN, bytes: s.otherPagesBytes, human: human(s.otherPagesBytes) },
  },
  pass1_display_bloat: {
    candidates: s.bloatN,
    pct_of_displays: s.displayN ? +(100 * s.bloatN / s.displayN).toFixed(1) : 0,
    current_bytes: s.bloatCurrentBytes, current_human: human(s.bloatCurrentBytes),
    reclaim_est_bytes: s.bloatReclaimEst, reclaim_est_human: human(s.bloatReclaimEst),
    manifest: 'manifest-display-bloat.ndjson',
    note: 'Regeneration candidates (re-resize to ~1200px). NOT deletes.',
  },
  pass2_full_dup: {
    full_with_archived_counterpart: s.fullWithArchived,
    duplicate_pairs: s.dupPairs,
    etag_identical: s.dupEtagMatch,
    size_within_2pct: s.dupSizeNear,
    reclaim_bytes: s.dupReclaimBytes, reclaim_human: human(s.dupReclaimBytes),
    manifest: 'manifest-full-dup.ndjson',
    note: 'One copy of each pair is redundant. Which key to delete is per-page (reader pointer); resolve in the repoint step. Enrich with pointers via enrich-full-dup-pointers.mjs before deleting.',
  },
};
fs.writeFileSync(outPath('summary-pages-archived.json'), JSON.stringify(summary, null, 2));
process.stderr.write('\nDONE\n');
console.log(JSON.stringify(summary, null, 2));
