#!/usr/bin/env node
/**
 * Rank a collection's `featured_images` so the card leads with a good, on-topic
 * illustration instead of a blank margin, a library bookplate, or a title page.
 *
 * Two problems this fixes, both seen on /collections/* (2026-06-03):
 *  1. BLANK / sliver first image — gallery extraction sometimes promotes a blank
 *     page-margin (pure-white 116x2124 sliver) or a near-empty faint scan. The
 *     card renders featured_images[0] and CollectionCardImage only advances on a
 *     404, so a blank-but-valid 200 image sticks and the card looks empty.
 *  2. FRONT-MATTER first image — a bookplate / library stamp / plain title page
 *     is "not blank" but isn't representative. These score lower on
 *     `gallery_quality` than figural engravings/portraits, which are usually
 *     present further down the same featured_images list.
 *
 * Scoring per image (sorted descending, stable):
 *   - blank / sliver / 404  → -1  (sinks to the end)
 *   - else                  → gallery_quality (joined from gallery_images via the
 *                             id embedded in the /gallery/.../{id}-thumb.jpg URL),
 *                             or 0.5 when the image isn't a gallery URL (neutral).
 *
 * Non-destructive: nothing is deleted, only reordered; hero_image is set to the
 * new first. Collections whose images are ALL bad keep blank cards and need a
 * cover sourced from a member book (handled separately).
 *
 * NOTE: /collections/* pages are statically prerendered (revalidate=86400). A
 * redeploy is required to surface changes — on-demand revalidatePath did NOT bust
 * the prerendered route cache in testing.
 *
 * Usage (Hetzner or local with sharp):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-blank-featured-images.mjs           # dry run
 *   node scripts/maintenance/fix-blank-featured-images.mjs --apply   # write
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply');

const tu = (f) => (!f ? null : typeof f === 'string' ? f : f.thumbnail_url || f.extracted_url || f.image_url);
const galId = (f) => {
  const u = tu(f) || '';
  const m = u.match(/\/gallery\/[^/]+\/([0-9a-f]+-\d+)(?:-thumb)?\.jpg/);
  return m ? m[1] : null;
};

const qCache = new Map();
async function quality(gi, f) {
  const id = galId(f);
  if (!id) return null;
  if (qCache.has(id)) return qCache.get(id);
  const g = await gi.findOne({ id }, { projection: { gallery_quality: 1 } });
  const q = g?.gallery_quality ?? null;
  qCache.set(id, q);
  return q;
}

const bCache = new Map();
async function isBad(f) {
  const u = tu(f);
  if (!u) return true;
  if (bCache.has(u)) return bCache.get(u);
  let bad = false;
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { bCache.set(u, true); return true; }
    const buf = Buffer.from(await r.arrayBuffer());
    const m = await sharp(buf).metadata();
    const ar = (m.width || 1) / (m.height || 1);
    if (ar < 0.18 || ar > 5.5) bad = true;              // sliver crop
    else {
      const s = await sharp(buf).stats();
      if (Math.max(...s.channels.map((x) => x.stdev)) < 10) bad = true; // blank / near-uniform
    }
  } catch { bad = true; }
  bCache.set(u, bad);
  return bad;
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 0 });
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || 'bookstore');
  const coll = db.collection('collections');
  const gi = db.collection('gallery_images');

  const all = await coll.find({}, { projection: { name: 1, featured_images: 1 } }).toArray();
  let changed = 0, allBad = 0;

  for (const d of all) {
    const fi = d.featured_images || [];
    if (fi.length < 2) continue;
    const scored = [];
    for (let i = 0; i < fi.length; i++) {
      const f = fi[i];
      const bad = await isBad(f);
      const q = await quality(gi, f);
      scored.push({ f, score: bad ? -1 : (q ?? 0.5), i });
    }
    const sorted = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
    if (sorted[0].score < 0) { allBad++; console.log(`ALL-BAD (needs book cover): ${d.name}`); continue; }
    const newOrder = sorted.map((s) => s.f);
    if (JSON.stringify(newOrder) === JSON.stringify(fi)) continue;
    changed++;
    if (changed <= 15) console.log(`RANK: ${d.name} → top score ${sorted[0].score} (was idx ${sorted[0].i})`);
    if (APPLY) await coll.updateOne({ _id: d._id }, { $set: { featured_images: newOrder, hero_image: tu(newOrder[0]) } });
  }

  console.log('---');
  console.log(`reordered: ${changed}${APPLY ? '' : ' (dry run)'} | all-bad (need book cover): ${allBad}`);
  await c.close();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
