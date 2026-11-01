#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/fix-broken-image-thumb.mjs — repairs one known cause (dead
 * /pages/-thumb URLs) and cites the reports, but never reads them. scripts/audit/refused-host-pages.ts
 * runs the resolver for proxy-refused hosts and says it does not measure a direct URL the browser
 * cannot load. scripts/audit/archive-coverage.mjs counts archived pages, not whether readers see them.
 * None reads broken_image_reports.
 *
 * broken-image-reports — which images are readers reporting broken, and are they STILL broken?
 *
 * WHY THIS EXISTS (#5448, 2026-11-01)
 * BrokenImageReporter has logged readers' broken images to `broken_image_reports` since #5165, and
 * nothing read the collection. 26 visible Gallica books (BnF series bpt6k87…, ~6.2K pages) served
 * readers blank pages until Derek opened one; the reporter could not have shown them, because it
 * logged only our own hosts. It now logs every host; this reads the log.
 *
 * Most reports are transient: on 2026-11-01 all 1,290 distinct URLs reported in the previous 7 days
 * (all on our own hosts) answered 200 when fetched again. So a report is a lead, not a finding. Each
 * distinct URL is fetched again, and only one that still fails counts. Findings are grouped by book,
 * because the failure is book-shaped (a whole book on a host that stopped serving it).
 *
 * A server-side fetch is not a browser: a host can wall a datacenter address and serve a reader
 * (or the reverse), and a CSP block fails only in the browser. The report prints the status per
 * host so the reader of the report can tell which it is.
 *
 * EXIT CONTRACT (.claude/docs/invariants/measurement-instruments.md)
 *   0  ran; no reported URL still fails
 *   1  ran; at least one reported URL still fails (listed by book)
 *   2  could not run — no measurement was taken. Never read as clean.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/broken-image-reports.mjs [--days=1] [--max=600] [--json] [--alert]
 *
 * --alert (the daily Hetzner cron): on exit 1, page ntfy sourcelibrary-uptime once with the count
 * and the three biggest places, so a broken image reaches a person the day a reader hits it.
 */
import { MongoClient } from 'mongodb';
import { ntfyPost } from '../lib/ntfy-send.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const DAYS = Number(opt('days', '1'));
const MAX = parseInt(opt('max', '600'), 10);
const JSON_OUT = argv.includes('--json');
const ALERT = argv.includes('--alert');
const NTFY_TOPIC = process.env.BROKEN_IMAGE_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';
const ORIGIN = 'https://sourcelibrary.org';
// An honest UA, never a browser's: our own crawler gate 403s a Chrome UA that lacks a browser's other
// headers, and that read as 340 "still broken" URLs that were serving readers fine (2026-11-01).
const UA = 'sourcelibrary-broken-image-audit/1.0 (+https://sourcelibrary.org)';

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

/**
 * Fetch once more; ok only for a 2xx image. A 429 is our own rate limit answering the probe, not
 * the reader's failure: wait and ask once more, and if it still says 429 the URL is `unverified`,
 * never counted as broken (2026-11-01: 8 parallel probes drew 200+ 429s from /api/image).
 */
async function probe(url, retry = true) {
  const abs = url.startsWith('/') ? `${ORIGIN}${url}` : url;
  try {
    const r = await fetch(abs, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }, signal: AbortSignal.timeout(30_000) });
    const type = r.headers.get('content-type') || '';
    await r.body?.cancel();
    if (r.status === 429) {
      if (retry) { await sleep(Number(r.headers.get('retry-after')) * 1000 || 10_000); return probe(url, false); }
      return { ok: null, status: '429' };
    }
    return { ok: r.ok && type.startsWith('image/'), status: r.ok && !type.startsWith('image/') ? `${r.status} ${type.split(';')[0]}` : String(r.status) };
  } catch (e) {
    return { ok: false, status: e.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

/** The book a report is about: from the image URL's own book id, else from the reader path. */
function bookKeys(url, page) {
  const fromUrl = /\/(?:pages|archived|gallery)\/([0-9a-f]{24})\//.exec(decodeURIComponent(url))?.[1];
  const fromPath = /^(?:\/[a-z]{2})?\/book\/([^/?#]+)/.exec(page || '')?.[1];
  return { id: fromUrl ?? null, ref: fromPath ?? null };
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set — no measurement taken'); process.exit(2); }
  const mc = await MongoClient.connect(process.env.MONGODB_URI);
  try {
    const db = mc.db('bookstore');
    const since = new Date(Date.now() - DAYS * 864e5);
    const reports = await db.collection('broken_image_reports')
      .find({ created_at: { $gte: since } }, { projection: { urls: 1, page: 1, ip: 1 } }).toArray();

    // url → { pages, ips }
    const byUrl = new Map();
    for (const r of reports) for (const u of r.urls ?? []) {
      const e = byUrl.get(u) ?? { pages: new Set(), ips: new Set() };
      e.pages.add(r.page); e.ips.add(r.ip);
      byUrl.set(u, e);
    }
    const urls = [...byUrl.keys()].slice(0, MAX);
    console.log(`${reports.length} report(s) in the last ${DAYS} day(s); ${byUrl.size} distinct URL(s); probing ${urls.length}`);

    const failing = [];
    let unverified = 0;
    for (let i = 0; i < urls.length; i += 4) {
      const batch = urls.slice(i, i + 4);
      const res = await Promise.all(batch.map((u) => probe(u)));
      batch.forEach((u, j) => {
        if (res[j].ok === null) unverified++;
        else if (!res[j].ok) failing.push({ url: u, status: res[j].status, ...byUrl.get(u) });
      });
      await sleep(250);
    }
    if (unverified) console.log(`unverified (still rate-limited after a retry): ${unverified}`);

    // Group what still fails by book, with the book's visibility.
    const groups = new Map();
    for (const f of failing) {
      const page = [...f.pages][0];
      const { id, ref } = bookKeys(f.url, page);
      const key = id ?? ref ?? `page:${page}`;
      const g = groups.get(key) ?? { key, id, ref, urls: [], ips: new Set(), statuses: {} };
      g.urls.push(f.url);
      for (const ip of f.ips) g.ips.add(ip);
      const host = f.url.startsWith('/') ? 'sourcelibrary.org' : new URL(f.url).host;
      g.statuses[`${host} ${f.status}`] = (g.statuses[`${host} ${f.status}`] ?? 0) + 1;
      groups.set(key, g);
    }
    const books = db.collection('books');
    const rows = [];
    for (const g of groups.values()) {
      const ref = g.id ?? g.ref;
      const b = ref ? await books.findOne({ $or: [{ id: ref }, { slug: ref }] }, { projection: { id: 1, slug: 1, title: 1, visible: 1 } }) : null;
      rows.push({ book: b?.id ?? null, title: b?.title?.slice(0, 60) ?? null, visible: b?.visible ?? null, link: b ? `${ORIGIN}/book/${b.slug ?? b.id}` : g.key,
        urls: g.urls.length, readers: g.ips.size, statuses: g.statuses, example: g.urls[0] });
    }
    rows.sort((a, b) => (b.visible === true) - (a.visible === true) || b.urls - a.urls);

    console.log(`still failing: ${failing.length} of ${urls.length} URL(s), ${rows.length} book(s)/page(s)`);
    for (const r of rows.slice(0, 40)) {
      console.log(`  ${r.visible === true ? 'LIVE  ' : r.visible === false ? 'hidden' : '?     '} ${String(r.urls).padStart(4)} url(s) ${String(r.readers).padStart(3)} reader(s)  ${Object.entries(r.statuses).map(([k, n]) => `${k}×${n}`).join(', ')}`);
      console.log(`         ${r.title ?? ''} ${r.link}`);
    }
    if (JSON_OUT) console.log(JSON.stringify({ at: new Date(), days: DAYS, probed: urls.length, failing: failing.length, rows }));
    if (ALERT && rows.length) {
      const top = rows.slice(0, 3).map((r) => `${r.urls}× ${Object.keys(r.statuses).join(', ')} — ${r.title ?? ''} ${r.link}`).join('\n');
      const res = await ntfyPost(NTFY_TOPIC, {
        method: 'POST',
        headers: { Title: `Broken images: ${failing.length} URL(s) on ${rows.length} page(s) still fail`, Priority: 'default', Tags: 'frame_with_picture' },
        body: `Readers reported these in the last ${DAYS} day(s) and they still fail on a re-fetch:\n${top}\nFull list: node scripts/audit/broken-image-reports.mjs --days=${DAYS} (#5448)`,
      });
      console.log(`ntfy: ${res.status}`);
    }
    process.exitCode = failing.length ? 1 : 0;
  } finally {
    await mc.close();
  }
}

main().catch((e) => { console.error(`could not run: ${e.message} — no measurement taken`); process.exit(2); });
