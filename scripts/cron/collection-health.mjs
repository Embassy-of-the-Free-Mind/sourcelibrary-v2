#!/usr/bin/env node
/**
 * Collection Health Scorer
 *
 * Scores every visible collection on a 0-100 scale and writes
 * `health_score` + `health_issues` to the collection document.
 * Designed to run as a nightly cron.
 *
 * Scoring:
 *   Tier A (required):  40 points max
 *   Tier B (automated): 30 points max
 *   Tier C (curated):   30 points max
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/cron/collection-health.mjs
 *   node scripts/cron/collection-health.mjs --verbose
 *   node scripts/cron/collection-health.mjs --report   # Print report, don't write to DB
 */

import { MongoClient } from 'mongodb';

const VERBOSE = process.argv.includes('--verbose');
const REPORT_ONLY = process.argv.includes('--report');

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const collections = await db.collection('collections').find({ visible: true }).toArray();
  const drafts = await db.collection('curation_drafts').find({ status: 'draft' })
    .project({ collection_slug: 1 }).toArray();
  const draftSlugs = new Set(drafts.map(d => d.collection_slug));

  const results = [];
  const ops = [];

  for (const col of collections) {
    const issues = [];
    let score = 0;
    const isArt = col.collection_type === 'visual_art';

    // --- Tier A: Required (40 points) ---
    // Name (5)
    if (col.name) score += 5;
    else issues.push('missing_name');

    // Has content (15)
    const bookCount = col.book_count || 0;
    const artCount = col.artwork_count || 0;
    const totalContent = bookCount + artCount;
    if (totalContent > 0) score += 15;
    else issues.push('no_content');

    // Cover image (10)
    const fi = col.featured_images;
    let hasImage = false;
    if (fi?.length > 0) {
      const first = fi[0];
      if (typeof first === 'string' && first.startsWith('http')) hasImage = true;
      else if (typeof first === 'object' && (first.thumbnail_url || first.extracted_url || first.image_url)) hasImage = true;
    }
    if (col.hero_image) hasImage = true;
    if (hasImage) score += 10;
    else issues.push('no_image');

    // Image on R2 (not external) (5)
    if (hasImage) {
      const firstImg = fi?.[0];
      const url = typeof firstImg === 'string' ? firstImg :
        (firstImg?.thumbnail_url || firstImg?.extracted_url || firstImg?.image_url || col.hero_image || '');
      if (url.includes('images.sourcelibrary.org')) score += 5;
      else issues.push('external_image');
    }

    // Book count accurate (5)
    // Skip this check in cron to avoid per-collection queries — trust sync-page-counts

    // --- Tier B: Automated (30 points) ---
    // Description (8)
    if (col.description && col.description.length > 20) score += 8;
    else issues.push('no_description');

    // Subtitle (4)
    if (col.subtitle && col.subtitle.length > 5) score += 4;
    else issues.push('no_subtitle');

    // Featured images ≥ 3 (5)
    if (fi?.length >= 3) score += 5;
    else issues.push('few_images');

    // Languages (5) — skip for art collections
    if (isArt) {
      score += 5; // Art collections get this free
    } else if (col.languages?.length > 0) {
      score += 5;
    } else {
      issues.push('no_languages');
    }

    // Hierarchy (parent or has children) (3)
    if (col.parent || collections.some(c2 => c2.parent === col.slug)) score += 3;

    // Multiple featured_images (5)
    if (fi?.length >= 6) score += 5;
    else if (fi?.length >= 3) score += 3;

    // --- Tier C: Curated (30 points) ---
    // Expanded description ≥ 200 chars (6)
    if (col.expanded_description?.length >= 200) score += 6;
    else if (col.expanded_description?.length >= 50) { score += 3; issues.push('short_expanded_desc'); }
    else issues.push('no_expanded_desc');

    // Highlighted books (8)
    const hlCount = col.highlighted_books?.length || 0;
    if (hlCount >= 10) score += 8;
    else if (hlCount >= 5) score += 5;
    else if (hlCount > 0) score += 2;
    else issues.push('no_highlights');

    // Highlight tiers (3)
    const tiers = new Set((col.highlighted_books || []).map(h => h.tier));
    if (tiers.has(1) && tiers.has(2) && tiers.has(3)) score += 3;
    else if (tiers.has(1) && tiers.has(2)) score += 2;

    // Mentioned books (3)
    if (col.mentioned_books?.length > 0) score += 3;
    else if (!isArt) issues.push('no_mentioned_books');

    // Curated gallery images (3)
    if (col.curated_gallery_images?.length > 0) score += 3;

    // Exhibition layout (5)
    if (draftSlugs.has(col.slug)) score += 5;

    // Featured images curated (2)
    if (col.featured_images_curated) score += 2;

    // Determine tier
    let tier;
    if (score >= 80) tier = 'S';
    else if (score >= 65) tier = 'A';
    else if (score >= 50) tier = 'B';
    else if (score >= 35) tier = 'C';
    else tier = 'D';

    results.push({
      slug: col.slug,
      name: col.name,
      score,
      tier,
      issues,
      isArt,
      content: totalContent,
    });

    if (!REPORT_ONLY) {
      ops.push({
        updateOne: {
          filter: { slug: col.slug },
          update: {
            $set: {
              health_score: score,
              health_tier: tier,
              health_issues: issues,
              health_checked: new Date(),
            },
          },
        },
      });
    }
  }

  // Write to DB
  if (!REPORT_ONLY && ops.length > 0) {
    for (let i = 0; i < ops.length; i += 100) {
      await db.collection('collections').bulkWrite(ops.slice(i, i + 100), { ordered: false });
    }
  }

  // Report
  results.sort((a, b) => b.score - a.score);

  const tierCounts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  results.forEach(r => tierCounts[r.tier]++);

  console.log('=== COLLECTION HEALTH REPORT ===');
  console.log(`Total scored: ${results.length}`);
  console.log(`Tier S (80+): ${tierCounts.S}`);
  console.log(`Tier A (65-79): ${tierCounts.A}`);
  console.log(`Tier B (50-64): ${tierCounts.B}`);
  console.log(`Tier C (35-49): ${tierCounts.C}`);
  console.log(`Tier D (<35): ${tierCounts.D}`);
  console.log(`Average score: ${(results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1)}`);

  // Show regressions (D tier = needs attention)
  const needsAttention = results.filter(r => r.tier === 'D' || r.tier === 'C');
  if (needsAttention.length > 0) {
    console.log(`\n--- NEEDS ATTENTION (${needsAttention.length}) ---`);
    needsAttention.forEach(r => {
      console.log(`  ${r.slug} | score: ${r.score} | ${r.content} items | issues: ${r.issues.join(', ')}`);
    });
  }

  if (VERBOSE) {
    console.log('\n--- ALL SCORES ---');
    results.forEach(r => {
      console.log(`  ${r.tier} ${r.score.toString().padStart(2)} | ${r.slug} | ${r.issues.length ? r.issues.join(', ') : 'OK'}`);
    });
  }

  // Common issues
  const issueCounts = {};
  results.forEach(r => r.issues.forEach(i => issueCounts[i] = (issueCounts[i] || 0) + 1));
  console.log('\n--- MOST COMMON ISSUES ---');
  Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).forEach(([issue, count]) => {
    console.log(`  ${issue}: ${count} collections`);
  });

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
