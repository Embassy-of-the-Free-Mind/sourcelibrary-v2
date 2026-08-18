#!/usr/bin/env node
/**
 * Check image URLs hardcoded in application source for 404s.
 *
 * Motivation: while rehosting the Vercel Blob URLs (#3645) one turned out to be
 * already 404 AT SOURCE — a broken composite photograph sitting on the live
 * cuneiform-ocr post. Nothing reports that. Images embedded in JSX are outside
 * every existing check: not in the database, so no data sweep sees them; not
 * links, so blog-link-check does not fetch them; and a broken <img> renders as
 * empty space rather than an error.
 *
 * Two populations, deliberately treated differently:
 *
 *   CODE  — pages, components, config: ~290 URLs an editor chose by hand. Every
 *           one is checked, and a single 404 fails the run. These are visible on
 *           a real page and someone is accountable for each.
 *   DATA  — src/data/image-constellation.json (35,482 URLs) and
 *           book-constellation.json (8,818): generated payloads for a
 *           visualisation. Checking 44k URLs on every CI run would cost more
 *           than it is worth and would rate-limit us against our own CDN, so a
 *           SAMPLE is taken and reported as a rate. Informational by default —
 *           a few dead covers in a starfield is a different problem from a dead
 *           figure in an essay.
 *
 * The sampling is honest about itself: it prints the sample size and the
 * estimated population breakage, never a bare "clean". A silent cap would read
 * as full coverage (CLAUDE.md: no silent caps).
 *
 * Also resolves the inner `url=` parameter of /api/crop-image, which carries a
 * percent-encoded absolute URL. That indirection is exactly where the Blob
 * rehost first missed 13 references, so the audit follows it rather than
 * checking the wrapper and calling it green.
 *
 * Usage:
 *   node scripts/audit/source-image-urls.mjs                 # code exhaustive + data sample
 *   node scripts/audit/source-image-urls.mjs --sample 1000   # bigger data sample
 *   node scripts/audit/source-image-urls.mjs --code-only     # what CI runs
 *   node scripts/audit/source-image-urls.mjs --strict        # data failures also fail
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const SAMPLE = parseInt(arg('--sample', '250'));
const CONCURRENCY = parseInt(arg('--concurrency', '16'));
const STRICT = has('--strict');
const DATA_ONLY = has('--data-only');
const CODE_ONLY = has('--code-only');

const IMG_EXT = /\.(jpe?g|png|gif|webp|svg|avif|pdf)$/i;
const URL_RX = /https?:\/\/[^\s"'`)<>\\]+/g;

/** Retired pages kept for provenance are not served. */
const EXCLUDE_FILE = /(^|\/)_archived\//;
/** Generated visualisation payloads — sampled, not exhaustively checked. */
const DATA_FILE = /src\/data\/(image|book)-constellation\.json$/;
/** Only probe our own assets; third-party hosts rate-limit and would false-fail. */
const OWN_HOST = /(images\.sourcelibrary\.org|sourcelibrary\.org|blob\.vercel-storage\.com)/;

function sourceFiles() {
  const out = execSync(
    `git grep -lI -E "https?://[^\\"']*\\.(jpg|jpeg|png|gif|webp|svg|avif|pdf)" -- src public`,
    { encoding: 'utf8' },
  );
  return out.trim().split('\n').filter(f => f && !EXCLUDE_FILE.test(f));
}

