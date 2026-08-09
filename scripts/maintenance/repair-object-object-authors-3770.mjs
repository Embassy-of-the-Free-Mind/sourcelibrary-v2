#!/usr/bin/env node
/**
 * Repair the 3,297 books whose author is the literal string "[object Object]" (#3770).
 *
 * WHAT HAPPENED. A scratch harvest driver for the esoteric-core wave
 * (acquisition_source "europeana-mdz", 2026-07-05..10, all BSB/MDZ, all hidden)
 * stringified the Europeana dcCreator language-map object while building its
 * POST bodies, so /api/import/europeana received — and importBookFromIIIF
 * faithfully stored — "[object Object]" as the author. The defect then
 * propagated into every author-derived field: slug ("…-object-object"),
 * normalized_author, edition_key ("…|object|1667|v"), and work_id
 * ("local:n:object:…" — mint-local-work-ids.mjs tokenized the string).
 *
 * WHY EXACT REPAIR IS POSSIBLE. Every one of these books carries its IIIF
 * manifest URL, and MDZ manifests carry an authority-controlled Creator field:
 *   "Glauber, Johann Rudolph, 1604-1670 -- (GND: <a href=…>118695304</a>)"
 * That is a BETTER value than the harvest ever had. This script re-fetches
 * each manifest and repairs from the source of truth (the issue's option 2 —
 * exact repair, not title-parsing inference).
 *
 * WHAT IT WRITES per book (write guarded on author still being the bad value):
 *   - author: the manifest Creator name(s), life dates stripped, "; "-joined
 *   - normalized_title / normalized_author / edition_key / edition_key_quality:
 *     restamped inline via the shared computeIdentityFields (same writer the
 *     identity worker uses) — no window where the book has a stale key
 *   - slug: regenerated with the same algorithm as generateBookSlug + a
 *     collision check (safe: every affected book is hidden, so no public URL
 *     changes)
 *   - work_id/work_slug/work_title/work_id_confidence/work_id_source: UNSET.
 *     The polluted local:n:object: keys are garbage; with work_id absent the
 *     books re-enter mint-local-work-ids.mjs's gap query and get re-minted
 *     from the repaired author on its next run.
 *   - field_provenance.author with the GND id(s) when the manifest carries them
 *
 * Books whose manifest has NO Creator field are counted and reported, never
 * guessed at — an anonymous imprint honestly has no author (see #3434), but
 * unsetting is a separate decision from this repair.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-object-object-authors-3770.mjs                # dry-run, sample 20
 *   node --env-file=.env.production.local scripts/maintenance/repair-object-object-authors-3770.mjs --limit 50     # dry-run, bigger sample
 *   node --env-file=.env.production.local scripts/maintenance/repair-object-object-authors-3770.mjs --apply        # full repair
 *   node --env-file=.env.production.local scripts/maintenance/repair-object-object-authors-3770.mjs --revert       # restore from backup
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { computeIdentityFields } from '../lib/identity-fields.mjs';

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--limit') + 1] || '', 10) || (APPLY ? 0 : 20);
const BACKUP = 'scripts/output/object-object-authors-3770-backup.jsonl';
const BAD = '[object Object]';
const CONCURRENCY = 6;

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const books = mc.db('bookstore').collection('books');

// ── revert ───────────────────────────────────────────────────────────────────
if (REVERT) {
  if (!existsSync(BACKUP)) { console.error(`No backup at ${BACKUP}.`); process.exit(1); }
  let n = 0;
  for (const line of readFileSync(BACKUP, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    const r = await books.updateOne({ id: row.id }, { $set: row.before, $unset: { 'field_provenance.author': '' } });
    n += r.modifiedCount;
  }
  console.log(`Reverted ${n} books from ${BACKUP}.`);
  await mc.close();
  process.exit(0);
}

// ── the same slug algorithm as src/lib/slugify.ts generateBookSlug ───────────
const slugify = (text, maxLength) => {
  let s = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (s.length > maxLength) {
    s = s.substring(0, maxLength);
    const h = s.lastIndexOf('-');
    if (h > maxLength * 0.5) s = s.substring(0, h);
  }
  return s;
};
const lastName = (author) => {
  if (!author || /^unknown\b/i.test(author.trim())) return 'unknown';
  if (author === 'Anonymous') return 'anonymous';
  if (author.includes(',')) return author.split(',')[0].trim();
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1];
};
const buildSlug = (title, author, displayTitle) => {
  const slugTitle = slugify(displayTitle || title, 60);
  const slugAuthor = slugify(lastName(author), 20);
  if (!slugAuthor || slugAuthor === 'unknown') return slugTitle || 'untitled';
  if (!slugTitle) return slugAuthor;
  return `${slugTitle}-${slugAuthor}`;
};

// ── Creator extraction from an MDZ IIIF v2 manifest ──────────────────────────
const enLabel = (label) => {
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) return label.find(l => l['@language'] === 'en')?.['@value'] || label[0]?.['@value'] || '';
  return label?.['@value'] || '';
};
const values = (v) => (Array.isArray(v) ? v : [v]).map(x => (typeof x === 'string' ? x : x?.['@value'] || '')).filter(Boolean);

function extractCreators(manifest) {
  const out = [];
  for (const md of manifest.metadata || []) {
    if (enLabel(md.label) !== 'Creator') continue;
    for (const raw of values(md.value)) {
      const gnd = raw.match(/GND:.*?(\d{6,10}[0-9X])/)?.[1] || null;
      let name = raw
        .split(/\s*--\s*/)[0]                      // drop the "(GND: …)" tail
        .replace(/<[^>]+>/g, '')                   // any stray markup
        .replace(/,\s*(ca\.\s*)?\d{4}[?]?\s*-\s*(ca\.\s*)?\d{0,4}[?]?\s*$/,'') // life dates
        .trim();
      if (name) out.push({ name, gnd });
    }
  }
  return out;
}

