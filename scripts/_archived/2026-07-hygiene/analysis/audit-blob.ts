import { list } from '@vercel/blob';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function listWithRetry(cursor: string | undefined) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await list({ cursor, limit: 1000 });
    } catch (e: any) {
      const wait = (e.retryAfter || 30) * 1000 + 2000;
      process.stderr.write(`  Rate limited, waiting ${wait/1000}s...\n`);
      await sleep(wait);
    }
  }
  throw new Error('Too many retries');
}

async function audit() {
  const prefixes: Record<string, { count: number; bytes: number }> = {};
  let cursor: string | undefined;
  let totalBlobs = 0;
  let page = 0;

  do {
    const result = await listWithRetry(cursor);
    page++;
    for (const blob of result.blobs) {
      totalBlobs++;
      const prefix = blob.pathname.split('/')[0] || 'root';
      if (!prefixes[prefix]) prefixes[prefix] = { count: 0, bytes: 0 };
      prefixes[prefix].count++;
      prefixes[prefix].bytes += blob.size;
    }
    if (page % 50 === 0) {
      process.stderr.write(`  ...listed ${totalBlobs.toLocaleString()} blobs so far\n`);
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  console.log('\n=== Vercel Blob Storage Audit ===\n');
  let totalBytes = 0;
  for (const [prefix, stats] of Object.entries(prefixes).sort((a, b) => b[1].bytes - a[1].bytes)) {
    const mb = (stats.bytes / 1024 / 1024).toFixed(1);
    const gb = (stats.bytes / 1024 / 1024 / 1024).toFixed(2);
    console.log(`${prefix.padEnd(20)}: ${stats.count.toLocaleString().padStart(8)} blobs, ${mb.padStart(10)} MB (${gb} GB)`);
    totalBytes += stats.bytes;
  }
  const totalGB = (totalBytes / 1024 / 1024 / 1024).toFixed(2);
  console.log(`\n${'TOTAL'.padEnd(20)}: ${totalBlobs.toLocaleString().padStart(8)} blobs, ${(totalBytes / 1024 / 1024).toFixed(1).padStart(10)} MB (${totalGB} GB)`);
}

audit().catch(console.error);
