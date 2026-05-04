import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 60;

/**
 * Nightly collection health scorer.
 * Writes health_score, health_tier, health_issues to each visible collection.
 * Triggered by Vercel cron or manual GET.
 */
export async function GET() {
  const db = await getDb();
  const collections = await db.collection('collections').find({ visible: true }).toArray();
  const drafts = await db.collection('curation_drafts')
    .find({ status: 'draft' })
    .project({ collection_slug: 1 })
    .toArray();
  const draftSlugs = new Set(drafts.map((d) => (d as { collection_slug: string }).collection_slug));

  const childMap = new Set<string>();
  for (const col of collections) {
    if (col.parent) childMap.add(col.parent);
  }

  interface ScoredResult {
    slug: string;
    score: number;
    tier: string;
    issues: string[];
  }

  const results: ScoredResult[] = [];
  const ops = [];

  for (const col of collections) {
    const issues: string[] = [];
    let score = 0;
    const isArt = col.collection_type === 'visual_art';

    // Tier A: Required (35 points)
    if (col.name) score += 5;
    else issues.push('missing_name');

    const totalContent = (col.book_count || 0) + (col.artwork_count || 0);
    if (totalContent > 0) score += 15;
    else issues.push('no_content');

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

    if (hasImage) {
      const firstImg = fi?.[0];
      const url = typeof firstImg === 'string' ? firstImg :
        (firstImg?.thumbnail_url || firstImg?.extracted_url || firstImg?.image_url || col.hero_image || '');
      if (url.includes('images.sourcelibrary.org')) score += 5;
      else issues.push('external_image');
    }

    // Tier B: Automated (30 points)
    if (col.description?.length > 20) score += 8;
    else issues.push('no_description');

    if (col.subtitle?.length > 5) score += 4;
    else issues.push('no_subtitle');

    if (fi?.length >= 6) score += 5;
    else if (fi?.length >= 3) score += 3;
    else issues.push('few_images');

    if (isArt) score += 5;
    else if (col.languages?.length > 0) score += 5;
    else issues.push('no_languages');

    if (col.parent || childMap.has(col.slug)) score += 3;
    if (fi?.length >= 6) score += 5;
    else if (fi?.length >= 3) score += 3;

    // Tier C: Curated (30 points)
    if (col.expanded_description?.length >= 200) score += 6;
    else if (col.expanded_description?.length >= 50) score += 3;
    else issues.push('no_expanded_desc');

    const hlCount = col.highlighted_books?.length || 0;
    if (hlCount >= 10) score += 8;
    else if (hlCount >= 5) score += 5;
    else if (hlCount > 0) score += 2;
    else issues.push('no_highlights');

    const tiers = new Set((col.highlighted_books || []).map((h: { tier?: number }) => h.tier));
    if (tiers.has(1) && tiers.has(2) && tiers.has(3)) score += 3;
    else if (tiers.has(1) && tiers.has(2)) score += 2;

    if (col.mentioned_books?.length > 0) score += 3;
    if (col.curated_gallery_images?.length > 0) score += 3;
    if (draftSlugs.has(col.slug)) score += 5;
    if (col.featured_images_curated) score += 2;

    const tier = score >= 80 ? 'S' : score >= 65 ? 'A' : score >= 50 ? 'B' : score >= 35 ? 'C' : 'D';

    results.push({ slug: col.slug, score, tier, issues });
    ops.push({
      updateOne: {
        filter: { slug: col.slug },
        update: { $set: { health_score: score, health_tier: tier, health_issues: issues, health_checked: new Date() } },
      },
    });
  }

  // Batch write
  for (let i = 0; i < ops.length; i += 100) {
    await db.collection('collections').bulkWrite(ops.slice(i, i + 100), { ordered: false });
  }

  const tierCounts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  results.forEach(r => tierCounts[r.tier as keyof typeof tierCounts]++);
  const avg = results.length > 0 ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(1) : '0';

  return NextResponse.json({
    scored: results.length,
    tiers: tierCounts,
    average: parseFloat(avg),
    needsAttention: results.filter(r => r.tier === 'C' || r.tier === 'D').map(r => r.slug),
  });
}