function unwrap(url) {
  const m = url.match(/[?&]url=([^&"'\s]+)/);
  if (!m) return null;
  try {
    const inner = decodeURIComponent(m[1]);
    return /^https?:\/\//.test(inner) ? inner : null;
  } catch { return null; }
}

/**
 * Normalise a captured URL before probing it.
 *
 * `/api/crop-image?url=https://…/23.jpg&x=0.118&y=…` embeds the inner URL
 * UNENCODED, so a greedy match runs straight through the crop params and
 * probes `…/23.jpg&x=0.118&…`, which 404s. That is the audit being wrong, not
 * the site — and a checker that invents failures gets muted, which is worse
 * than not having one. A query string cannot begin with `&`, so a URL carrying
 * `&` before any `?` has swallowed its parent's parameters: cut there.
 *
 * Also drops template literals (`${book_id}`), which are code, not URLs.
 */
function normalise(url) {
  if (url.includes('${')) return null;
  const q = url.indexOf('?');
  const amp = url.indexOf('&');
  if (amp !== -1 && (q === -1 || amp < q)) return url.slice(0, amp);
  return url;
}

function collect() {
  const code = new Map(); // url -> Set(file:line)
  const data = new Map();
  for (const file of sourceFiles()) {
    const bucket = DATA_FILE.test(file) ? data : code;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(URL_RX)) {
        const raw = m[0].replace(/[.,;:]+$/, '');
        const inner = unwrap(raw);
        for (const cand of (inner ? [inner] : [raw])) {
          const c = normalise(cand);
          if (!c) continue;
          if (!IMG_EXT.test(c.split(/[?&#]/)[0])) continue;
          if (!OWN_HOST.test(c)) continue;
          if (!bucket.has(c)) bucket.set(c, new Set());
          bucket.get(c).add(`${file}:${i + 1}`);
        }
      }
    });
  }
  return { code, data };
}

/**
 * A same-origin URL whose path exists under public/ is served after deploy, so
 * probing production for it reports a false 404 on any newly-added asset — the
 * audit would block the very commit that adds the file it is asking for. Check
 * the working tree first for those, and only go to the network otherwise.
 */
function localPublicHit(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^(www\.)?sourcelibrary\.org$/.test(u.hostname)) return false;
  return existsSync(`public${decodeURIComponent(u.pathname)}`);
}

async function probe(url) {
  if (localPublicHit(url)) return 200;
  // GET with a 1-byte Range: some CDNs answer HEAD differently from GET, so a
  // HEAD-only check can report healthy for an object a browser cannot fetch.
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': 'SourceLibrary-audit/1.0' },
      signal: AbortSignal.timeout(20000),
    });
    return res.status;
  } catch (e) {
    return `ERR ${e.name === 'TimeoutError' ? 'timeout' : String(e.message).slice(0, 40)}`;
  }
}

async function checkAll(urls, label) {
  const results = [];
  let idx = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
    while (idx < urls.length) {
      const url = urls[idx++];
      const status = await probe(url);
      results.push({ url, status, ok: status === 200 || status === 206 });
    }
  }));
  console.log(`  ${label}: ${results.length} checked in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return results;
}

function sample(arr, n) {
  if (arr.length <= n) return arr.slice();
  // Deterministic stride, not RNG: reproducible across runs, so a regression is
  // attributable rather than "maybe it drew a different sample".
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

async function main() {
  const { code, data } = collect();
  const codeUrls = [...code.keys()];
  const dataUrls = [...data.keys()];

  console.log(`source image URLs — code: ${codeUrls.length}   data(generated): ${dataUrls.length}\n`);

  let codeBad = [];
  if (!DATA_ONLY) {
    const r = await checkAll(codeUrls, 'code (exhaustive)');
    codeBad = r.filter(x => !x.ok);
  }

  let dataBad = [], dataChecked = 0;
  if (!CODE_ONLY && dataUrls.length) {
    const s = sample(dataUrls, SAMPLE);
    const r = await checkAll(s, `data (sample of ${s.length}/${dataUrls.length})`);
    dataBad = r.filter(x => !x.ok);
    dataChecked = r.length;
  }

  console.log('');
  if (codeBad.length) {
    console.log(`BROKEN in code (${codeBad.length}):`);
    for (const b of codeBad) {
      console.log(`  ${b.status}  ${b.url}`);
      for (const ref of code.get(b.url)) console.log(`      ${ref}`);
    }
  } else if (!DATA_ONLY) {
    console.log(`code: all ${codeUrls.length} URLs reachable.`);
  }

  if (dataChecked) {
    const rate = dataBad.length / dataChecked;
    console.log(`\ndata: ${dataBad.length}/${dataChecked} broken in sample ` +
                `(${(rate * 100).toFixed(1)}%) — estimated ~${Math.round(rate * dataUrls.length).toLocaleString()} ` +
                `of ${dataUrls.length.toLocaleString()} total`);
    for (const b of dataBad.slice(0, 10)) console.log(`  ${b.status}  ${b.url}`);
    if (dataBad.length > 10) console.log(`  … +${dataBad.length - 10} more in sample`);
    console.log('  (sampled, not exhaustive — rerun with --sample N to tighten)');
  }

  const fail = codeBad.length > 0 || (STRICT && dataBad.length > 0);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
