#!/usr/bin/env node
/**
 * truncated-ingests — live books whose page count is implausibly small for the work
 * they claim to be, i.e. a failed ingest wearing a completion badge (#4442).
 *
 * PRIOR ART: scripts/audit/volume-gaps.mjs — finds missing VOLUMES of a series by
 * title parsing; it cannot see a volume that is present but holds one leaf.
 * scripts/maintenance/fix-ia-page-counts.ts — the opposite direction (pages_count too
 * LARGE vs IA). scripts/lib/ia-page-count.mjs is reused here for lane 2.
 *
 * WHY. `pages_translated / pages_count` is 1.0 precisely when the ingest truncated,
 * because both sides shrink together. al-Qanun (Avicenna's Canon, 69b3e5fb…) is one
 * title page, live, "100% translated", and never surfaces in a needs-translation
 * queue. `pages_count` alone is not the signal — ~14 one-page ETCSL hymns, a Drehem
 * tablet and two planispheres are complete at one leaf. The signal is the page count
 * against the KNOWN extent of the work, which the record does not carry by itself.
 *
 * LANES, cheapest and strongest first (from the issue):
 *   1. work graph  — another book with the same `work_id` has ≥ max(50, 10×) pages.
 *                    No network, no model. Weakness: `work_id` sometimes lumps a
 *                    miscellany or a manuscript cluster (Bodleian "four gospels"
 *                    fragments), so a lane-1 hit on a MS. fragment is a lead, not proof.
 *   2. IA manifest — the book's `ia_identifier` advertises ≥ max(20, 5×) pages
 *                    (IIIF canvases → imagecount, via iaPageCount). Provable upstream.
 *   3. genre floor — an encyclopaedia/canon/opera omnia/summa title. Reported only as a
 *                    tie-breaker column; it never flags a book on its own.
 *
 * Read-only. Writes nothing to any store; the optional --json goes to a local file.
 * What to DO with a confirmed truncation (re-ingest vs hide) is a human decision.
 *
 *   node --env-file=.env.production.local scripts/audit/truncated-ingests.mjs
 *     [--max-pages=10]   frame: live books with pages_count ≤ this
 *     [--no-ia]          skip lane 2 (no network)
 *     [--json=<path>]    full rows
 *     [--limit=80]       rows printed per section
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { iaPageCount } from '../lib/ia-page-count.mjs';

const args = process.argv.slice(2);
const getArg = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || null;
const MAX_PAGES = parseInt(getArg('max-pages') || '10', 10);
const LIMIT = parseInt(getArg('limit') || '80', 10);
const JSON_OUT = getArg('json');
const USE_IA = !args.includes('--no-ia');

/** Lane thresholds. A sibling/source must be BOTH absolutely large and many times bigger. */
export const WORK_MIN_PAGES = 50;
export const WORK_RATIO = 10;
export const IA_MIN_PAGES = 20;
export const IA_RATIO = 5;

/** Lane 3 — titles that name a multi-part work. Tie-breaker only. */
export const GENRE_FLOOR_RE =
  /\b(?:(?<!MS\. )canon|qan[uū]n|summa|opera(?: omnia)?|collected works|complete works|historiae?|histories|annales|annals|lexicon|thesaurus|corpus|biblia|bible|libri|books? \d+\s*[–-]\s*\d+)\b|\b(?:encyclop|chronic|dictionar|commentar)/i;

export function workLane(pages, siblingPages) {
  const sib = siblingPages.filter((n) => n > 0);
  if (!sib.length) return null;
  const max = Math.max(...sib);
  return max >= Math.max(WORK_MIN_PAGES, WORK_RATIO * pages) ? { sibling_max: max, siblings: sib.length } : null;
}

