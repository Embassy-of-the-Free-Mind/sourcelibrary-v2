#!/usr/bin/env node
/**
 * Soft-404 audit for Source Library.
 *
 * Soft-404 = a route that returns HTTP 200 but renders the not-found UI
 * (title contains "Not Found"). Google treats these as 404s and unindexes
 * them. The classic offender on this codebase is `tenantId`-strict route
 * filters that 404 untagged books even though the data exists (see the
 * 2026-05-27 incident, PR #2085).
 *
 * What it checks
 *   - Per-book routes for a sample of visible books, biased toward untagged
 *     books (those without `tenantId`) since they are the at-risk class.
 *     • /book/<slug>
 *     • /book/<slug>/page/<pageId>
 *     • /book/<slug>/overview
 *     • /book/<id>/page-number/<n>
 *   - A handful of non-book routes that have shipped soft-404 bugs before:
 *     /collections/<slug>, /author/<slug>, /libraries/<slug>, /gallery,
 *     /gallery/image/<id>.
 *
 * What it does with the results
 *   - Prints a per-pattern summary + first N failing URLs to stdout.
 *   - Optionally writes a snapshot to Mongo collection `soft_404_audits`
 *     for trend tracking (pass --write).
 *   - Optionally posts a Resend alert via /api/admin/alert when any soft
 *     or hard 404 is detected (pass --alert).
 *
 * Detection rules
 *   - Hard 404: HTTP status >= 400.
 *   - Soft 404: status 200 AND title matches /Not Found/i.
 *   - Note: routes that legitimately serve 404 (e.g., explicit invalid IDs)
 *     are NOT in the sample, so any failure is a regression.
 *
 * Usage
 *   node scripts/monitoring/soft-404-audit.mjs
 *   node scripts/monitoring/soft-404-audit.mjs --sample 20 --write --alert
 *   SAMPLE=10 BASE_URL=https://staging.example.com node scripts/monitoring/soft-404-audit.mjs
 *
 * Env / flags
 *   --sample N     books per pool (default 15; total URLs ~ 5*N + 30)
 *   --write        persist a snapshot to `soft_404_audits` in Mongo
 *   --alert        POST to /api/admin/alert when any breakage is found
 *   --base URL     site to probe (default https://sourcelibrary.org)
 *   --concurrency  parallel HTTP fetches (default 8)
 *
 * Exit codes
 *   0 — no breakage found
 *   1 — soft or hard 404 detected
 *   2 — script error (Mongo down, etc.)
 *
 * Scheduling
 *   - Hetzner cron (same host as scripts/uptime-monitor.mjs), nightly:
 *       0 4 * * * cd /root/sourcelibrary && \
 *         set -a; source .env.production.local; set +a; \
 *         node scripts/monitoring/soft-404-audit.mjs --sample 25 --write --alert \
 *         >> /var/log/soft-404-audit.log 2>&1
 *   - Or via the project's `/schedule` skill to run as a scheduled remote agent.
 *
 * Collection schema (`soft_404_audits`)
 *   { started_at, finished_at, base_url, sample_size, total_probed,
 *     broken_count, by_pattern: { <pattern>: { n, broken, examples: [...] } } }
 *   Suggested index (one-time setup):
 *     db.soft_404_audits.createIndex({ started_at: -1 })
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const SAMPLE = Number(arg('sample', process.env.SAMPLE || 15));
const CONCURRENCY = Number(arg('concurrency', process.env.CONCURRENCY || 8));
const BASE_URL = (arg('base', process.env.BASE_URL || 'https://sourcelibrary.org')).replace(/\/+$/, '');
const WRITE_SNAPSHOT = flag('write');
const SEND_ALERT = flag('alert');
const SHOW_FAILURES = Number(arg('show', 10));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Pull a random sample of books matching `match`, projecting only the
 * fields we need to build URLs.
 */
async function sampleBooks(db, match, size) {
  const pipeline = [
    { $match: { visible: true, pages_count: { $gt: 0 }, ...match } },
    { $sample: { size } },
    { $project: { _id: 0, id: 1, slug: 1, tenantId: 1, title: 1 } },
  ];
  return db.collection('books').aggregate(pipeline, { allowDiskUse: false }).toArray();
}

async function samplePageIds(db, bookIds) {
  if (!bookIds.length) return new Map();
  const docs = await db.collection('pages')
    .aggregate([
      { $match: { book_id: { $in: bookIds }, page_number: { $gte: 1 } } },
      { $group: { _id: '$book_id', firstId: { $first: '$id' }, firstNum: { $first: '$page_number' } } },
    ])
    .toArray();
  return new Map(docs.map(d => [d._id, { id: d.firstId, num: d.firstNum }]));
}