async function fetchManifest(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'SourceLibrary-author-repair-3770/1.0 (https://sourcelibrary.org)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}

// ── plan ─────────────────────────────────────────────────────────────────────
const targets = await books.find(
  { author: BAD },
  { projection: { id: 1, title: 1, display_title: 1, slug: 1, published: 1, year: 1, visible: 1, 'image_source.iiif_manifest': 1, work_id: 1 } },
).limit(LIMIT || 0).toArray();
console.log(`Found ${targets.length} books with author ${JSON.stringify(BAD)}${LIMIT ? ` (limit ${LIMIT})` : ''}.`);
const visibleOnes = targets.filter(b => b.visible === true);
if (visibleOnes.length) console.log(`NOTE: ${visibleOnes.length} are VISIBLE — slug regeneration will change public URLs for those; they are SKIPPED.`);

const stats = { repaired: 0, noCreator: 0, fetchFailed: 0, skippedVisible: visibleOnes.length, guardMiss: 0 };
// Slugs claimed during THIS run. The DB collision check alone races: two
// concurrent workers repairing same-titled volumes (Glauber's Pharmacopaeae
// Theile truncate to one 60-char base) would both see the slug as free.
const claimed = new Set();
const noCreatorIds = [];
const failures = [];
mkdirSync(dirname(BACKUP), { recursive: true });

let cursorIdx = 0;
const queue = targets.filter(b => b.visible !== true);

async function worker() {
  for (;;) {
    const i = cursorIdx++;
    if (i >= queue.length) return;
    const b = queue[i];
    const url = b.image_source?.iiif_manifest;
    if (!url) { stats.fetchFailed++; failures.push({ id: b.id, error: 'no manifest url' }); continue; }
    let creators;
    try {
      creators = extractCreators(await fetchManifest(url));
    } catch (e) {
      stats.fetchFailed++; failures.push({ id: b.id, error: e.message });
      continue;
    }
    if (!creators.length) { stats.noCreator++; noCreatorIds.push(b.id); continue; }

    const author = creators.map(c => c.name).join('; ');
    const identity = computeIdentityFields({ ...b, author });
    // unique slug: base, then -2, -3… (collision check against the live collection)
    const base = buildSlug(b.title, author, b.display_title);
    let slug = base;
    for (let n = 2; claimed.has(slug) || await books.findOne({ slug, id: { $ne: b.id } }, { projection: { _id: 1 } }); n++) slug = `${base}-${n}`;
    claimed.add(slug);

    if (!APPLY) {
      console.log(`  ${b.id}  "${author}"${creators.some(c => c.gnd) ? ` [GND ${creators.map(c => c.gnd).filter(Boolean).join(',')}]` : ''}`);
      console.log(`      slug: ${b.slug} -> ${slug}`);
      console.log(`      edition_key: ${identity.edition_key?.slice(0, 90)}`);
      stats.repaired++;
      continue;
    }

    appendFileSync(BACKUP, JSON.stringify({
      id: b.id, repaired_at: new Date().toISOString(),
      before: { author: BAD, slug: b.slug, work_id: b.work_id ?? null },
      after_author: author,
    }) + '\n');
    const r = await books.updateOne(
      { id: b.id, author: BAD },   // re-assert the guard at write time
      {
        $set: {
          author, slug, ...identity,
          updated_at: new Date(),
          'field_provenance.author': {
            source: 'mdz-manifest', script: 'repair-object-object-authors-3770.mjs', issue: 3770,
            date: new Date(), previous_value: BAD,
            ...(creators.some(c => c.gnd) ? { gnd: creators.map(c => c.gnd).filter(Boolean) } : {}),
          },
        },
        $unset: { work_id: '', work_slug: '', work_title: '', work_id_confidence: '', work_id_source: '' },
      },
    );
    if (r.modifiedCount) stats.repaired++; else { stats.guardMiss++; }
    if (stats.repaired % 200 === 0) console.log(`  …${stats.repaired} repaired`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${stats.repaired} repaired, ${stats.noCreator} no-Creator (left untouched), ${stats.fetchFailed} fetch failures, ${stats.skippedVisible} visible skipped, ${stats.guardMiss} guard misses.`);
if (noCreatorIds.length) {
  const p = 'scripts/output/object-object-no-creator-3770.json';
  writeFileSync(p, JSON.stringify(noCreatorIds, null, 2));
  console.log(`No-Creator ids -> ${p} (decide unset-vs-research separately; see #3434 for why we never guess).`);
}
if (failures.length) {
  console.log(`Fetch failures (rerun the script — it self-limits to still-broken books):`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f.id}  ${f.error}`);
  if (failures.length > 10) console.log(`  …and ${failures.length - 10} more`);
}
if (APPLY) {
  console.log('\nNext: mint-local-work-ids.mjs re-covers the unset work_ids on its next run;');
  console.log('backfill-author-canonical-links.mjs --include-backlog can now link these authors (#3769/#3780).');
}
await mc.close();