export function iaLane(pages, sourcePages) {
  return sourcePages >= Math.max(IA_MIN_PAGES, IA_RATIO * pages) ? { source_pages: sourcePages } : null;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri, { maxPoolSize: 2 });
  await client.connect();
  const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');

  const frame = await books.find(
    { visible: true, pages_count: { $gt: 0, $lte: MAX_PAGES }, content_type: { $ne: 'artwork' } },
    { projection: { _id: 1, id: 1, title: 1, author: 1, pages_count: 1, pages_translated: 1, pages_translatable: 1, work_id: 1, ia_identifier: 1 } },
  ).toArray();

  // Lane 1 — one query for every sibling of every framed work.
  const wids = [...new Set(frame.map((b) => b.work_id).filter((w) => typeof w === 'string' && w))];
  const sibRows = wids.length
    ? await books.find({ work_id: { $in: wids }, pages_count: { $gt: 0 } }, { projection: { _id: 1, work_id: 1, pages_count: 1 } }).toArray()
    : [];
  const byWork = new Map();
  for (const s of sibRows) {
    if (!byWork.has(s.work_id)) byWork.set(s.work_id, []);
    byWork.get(s.work_id).push(s);
  }
  await client.close();

  // Lane 2 — IA, 4 at a time.
  const iaPages = new Map();
  const iaFailed = [];
  if (USE_IA) {
    const queue = frame.filter((b) => typeof b.ia_identifier === 'string' && b.ia_identifier);
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < queue.length) {
        const b = queue[i++];
        let metadata;
        try {
          const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(b.ia_identifier)}`, { signal: AbortSignal.timeout(15000) });
          if (r.ok) metadata = await r.json();
        } catch { /* iaPageCount still tries IIIF */ }
        const { pages, source } = await iaPageCount(b.ia_identifier, { metadata });
        if (source === 'none') iaFailed.push(b.ia_identifier);
        else iaPages.set(String(b._id), pages);
      }
    }));
  }

  const rows = frame.map((b) => {
    const self = String(b._id);
    const sib = (byWork.get(b.work_id) || []).filter((s) => String(s._id) !== self).map((s) => s.pages_count);
    const work = b.work_id ? workLane(b.pages_count, sib) : null;
    const ia = iaPages.has(self) ? iaLane(b.pages_count, iaPages.get(self)) : null;
    return {
      id: b.id || self,
      title: b.title,
      author: b.author,
      pages_count: b.pages_count,
      reads_complete: (b.pages_translated || 0) >= b.pages_count,
      work_id: b.work_id || null,
      work,
      ia_identifier: b.ia_identifier || null,
      ia,
      genre_floor: GENRE_FLOOR_RE.test(`${b.title || ''}`),
    };
  });
  const flagged = rows.filter((r) => r.work || r.ia);
  const genreOnly = rows.filter((r) => !r.work && !r.ia && r.genre_floor);

  console.log(`truncated-ingests  ${new Date().toISOString().slice(0, 10)}  frame: live, pages_count ≤ ${MAX_PAGES}`);
  console.log(`  framed books              ${frame.length}`);
  console.log(`  with a work_id sibling    ${rows.filter((r) => (byWork.get(r.work_id) || []).length > 1).length}`);
  console.log(`  IA items checked          ${USE_IA ? `${iaPages.size} (${iaFailed.length} unresolvable)` : 'skipped (--no-ia)'}`);
  console.log(`  FLAGGED truncated         ${flagged.length}  (work ${flagged.filter((r) => r.work).length}, IA ${flagged.filter((r) => r.ia).length}, both ${flagged.filter((r) => r.work && r.ia).length})`);
  console.log(`    …of which read 100%     ${flagged.filter((r) => r.reads_complete).length}`);
  console.log(`  genre-floor only (leads)  ${genreOnly.length}`);

  const line = (r) => [
    String(r.pages_count).padStart(3),
    (r.work ? `w${r.work.sibling_max}` : '').padStart(6),
    (r.ia ? `ia${r.ia.source_pages}` : '').padStart(7),
    r.reads_complete ? '100%' : '    ',
    r.genre_floor ? 'G' : ' ',
    r.id,
    `${(r.title || '').slice(0, 60)} — ${(r.author || '').slice(0, 25)}`,
  ].join('  ');
  console.log('\n## Flagged  (pages  work-sibling-max  IA-source-pages  badge  genre  id  title)');
  for (const r of flagged.sort((a, b) => b.reads_complete - a.reads_complete || a.pages_count - b.pages_count).slice(0, LIMIT)) console.log(line(r));
  if (flagged.length > LIMIT) console.log(`  … ${flagged.length - LIMIT} more (--limit / --json)`);
  console.log('\n## Genre floor only — no lane evidence; check by eye');
  for (const r of genreOnly.slice(0, LIMIT)) console.log(line(r));

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ generated_at: new Date().toISOString(), max_pages: MAX_PAGES, ia_unresolvable: iaFailed, flagged, genre_only: genreOnly }, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
