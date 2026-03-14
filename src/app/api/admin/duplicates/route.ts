import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { normalizeTitle, normalizeAuthor } from '@/lib/dedup';

export const maxDuration = 30;

interface DupeGroup {
  tier: string;
  confidence: 'exact' | 'high' | 'medium';
  reason: string;
  keeper: BookSummary;
  dupes: BookSummary[];
}

interface BookSummary {
  id: string;
  title: string;
  author: string;
  provider: string;
  pagesCount: number;
  pagesOcr: number;
  pagesTranslated: number;
  slug: string;
}

function extractVolume(title: string): string | null {
  const m = title.match(/\b(?:vol(?:ume)?|tomus?|band|tome?|part|teil|livre|liber|pars|fascicul)\.?\s*(\d+|[ivxlcdm]+)\b/i);
  if (m) return m[1].toLowerCase();
  const m2 = title.match(/[.,;:\-–—]\s*(\d+)\s*$/);
  if (m2) return m2[1];
  return null;
}

function extractVolumeFromIdentifier(iaId: string | undefined): string | null {
  if (!iaId) return null;
  const m = iaId.match(/[a-z](\d{2})[a-z]/i);
  if (m && parseInt(m[1]) > 0 && parseInt(m[1]) < 50) return m[1];
  const m2 = iaId.match(/(\d{2})[a-z]{2,6}$/i);
  if (m2 && parseInt(m2[1]) > 0 && parseInt(m2[1]) < 50) return m2[1];
  return null;
}

function toSummary(b: Record<string, unknown>): BookSummary {
  return {
    id: (b.id as string) || (b._id as { toString(): string })?.toString(),
    title: (b.title as string) || '',
    author: (b.author as string) || '',
    provider: (b.image_source as Record<string, string>)?.provider || '',
    pagesCount: (b.pages_count as number) || 0,
    pagesOcr: (b.pages_ocr as number) || 0,
    pagesTranslated: (b.pages_translated as number) || 0,
    slug: (b.slug as string) || '',
  };
}

function pickKeeper(group: Record<string, unknown>[]): Record<string, unknown> {
  return [...group].sort((a, b) => {
    const at = (a.pages_translated as number) || 0;
    const bt = (b.pages_translated as number) || 0;
    if (at !== bt) return bt - at;
    const ao = (a.pages_ocr as number) || 0;
    const bo = (b.pages_ocr as number) || 0;
    if (ao !== bo) return bo - ao;
    return ((b.pages_count as number) || 0) - ((a.pages_count as number) || 0);
  })[0];
}

