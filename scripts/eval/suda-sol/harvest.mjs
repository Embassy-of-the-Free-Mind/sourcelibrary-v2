// SOL (Suda On Line) polite harvester — issue #3884
// Fetches every entry page under cs.uky.edu/~raphael/sol/sol-entries/ to raw/<letter>/<n>.html
// Sequential, ~4 req/sec max, resumable (skips files that already exist).
// Run: nohup node harvest.mjs > harvest.log 2>&1 & disown
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://www.cs.uky.edu/~raphael/sol/sol-entries/';
const OUT = path.join(process.env.SOL_DATA_DIR ?? 'scripts/output/sol-harvest', 'raw');
const UA = 'SourceLibrary-research-harvest/1.0 (sourcelibrary.org; contact derek@playpowerlabs.com; single-thread, throttled)';
const DELAY_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null; // gaps in Adler numbering are normal
      console.log(`HTTP ${res.status} on ${url} (try ${i + 1})`);
    } catch (e) {
      console.log(`ERR ${e.message} on ${url} (try ${i + 1})`);
    }
    await sleep(2000 * (i + 1));
  }
  return null;
}

const index = await get(BASE);
if (!index) { console.error('FATAL: cannot fetch letter index'); process.exit(1); }
const letters = [...index.matchAll(/href="([a-z]+)\.html"/g)].map((m) => m[1]);
console.log(`letters: ${letters.length}: ${letters.join(' ')}`);

let fetched = 0, skipped = 0, missing = 0;
for (const letter of letters) {
  const letterIdx = await get(`${BASE}${letter}.html`);
  if (!letterIdx) { console.log(`WARN: no index for ${letter}`); continue; }
  const nums = [...letterIdx.matchAll(new RegExp(`href="${letter}/([0-9]+)"`, 'g'))].map((m) => m[1]);
  await mkdir(path.join(OUT, letter), { recursive: true });
  console.log(`${letter}: ${nums.length} entries`);
  for (const n of nums) {
    const file = path.join(OUT, letter, `${n}.html`);
    if (await access(file).then(() => true, () => false)) { skipped++; continue; }
    const html = await get(`${BASE}${letter}/${n}`);
    if (html === null) { missing++; console.log(`MISSING ${letter}/${n}`); continue; }
    await writeFile(file, html);
    fetched++;
    if (fetched % 100 === 0) console.log(`progress: ${fetched} fetched, ${skipped} skipped, ${missing} missing (${letter}/${n})`);
    await sleep(DELAY_MS);
  }
}
console.log(`DONE: ${fetched} fetched, ${skipped} skipped, ${missing} missing`);