async function sampleCollections(db, size) {
  return db.collection('collections')
    .aggregate([
      { $match: { visible: true } },
      { $sample: { size } },
      { $project: { _id: 0, slug: 1, name: 1 } },
    ])
    .toArray();
}

async function sampleAuthors(db, size) {
  // Pick authors with the most visible books — they are the "real" author
  // pages most likely to be linked from book pages and indexed by Google.
  return db.collection('books')
    .aggregate([
      { $match: { visible: true, author: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$author', n: { $sum: 1 } } },
      { $match: { n: { $gte: 3 } } },
      { $sample: { size } },
      { $project: { _id: 0, author: '$_id' } },
    ])
    .toArray();
}

function libraryPartnerSlugs() {
  // The canonical list lives in TS; parse the source file with a regex so we
  // don't need a TS toolchain in the script runtime. If the file moves or the
  // syntax changes, fall back to a small known-good set (production-verified
  // 2026-05-27) so the audit still runs.
  const fallback = ['internet-archive', 'gallica', 'bodleian', 'wellcome-collection', 'e-rara'];
  try {
    const src = readFileSync(resolve(__dirname, '../../src/lib/library-partners.ts'), 'utf8');
    const slugs = [...src.matchAll(/^\s*slug:\s*'([^']+)'/gm)].map(m => m[1]);
    return slugs.length ? [...new Set(slugs)] : fallback;
  } catch {
    return fallback;
  }
}

async function sampleLibraryPartners(size) {
  const all = libraryPartnerSlugs();
  // Shuffle so we rotate through the full set across runs instead of always
  // probing the same first N.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, size).map(slug => ({ slug }));
}

async function sampleGalleryImages(db, size) {
  return db.collection('gallery_images')
    .aggregate([
      { $sample: { size } },
      { $project: { _id: 0, id: 1, book_id: 1 } },
    ])
    .toArray();
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

function authorSlug(name) {
  // Mirror the canonical src/lib/slugify.ts authorSlug(): NFD-normalize and
  // strip combining diacritics so "Matthäus" → "matthaus", not "matth-us".
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function buildProbes(samples) {
  const probes = [];
  const { untagged, tagged, collections, authors, libraries, galleryImages, pageIds } = samples;

  // Per-book routes — slug is preferred so we exercise the canonical URL.
  for (const b of [...untagged, ...tagged]) {
    const ref = b.slug || b.id;
    probes.push({ pattern: 'book/root', url: `${BASE_URL}/book/${ref}` });
    probes.push({ pattern: 'book/overview', url: `${BASE_URL}/book/${ref}/overview` });
    probes.push({ pattern: 'book/page-number', url: `${BASE_URL}/book/${b.id}/page-number/1` });
    const p = pageIds.get(b.id);
    if (p) {
      probes.push({ pattern: 'book/page', url: `${BASE_URL}/book/${ref}/page/${p.id}` });
    }
  }

  for (const c of collections) {
    probes.push({ pattern: 'collection', url: `${BASE_URL}/collections/${c.slug}` });
  }
  for (const a of authors) {
    probes.push({ pattern: 'author', url: `${BASE_URL}/author/${authorSlug(a.author)}` });
  }
  for (const l of libraries) {
    probes.push({ pattern: 'library', url: `${BASE_URL}/libraries/${l.slug}` });
  }
  probes.push({ pattern: 'gallery/index', url: `${BASE_URL}/gallery` });
  for (const g of galleryImages) {
    probes.push({ pattern: 'gallery/image', url: `${BASE_URL}/gallery/image/${g.id}` });
  }

  return probes;
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

const NOT_FOUND_TITLE = /Not Found/i;
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;

// Browser-like UA — bare scraper UAs occasionally trip Cloudflare's bot
// challenge and return a 403 even on healthy URLs, which would generate
// false-positive failures. The "(+soft-404-audit)" suffix preserves
// traceability if any log digs into this script's hits.
const PROBE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (+soft-404-audit)';

async function probeOnce(url) {
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': PROBE_UA, 'Accept': 'text/html,*/*;q=0.8' },
    signal: AbortSignal.timeout(15_000),
  });
  const status = r.status;
  if (status >= 400) return { status, title: '', broken_reason: `http_${status}` };
  let title = '';
  let broken_reason = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/html')) {
    const body = await r.text();
    const m = TITLE_RE.exec(body);
    title = m ? m[1].trim() : '';
    if (NOT_FOUND_TITLE.test(title)) broken_reason = 'soft_404';
  }
  return { status, title, broken_reason };
}

async function probe(url) {
  const t0 = Date.now();
  // Single retry on transient fetch errors only — not on HTTP 4xx/5xx, where
  // a retry would just hide a real regression.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await probeOnce(url);
      return { url, ...r, ms: Date.now() - t0 };
    } catch (err) {
      if (attempt === 1) {
        return {
          url,
          status: 0,
          title: '',
          broken_reason: `fetch_error:${err.code || err.name || 'unknown'}`,
          ms: Date.now() - t0,
        };
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function probeAll(urls, concurrency) {
  const queue = urls.slice();
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      const r = await probe(next.url);
      results.push({ pattern: next.pattern, ...r });
      // Inline progress dots — cron-friendly enough
      process.stderr.write(r.broken_reason ? '!' : '.');
    }
  });
  await Promise.all(workers);
  process.stderr.write('\n');
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarize(results) {
  const byPattern = new Map();
  for (const r of results) {
    const slot = byPattern.get(r.pattern) || { n: 0, broken: 0, examples: [] };
    slot.n += 1;
    if (r.broken_reason) {
      slot.broken += 1;
      if (slot.examples.length < SHOW_FAILURES) {
        slot.examples.push({ url: r.url, status: r.status, title: r.title, reason: r.broken_reason });
      }
    }
    byPattern.set(r.pattern, slot);
  }
  const total = results.length;
  const broken = results.filter(r => r.broken_reason).length;
  return { total, broken, byPattern };
}

function formatReport(summary, started) {
  const { total, broken, byPattern } = summary;
  const lines = [];
  lines.push(`Soft-404 audit — ${BASE_URL}`);
  lines.push(`Started ${started.toISOString()} | Probed ${total} URLs | Broken ${broken}`);
  lines.push('');
  const rows = [...byPattern.entries()].sort((a, b) => b[1].broken - a[1].broken);
  for (const [pattern, slot] of rows) {
    const tag = slot.broken === 0 ? '   ok' : `broken`;
    lines.push(`  [${tag}] ${pattern.padEnd(22)} ${slot.broken}/${slot.n}`);
  }
  if (broken > 0) {
    lines.push('');
    lines.push('First failing URLs by pattern:');
    for (const [pattern, slot] of rows) {
      if (!slot.examples.length) continue;
      lines.push(`  ${pattern}:`);
      for (const ex of slot.examples) {
        const detail = ex.reason === 'soft_404' ? `[soft] "${ex.title}"` : `[${ex.reason}]`;
        lines.push(`    ${detail} ${ex.url}`);
      }
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

async function writeSnapshot(db, summary, started) {
  const doc = {
    started_at: started,
    finished_at: new Date(),
    base_url: BASE_URL,
    sample_size: SAMPLE,
    total_probed: summary.total,
    broken_count: summary.broken,
    by_pattern: Object.fromEntries(
      [...summary.byPattern].map(([k, v]) => [k, { n: v.n, broken: v.broken, examples: v.examples }])
    ),
  };
  await db.collection('soft_404_audits').insertOne(doc);
  console.log(`[snapshot] wrote soft_404_audits doc (broken=${summary.broken}/${summary.total})`);
}

async function sendAlert(summary, body) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[alert] CRON_SECRET not set; cannot post to /api/admin/alert');
    return;
  }
  const subject = `Soft-404 audit: ${summary.broken} broken of ${summary.total} probed`;
  const severity = summary.broken > 10 ? 'critical' : summary.broken > 0 ? 'warning' : 'info';
  try {
    const r = await fetch(`${BASE_URL}/api/admin/alert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`,
      },
      body: JSON.stringify({ subject, body, severity }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json.dispatched) {
      console.error('[alert] failed', r.status, json);
    } else {
      console.log(`[alert] dispatched ${severity} email`);
    }
  } catch (err) {
    console.error('[alert] error', err.message);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = new Date();
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    // Bias toward at-risk books: 60% untagged, 40% tagged
    const untaggedSize = Math.ceil(SAMPLE * 0.6);
    const taggedSize = SAMPLE - untaggedSize;
    const [untagged, tagged, collections, authors, libraries, galleryImages] = await Promise.all([
      sampleBooks(db, { tenantId: { $exists: false } }, untaggedSize),
      sampleBooks(db, { tenantId: { $exists: true, $ne: null } }, taggedSize),
      sampleCollections(db, 5),
      sampleAuthors(db, 5),
      sampleLibraryPartners(5),
      sampleGalleryImages(db, 5),
    ]);
    const allBookIds = [...untagged, ...tagged].map(b => b.id).filter(Boolean);
    const pageIds = await samplePageIds(db, allBookIds);

    const probes = buildProbes({ untagged, tagged, collections, authors, libraries, galleryImages, pageIds });
    console.log(`[audit] probing ${probes.length} URLs against ${BASE_URL}`);

    const results = await probeAll(probes, CONCURRENCY);
    const summary = summarize(results);
    const report = formatReport(summary, started);
    console.log(report);

    if (WRITE_SNAPSHOT) await writeSnapshot(db, summary, started);
    if (SEND_ALERT && summary.broken > 0) await sendAlert(summary, report);

    process.exit(summary.broken > 0 ? 1 : 0);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
