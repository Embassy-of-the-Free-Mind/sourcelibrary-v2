#!/usr/bin/env node
/**
 * Pre-compute Iconclass category tree with counts and representative thumbnails.
 * Stores result in system_config._id: 'iconclass_tree'.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/compute-iconclass-tree.mjs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const TOP_DIVISIONS = [
  { code: '0', label: 'Abstract Art' },
  { code: '1', label: 'Religion & Magic' },
  { code: '2', label: 'Nature' },
  { code: '3', label: 'Human Figure' },
  { code: '4', label: 'Society & Culture' },
  { code: '5', label: 'Ideas & Concepts' },
  { code: '6', label: 'History' },
  { code: '7', label: 'Bible' },
  { code: '8', label: 'Literature' },
  { code: '9', label: 'Classical Mythology' },
];

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Aggregating gallery_images iconclass codes...');
  const galleryAgg = await db.collection('gallery_images').aggregate([
    { $match: { 'metadata.iconclass': { $exists: true, $ne: [] } } },
    { $sort: { gallery_quality: -1 } }, // best images first so $first picks quality thumbnails
    { $unwind: '$metadata.iconclass' },
    {
      $group: {
        _id: '$metadata.iconclass',
        count: { $sum: 1 },
        sample_url: { $first: '$thumbnail_url' },
        sample_extracted: { $first: '$extracted_url' },
      },
    },
    { $sort: { count: -1 } },
  ], { maxTimeMS: 120000, allowDiskUse: true }).toArray();
  console.log(`  ${galleryAgg.length} unique gallery codes`);

  console.log('Aggregating artworks iconclass codes...');
  const artworkAgg = await db.collection('books').aggregate([
    { $match: { 'enrichment.iconclass': { $exists: true, $ne: [] }, resource_type: { $exists: true } } },
    { $unwind: '$enrichment.iconclass' },
    {
      $group: {
        _id: '$enrichment.iconclass',
        count: { $sum: 1 },
        sample_url: { $first: '$thumbnail' },
      },
    },
    { $sort: { count: -1 } },
  ], { maxTimeMS: 120000, allowDiskUse: true }).toArray();
  console.log(`  ${artworkAgg.length} unique artwork codes`);

  // Merge into a single map: code -> { gallery_count, artwork_count, thumbnail }
  const codeMap = new Map();
  for (const g of galleryAgg) {
    codeMap.set(g._id, {
      gallery_count: g.count,
      artwork_count: 0,
      thumbnail: g.sample_extracted || g.sample_url || null,
    });
  }
  for (const a of artworkAgg) {
    const existing = codeMap.get(a._id);
    if (existing) {
      existing.artwork_count = a.count;
      if (!existing.thumbnail && a.sample_url) existing.thumbnail = a.sample_url;
    } else {
      codeMap.set(a._id, {
        gallery_count: 0,
        artwork_count: a.count,
        thumbnail: a.sample_url || null,
      });
    }
  }

  // Build hierarchy: aggregate counts up to parent codes
  // For each code, compute prefix counts at each level
  const prefixCounts = new Map(); // prefix -> { count, children: Set }

  for (const [code, data] of codeMap) {
    const total = data.gallery_count + data.artwork_count;

    // Add the full code as a leaf — gets its own thumbnail
    if (!prefixCounts.has(code)) {
      prefixCounts.set(code, { count: 0, gallery_count: 0, artwork_count: 0, thumbnail: null, children: new Set() });
    }
    const leaf = prefixCounts.get(code);
    leaf.count += total;
    leaf.gallery_count += data.gallery_count;
    leaf.artwork_count += data.artwork_count;
    if (!leaf.thumbnail && data.thumbnail) leaf.thumbnail = data.thumbnail;

    // Aggregate counts up to parent prefixes (but NOT thumbnails)
    for (let len = 1; len < code.length; len++) {
      const prefix = code.slice(0, len);
      if (!prefixCounts.has(prefix)) {
        prefixCounts.set(prefix, { count: 0, gallery_count: 0, artwork_count: 0, thumbnail: null, children: new Set() });
      }
      const node = prefixCounts.get(prefix);
      node.count += total;
      node.gallery_count += data.gallery_count;
      node.artwork_count += data.artwork_count;
      // Don't propagate thumbnails up — each node picks its own below

      // Track immediate children (next level only)
      const childPrefix = code.slice(0, len + 1);
      if (childPrefix.length <= code.length) {
        node.children.add(childPrefix);
      }
    }
  }

  // Assign thumbnails bottom-up: only pure prefix nodes (no direct images)
  // need a thumbnail from their children. Nodes that already have a thumbnail
  // from the codeMap keep it — this ensures siblings show distinct images.
  const codesByLength = [...prefixCounts.keys()].sort((a, b) => b.length - a.length);
  for (const code of codesByLength) {
    const data = prefixCounts.get(code);
    if (data.thumbnail) continue; // already has own image, keep it
    if (data.children.size === 0) continue;
    // Pure prefix node: pick highest-count child's thumbnail
    const childThumbs = [...data.children]
      .map(c => ({ code: c, ...(prefixCounts.get(c) || {}) }))
      .filter(c => c.thumbnail)
      .sort((a, b) => (b.count || 0) - (a.count || 0));
    if (childThumbs.length > 0) {
      data.thumbnail = childThumbs[0].thumbnail;
    }
  }

  // Build the tree document
  // Top-level: the 10 divisions
  const nodes = {};
  for (const div of TOP_DIVISIONS) {
    const data = prefixCounts.get(div.code);
    if (!data || data.count === 0) continue;

    // Get immediate children with significant counts
    const children = [...data.children]
      .filter(c => {
        const cd = prefixCounts.get(c);
        return cd && cd.count >= 3; // minimum threshold
      })
      .sort((a, b) => (prefixCounts.get(b)?.count || 0) - (prefixCounts.get(a)?.count || 0))
      .slice(0, 30); // cap children per node

    nodes[div.code] = {
      label: div.label,
      count: data.count,
      gallery_count: data.gallery_count,
      artwork_count: data.artwork_count,
      thumbnail: data.thumbnail,
      children,
    };

    // Add sub-nodes (2 levels deep from top)
    for (const childCode of children) {
      const childData = prefixCounts.get(childCode);
      if (!childData) continue;

      const grandchildren = [...childData.children]
        .filter(c => {
          const cd = prefixCounts.get(c);
          return cd && cd.count >= 3;
        })
        .sort((a, b) => (prefixCounts.get(b)?.count || 0) - (prefixCounts.get(a)?.count || 0))
        .slice(0, 20);

      nodes[childCode] = {
        count: childData.count,
        gallery_count: childData.gallery_count,
        artwork_count: childData.artwork_count,
        thumbnail: childData.thumbnail,
        children: grandchildren,
      };

      // One more level
      for (const gcCode of grandchildren) {
        const gcData = prefixCounts.get(gcCode);
        if (!gcData) continue;

        const ggChildren = [...gcData.children]
          .filter(c => {
            const cd = prefixCounts.get(c);
            return cd && cd.count >= 3;
          })
          .sort((a, b) => (prefixCounts.get(b)?.count || 0) - (prefixCounts.get(a)?.count || 0))
          .slice(0, 15);

        nodes[gcCode] = {
          count: gcData.count,
          gallery_count: gcData.gallery_count,
          artwork_count: gcData.artwork_count,
          thumbnail: gcData.thumbnail,
          children: ggChildren,
        };
      }
    }
  }

  // Fetch labels from Iconclass API for all nodes that don't have one
  const unlabeled = Object.keys(nodes).filter(code => !nodes[code].label);
  if (unlabeled.length > 0) {
    console.log(`\nFetching labels from iconclass.org for ${unlabeled.length} codes (10 concurrent)...`);
    let fetched = 0;
    const CONCURRENCY = 10;

    for (let i = 0; i < unlabeled.length; i += CONCURRENCY) {
      const batch = unlabeled.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (code) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          try {
            const res = await fetch(
              `https://iconclass.org/${encodeURIComponent(code)}.json`,
              { signal: controller.signal }
            );
            clearTimeout(timeout);
            if (!res.ok) return null;
            const data = await res.json();
            return { code, label: data.txt?.en || null };
          } catch {
            clearTimeout(timeout);
            return null;
          }
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.label) {
          nodes[r.value.code].label = r.value.label;
          fetched++;
        }
      }

      if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= unlabeled.length) {
        console.log(`  ${Math.min(i + CONCURRENCY, unlabeled.length)}/${unlabeled.length} checked, ${fetched} resolved`);
      }
    }
    console.log(`  Resolved ${fetched}/${unlabeled.length} labels`);
  }

  const treeDoc = {
    _id: 'iconclass_tree',
    nodes,
    total_codes: codeMap.size,
    total_items: [...codeMap.values()].reduce((sum, d) => sum + d.gallery_count + d.artwork_count, 0),
    updated_at: new Date(),
  };

  console.log(`\nTree: ${Object.keys(nodes).length} nodes, ${treeDoc.total_codes} unique codes, ${treeDoc.total_items} total items`);

  // Top-level summary
  for (const div of TOP_DIVISIONS) {
    const n = nodes[div.code];
    if (n) console.log(`  ${div.code} ${div.label}: ${n.count.toLocaleString()} (${n.children.length} sub-categories)`);
  }

  await db.collection('system_config').replaceOne(
    { _id: 'iconclass_tree' },
    treeDoc,
    { upsert: true }
  );
  console.log('\nSaved to system_config.iconclass_tree');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
