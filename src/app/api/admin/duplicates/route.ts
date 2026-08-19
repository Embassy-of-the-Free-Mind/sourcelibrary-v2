import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { isTrustedEditionKey } from '@/lib/edition-key';

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

/**
 * Volume guessed from an Internet Archive identifier ("...v02...", "...02cat").
 * Kept as a SPLITTER only: it can rescue a multi-volume set whose volume never
 * made it into the title, but it is a regex over an opaque string and must
 * never be the thing that merges two books.
 */
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
export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url);
  const tierFilter = url.searchParams.get('tier') || 'all';

  const db = await getDb();
  const books = await db.collection('books').find(
    { visible: true },
    { projection: {
      id: 1, title: 1, author: 1, slug: 1,
      normalized_title: 1, normalized_author: 1,
      edition_key: 1, edition_key_quality: 1, edition_external_ids: 1,
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

  // Tier 3: USTC edition authority.
  // Where a USTC number is verified edition-level (`ustc_scope: 'edition'` —
  // the USTC record's own year agrees with ours), two books carrying it are the
  // same printing by authority, not by heuristic. That outranks any string
  // match, so it sits with the exact tiers. Ids whose scope is 'unverified' are
  // deliberately ignored here: the AI matcher was willing to match a book to a
  // different printing of the same work, so an unverified id is a work-level
  // pointer and merging on it would destroy real editions.
  if (tierFilter === 'all' || tierFilter === 'exact') {
    const ustcMap = new Map<string, Record<string, unknown>[]>();
    for (const b of books) {
      const ext = b.edition_external_ids as { ustc?: string; ustc_scope?: string } | undefined;
      if (!ext?.ustc || ext.ustc_scope !== 'edition') continue;
      if (!ustcMap.has(ext.ustc)) ustcMap.set(ext.ustc, []);
      ustcMap.get(ext.ustc)!.push(b);
    }
    for (const [ustc, group] of ustcMap) {
      if (group.length < 2) continue;
      const keeper = pickKeeper(group);
      if (groups.some(g => g.keeper.id === toSummary(keeper).id)) continue;
      groups.push({
        tier: 'ustc_edition',
        confidence: 'exact',
        reason: `Same USTC edition record (USTC ${ustc}), year-verified`,
        keeper: toSummary(keeper),
        dupes: group.filter(b => b.id !== keeper.id).map(toSummary),
      });
    }
  }

  // Tier 4: the materialized edition layer (#3258 workstream A).
  //
  // Replaces this route's old private title+author+volume matcher — the THIRD
  // divergent implementation of "same edition" in the codebase, which is why
  // the same corpus read as 456 or 296 clusters depending on who you asked.
  // `edition_key` is strictly more discriminating than what it replaces: it
  // adds the publication year (so two printings of one title stop reading as
  // copies) and relaxes the author to a surname (so "Lobel, Matthias de" and
  // "Matthias de Lobel" stop reading as two editions).
  if (tierFilter === 'all' || tierFilter === 'high' || tierFilter === 'medium') {
    const edMap = new Map<string, Record<string, unknown>[]>();
    for (const b of books) {
      const key = b.edition_key as string | undefined;
      if (!key) continue;
      if (!edMap.has(key)) edMap.set(key, []);
      edMap.get(key)!.push(b);
    }

    for (const [, group] of edMap) {
      if (group.length < 2) continue;

      // The IA-identifier volume guess survives as a splitter only: if every
      // member reveals a DIFFERENT volume there, this is a multi-volume set
      // whose volumes never reached the title, not a pile of copies.
      const idVols = group.map(b =>
        extractVolumeFromIdentifier((b.ia_identifier as string) || (b.image_source as Record<string, string>)?.identifier)
      );
      const known = idVols.filter(Boolean);
      if (known.length === group.length && new Set(known).size === group.length) continue;

      const providers = new Set(group.map(b => (b.image_source as Record<string, string>)?.provider));
      const pageCounts = group.map(b => b.pages_count as number).filter(Boolean);
      const pcSim = pageCounts.length >= 2 ? Math.min(...pageCounts) / Math.max(...pageCounts) : null;

      // Two independent signals of confidence: how much of the key is actually
      // evidenced (a key with no year merges every printing of that title), and
      // whether the two scans are even the same length.
      const trusted = isTrustedEditionKey(group[0].edition_key_quality as string);
      const confidence = trusted && pcSim !== null && pcSim > 0.6 ? 'high' as const : 'medium' as const;
      if (tierFilter !== 'all' && tierFilter !== confidence) continue;

      const keeper = pickKeeper(group);
      if (groups.some(g => g.keeper.id === toSummary(keeper).id)) continue;
      const providerList = [...providers].join(', ');
      const quality = group[0].edition_key_quality as string;
      groups.push({
        tier: providers.size > 1 ? 'cross_source_edition' : 'same_source_edition',
        confidence,
        reason: `Same edition key${trusted ? '' : ` (${quality} — weak key, verify before merging)`}` +
          `${providers.size > 1 ? ` across ${providerList}` : ` within ${providerList}`}` +
          `${pcSim ? ` (${(pcSim * 100).toFixed(0)}% page similarity)` : ''}`,
        keeper: toSummary(keeper),
        dupes: group.filter(b => b.id !== keeper.id).map(toSummary),
      });
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
export const POST = withAdminAuth(async (request) => {
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
    { id: { $in: bookIds }, visible: true },
    { $set: {
      hidden: true, visible: false,
      hidden_reason: 'duplicate',
      hidden_at: now,
      updated_at: now, // books_catalog sync keys on this — without it the flip never reaches Supabase
      ...(keeperId ? { duplicate_of: keeperId } : {}),
    }}
  );

  return NextResponse.json({
    hidden: result.modifiedCount,
    requested: bookIds.length,
  });
});