/**
 * GET /api/admin/duplicates
 *
 * Scan for duplicate books across all tiers.
 * Returns actionable groups with keeper/dupe recommendations.
 *
 * Query params:
 *   tier: 'all' | 'exact' | 'high' | 'medium' (default: 'all')
 *
 * POST /api/admin/duplicates
 *
 * Hide duplicate books.
 * Body: { bookIds: string[], reason?: string }
 */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const tierFilter = url.searchParams.get('tier') || 'all';

  const db = await getDb();
  const books = await db.collection('books').find(
    { hidden: { $ne: true } },
    { projection: {
      id: 1, title: 1, author: 1, slug: 1,
      normalized_title: 1, normalized_author: 1,
      source_fingerprint: 1,
      pages_count: 1, pages_ocr: 1, pages_translated: 1,
      'image_source.provider': 1, 'image_source.iiif_manifest': 1,
      'image_source.identifier': 1,
      ia_identifier: 1,
    }}
  ).toArray();

  const groups: DupeGroup[] = [];

  // Tier 1: Fingerprint
  if (tierFilter === 'all' || tierFilter === 'exact') {
    const fpMap = new Map<string, Record<string, unknown>[]>();
    for (const b of books) {
      const fp = b.source_fingerprint as string;
      if (!fp) continue;
      if (!fpMap.has(fp)) fpMap.set(fp, []);
      fpMap.get(fp)!.push(b);
    }
    for (const [fp, group] of fpMap) {
      if (group.length < 2) continue;
      const keeper = pickKeeper(group);
      groups.push({
        tier: 'fingerprint',
        confidence: 'exact',
        reason: `Same source fingerprint: ${fp}`,
        keeper: toSummary(keeper),
        dupes: group.filter(b => b.id !== keeper.id).map(toSummary),
      });
    }
  }

  // Tier 2: IIIF manifest
  if (tierFilter === 'all' || tierFilter === 'exact') {
    const iiifMap = new Map<string, Record<string, unknown>[]>();
    for (const b of books) {
      const m = (b.image_source as Record<string, string>)?.iiif_manifest;
      if (!m) continue;
      if (!iiifMap.has(m)) iiifMap.set(m, []);
      iiifMap.get(m)!.push(b);
    }
    for (const [, group] of iiifMap) {
      if (group.length < 2) continue;
      const keeper = pickKeeper(group);
      if (groups.some(g => g.keeper.id === toSummary(keeper).id)) continue;
      groups.push({
        tier: 'iiif_manifest',
        confidence: 'exact',
        reason: 'Same IIIF manifest URL',
        keeper: toSummary(keeper),
        dupes: group.filter(b => b.id !== keeper.id).map(toSummary),
      });
    }
  }

  // Tier 3: Title+Author (volume-aware)
  if (tierFilter === 'all' || tierFilter === 'high' || tierFilter === 'medium') {
    const taMap = new Map<string, Record<string, unknown>[]>();
    for (const b of books) {
      const nt = b.normalized_title as string;
      if (!nt || nt.length < 5 || ['unknown', 'untitled'].includes(nt)) continue;
      const key = `${nt}|||${(b.normalized_author as string) || ''}`;
      if (!taMap.has(key)) taMap.set(key, []);
      taMap.get(key)!.push(b);
    }

    for (const [key, group] of taMap) {
      if (group.length < 2) continue;

      // Volume-aware filtering
      const withVols = group.map(b => {
        const vol = extractVolume((b.title as string) || '') ||
                    extractVolumeFromIdentifier((b.ia_identifier as string) || (b.image_source as Record<string, string>)?.identifier);
        return { book: b, vol };
      });
      const vols = withVols.map(w => w.vol).filter(Boolean);
      const uniqueVols = new Set(vols);
      if (vols.length === group.length && uniqueVols.size === group.length) continue;

      // Group by volume to find collisions
      const volBuckets = new Map<string, Record<string, unknown>[]>();
      for (const w of withVols) {
        const v = w.vol || '__none__';
        if (!volBuckets.has(v)) volBuckets.set(v, []);
        volBuckets.get(v)!.push(w.book);
      }

      for (const [, subgroup] of volBuckets) {
        if (subgroup.length < 2) continue;
        const providers = new Set(subgroup.map(b => (b.image_source as Record<string, string>)?.provider));
        const pageCounts = subgroup.map(b => b.pages_count as number).filter(Boolean);
        let pcSim: number | null = null;
        if (pageCounts.length >= 2) {
          pcSim = Math.min(...pageCounts) / Math.max(...pageCounts);
        }

        const confidence = pcSim !== null && pcSim > 0.6 ? 'high' as const : 'medium' as const;
        if (tierFilter !== 'all' && tierFilter !== confidence) continue;

        const keeper = pickKeeper(subgroup);
        const providerList = [...providers].join(', ');
        groups.push({
          tier: providers.size > 1 ? 'cross_source_title' : 'same_source_title',
          confidence,
          reason: `Same title+author${providers.size > 1 ? ` across ${providerList}` : ` within ${providerList}`}${pcSim ? ` (${(pcSim * 100).toFixed(0)}% page similarity)` : ''}`,
          keeper: toSummary(keeper),
          dupes: subgroup.filter(b => b.id !== keeper.id).map(toSummary),
        });
      }
    }
  }

  // Sort: exact first, then high, then medium
  const order = { exact: 0, high: 1, medium: 2 };
  groups.sort((a, b) => order[a.confidence] - order[b.confidence]);

  const exact = groups.filter(g => g.confidence === 'exact');
  const high = groups.filter(g => g.confidence === 'high');
  const medium = groups.filter(g => g.confidence === 'medium');

  return NextResponse.json({
    totalBooks: books.length,
    summary: {
      exact: { groups: exact.length, dupes: exact.reduce((s, g) => s + g.dupes.length, 0) },
      high: { groups: high.length, dupes: high.reduce((s, g) => s + g.dupes.length, 0) },
      medium: { groups: medium.length, dupes: medium.reduce((s, g) => s + g.dupes.length, 0) },
    },
    groups,
  });
});

/**
 * POST /api/admin/duplicates
 *
 * Hide specified books as duplicates.
 * Body: { bookIds: string[], keeperId?: string }
 */
export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { bookIds, keeperId } = body;

  if (!bookIds || !Array.isArray(bookIds) || bookIds.length === 0) {
    return NextResponse.json({ error: 'bookIds array required' }, { status: 400 });
  }

  if (bookIds.length > 50) {
    return NextResponse.json({ error: 'Max 50 books per request' }, { status: 400 });
  }

  const db = await getDb();
  const now = new Date();

  const result = await db.collection('books').updateMany(
    { id: { $in: bookIds }, hidden: { $ne: true } },
    { $set: {
      hidden: true,
      hidden_reason: 'duplicate',
      hidden_at: now,
      ...(keeperId ? { duplicate_of: keeperId } : {}),
    }}
  );

  return NextResponse.json({
    hidden: result.modifiedCount,
    requested: bookIds.length,
  });
});
