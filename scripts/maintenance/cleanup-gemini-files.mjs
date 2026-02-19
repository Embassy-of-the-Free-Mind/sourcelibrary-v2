#!/usr/bin/env node
/**
 * Delete all uploaded files from the Gemini File API to free storage quota.
 * Usage: secret-lover run -- node scripts/cleanup-gemini-files.mjs
 */

const API_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY,
].filter(Boolean);

async function cleanupKey(apiKey, label) {
  let totalDeleted = 0;
  let totalBytes = 0;
  let pageToken = '';

  while (true) {
    const url = `https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}&pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url);
    if (res.status !== 200) {
      console.log(`  List error: ${res.status}`);
      break;
    }
    const data = await res.json();
    const files = data.files || [];
    if (files.length === 0) break;

    console.log(`  Found ${files.length} files, deleting...`);
    for (const f of files) {
      totalBytes += parseInt(f.sizeBytes || '0');
      const del = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${f.name}?key=${apiKey}`,
        { method: 'DELETE' }
      );
      if (del.ok) totalDeleted++;
      else console.log(`  Failed to delete ${f.name}: ${del.status}`);
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  console.log(`  Deleted ${totalDeleted} files (${(totalBytes / 1024 / 1024 / 1024).toFixed(2)}GB)`);
  return { deleted: totalDeleted, bytes: totalBytes };
}

async function main() {
  console.log('Cleaning up Gemini File API storage...');
  let grandTotal = 0;

  for (let i = 0; i < API_KEYS.length; i++) {
    const key = API_KEYS[i];
    const prefix = key.substring(0, 10);
    console.log(`\nKey ${i + 1} (${prefix}...):`);
    const { bytes } = await cleanupKey(key, `key-${i + 1}`);
    grandTotal += bytes;
  }

  console.log(`\nTotal freed: ${(grandTotal / 1024 / 1024 / 1024).toFixed(2)}GB`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
