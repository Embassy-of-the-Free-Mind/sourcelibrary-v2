/**
 * READ-ONLY detector for duplicate artwork RECORDS (#2209).
 *
 * Finds artwork docs (content_type:'artwork') that are the same object imported
 * more than once — the Met/Rijks/Commons/e-manuscripta overlap. Groups by three
 * exact-identity keys (strongest first) and, within each group, nominates a
 * keeper by an evidence heuristic. Writes a review report; deletes NOTHING.
 * Deletion of the non-keepers is a separate, sign-off-gated step (Data
 * Protection CRITICAL: never batch-delete artworks without explicit approval).
 *
 * Identity keys (a group forms when ≥2 records share a value), tiered by trust:
 *   1. commons_sha1 (HIGH) — Wikimedia file SHA-1. Identical = byte-identical
 *                     file imported twice. Unambiguous; the actionable dedup list.
 *   2. source_url (REVIEW) — image_source.source_url, the ORIGINAL record URL.
 *                     A shared value usually means ONE museum object exploded
 *                     into many child-image records (albums / multi-view: Met
 *                     handscrolls, shunga pages) — NOT a dup import. Routes to
 *                     convert-to-book (#2428) or manual review, not auto-delete.
 *   3. title_author_year (LOW) — normalized title+author+year. Conflates
 *                     same-SUBJECT with same-OBJECT (many "Adoration of the Magi";
 *                     one "Atalanta Fugiens" per emblem). UNVERIFIED — needs CLIP
 *                     visual confirmation, never a bulk-delete key.
 * Keys are applied in priority order; a record already grouped by a
 * higher-priority key is not re-grouped by a lower one (no double-counting).
 * (commons_page_title was tried and dropped — it normalizes malformed values
 * like "File:.jpg" to a shared junk key that groups unrelated works.)
 *
 * Keeper heuristic (first differentiator wins): visible > has enrichment >
 * has collections > archived to R2 (image_display on images.sourcelibrary) >
 * more populated fields > lexicographically smallest id (stable tiebreak).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analysis/artwork-exact-duplicates.mjs [--json] [--out=path]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const JSON_OUT = process.argv.includes('--json');
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '').split('=')[1]
  || 'scripts/output/artwork-exact-duplicates.json';

function norm(s) {
  return (s || '').toString().toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')       // strip diacritics
    .replace(/[^a-z0-9]+/g, ' ').trim();   // collapse punctuation
}

// Normalize a source URL to its identity: strip protocol, trailing slash, query.
function normUrl(u) {
  if (!u) return '';
  return u.toString().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\?.*$/, '').trim();
}

function fieldScore(d) {
  // Rough "how complete is this record" score for the keeper tiebreak.
  let n = 0;
  for (const k of ['title', 'author', 'published', 'summary', 'medium',
    'current_location', 'commons_description', 'iconclass']) {
    if (d[k] != null && d[k] !== '') n++;
  }
  if (Array.isArray(d.collections)) n += d.collections.length;
  return n;
}

// Return the keeper (index into group) by the evidence heuristic.
function pickKeeper(group) {
  const scored = group.map(d => ({
    d,
    visible: d.visible === true ? 1 : 0,
    enriched: d.enrichment && Object.keys(d.enrichment).length > 0 ? 1 : 0,
    hasColl: Array.isArray(d.collections) && d.collections.length > 0 ? 1 : 0,
    archived: /images\.sourcelibrary\.org/.test(d.image_display || d.image_full || '') ? 1 : 0,
    fields: fieldScore(d),
    id: d.id,
  }));
  scored.sort((a, b) =>
    b.visible - a.visible || b.enriched - a.enriched || b.hasColl - a.hasColl ||
    b.archived - a.archived || b.fields - a.fields || (a.id < b.id ? -1 : 1));
  return scored[0].d;
}

async function main() {
  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');

  const docs = await db.collection('books').find(
    { content_type: 'artwork' },
    { projection: {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1, published: 1,
      visible: 1, collections: 1, enrichment: 1, medium: 1, summary: 1,
      current_location: 1, commons_description: 1, iconclass: 1,
      commons_sha1: 1, image_display: 1, image_full: 1,
      'image_source.source_url': 1, 'image_source.provider': 1,
    }},
  ).toArray();
  console.log(`Scanning ${docs.length} artwork records...`);

  const assigned = new Set(); // ids already placed in a group (higher-priority key wins)
  const groups = [];          // { key, keyType, keeper, dupes:[...] }

  // Confidence tiers. source_url / commons_title share the ORIGINAL identity, so
  // a match is the same object (HIGH). title+author+year is only corroborating —
  // it conflates same-subject with same-object (many "Adoration of the Magi",
  // one "Atalanta Fugiens" per emblem), so it's LOW and never an auto-action key.
  const keyPasses = [
    { type: 'commons_sha1', tier: 'high', of: d => (d.commons_sha1 || '').trim() },
    { type: 'source_url', tier: 'review', of: d => normUrl(d.image_source?.source_url) },
    { type: 'title_author_year', tier: 'low', of: d => {
        const t = norm(d.display_title || d.title);
        const a = norm(d.author);
        const y = norm(d.published);
        // Require a real author AND year to even guess — kills cross-century
        // same-subject collisions. Still LOW: same title+author+year can be
        // distinct emblems/plates of one work. Needs visual (CLIP) confirmation.
        return (t.length >= 6 && a && y) ? `${t}|${a}|${y}` : '';
      } },
  ];

  for (const pass of keyPasses) {
    const buckets = new Map();
    for (const d of docs) {
      if (assigned.has(d.id)) continue;
      const k = pass.of(d);
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(d);
    }
    for (const [k, members] of buckets) {
      if (members.length < 2) continue;
      members.forEach(m => assigned.add(m.id));
      const keeper = pickKeeper(members);
      // Album fragments: many records sharing ONE original URL whose titles are
      // sequential pages of one album (Met shunga, #2428). Not dup imports —
      // they route to convert-to-book, so tag them out of the dedup count.
      const titles = members.map(m => (m.display_title || m.title || ''));
      const pageish = titles.filter(t =>
        /\b(page|plate|fol\.?|leaf|scene|view|panel|p\.)\s*\d+/i.test(t) ||
        /\d+\s*of\s*\d+/i.test(t) ||
        /\b(cover|colophon|frontispiece|recto|verso)\b/i.test(t)).length;
      const isAlbum = pass.type === 'source_url' && members.length >= 3 && pageish >= members.length * 0.5;
      groups.push({
        keyType: pass.type,
        tier: isAlbum ? 'album_fragment' : pass.tier,
        key: k.slice(0, 120),
        size: members.length,
        keeper: { id: keeper.id, title: keeper.display_title || keeper.title, visible: keeper.visible },
        remove: members.filter(m => m.id !== keeper.id).map(m => ({
          id: m.id, title: m.display_title || m.title, visible: m.visible,
          provider: m.image_source?.provider,
        })),
      });
    }
  }

  groups.sort((a, b) => b.size - a.size);
  const tally = (tier) => {
    const gs = groups.filter(g => g.tier === tier);
    const recs = gs.reduce((n, g) => n + g.remove.length, 0);
    const vis = gs.reduce((n, g) => n + g.remove.filter(r => r.visible).length, 0);
    return { groups: gs.length, records: recs, visible: vis };
  };
  const tiers = {
    high: tally('high'),                     // commons_sha1 — byte-identical, actionable dedup
    review: tally('review'),                 // shared source_url, non-album — same original, review
    low: tally('low'),                       // title+author+year — UNVERIFIED, over-reports
    album_fragment: tally('album_fragment'), // pages of one album — route to #2428, NOT dedup
  };

  const report = {
    generated_for: 'issue #2209 — artwork record dedup (READ-ONLY, no deletions)',
    caveat: 'HIGH = commons_sha1 identical (byte-identical file, true dup import) — the '
      + 'actionable dedup list. REVIEW = shared source_url (same original record, often '
      + 'multi-view) — manual. LOW = title+author+year only; conflates same-subject with '
      + 'same-object (distinct emblems, common religious subjects) — needs CLIP visual '
      + 'confirmation, do NOT bulk-delete. album_fragment = per-page album records → #2428.',
    scanned: docs.length,
    tiers,
    groups,
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2));

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`\n── Artwork duplicate report (tiered) ──────────────────────`);
    console.log(`Scanned: ${docs.length}`);
    console.log(`HIGH   (commons_sha1 byte-identical):  ${tiers.high.groups} groups, ${tiers.high.records} removable (${tiers.high.visible} visible)`);
    console.log(`REVIEW (shared source_url, non-album):  ${tiers.review.groups} groups, ${tiers.review.records} records — manual`);
    console.log(`LOW    (title-only — UNVERIFIED):       ${tiers.low.groups} groups, ${tiers.low.records} records — needs CLIP, do not bulk-delete`);
    console.log(`ALBUM  (pages of one album → #2428):    ${tiers.album_fragment.groups} groups, ${tiers.album_fragment.records} fragments`);
    console.log(`\nTop HIGH-tier groups (byte-identical dup imports):`);
    for (const g of groups.filter(g => g.tier === 'high').slice(0, 12)) {
      console.log(`  x${g.size}  keep=${g.keeper.id}  "${(g.keeper.title || '').slice(0, 48)}"`);
    }
    console.log(`\nFull report → ${OUT}`);
    console.log(`NB: read-only. Any deletion needs explicit sign-off (Data Protection CRITICAL).`);
  }

  await mc.close();
}

main().catch(e => { console.error(e); process.exit(1); });
