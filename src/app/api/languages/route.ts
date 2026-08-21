import { NextRequest, NextResponse } from 'next/server';
import { getLanguageCounts } from '@/lib/books-catalog';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { getReadDb } from '@/lib/mongodb';

export interface LanguageWithCount {
  code: string;
  name: string;
  book_count: number;
}

// Language normalization map to standardize language names
const LANGUAGE_NORMALIZATION: Record<string, string> = {
  'latin': 'Latin', 'LATIN': 'Latin',
  'german': 'German', 'GERMAN': 'German', 'deutsch': 'German',
  'french': 'French', 'FRENCH': 'French', 'français': 'French', 'francais': 'French',
  'italian': 'Italian', 'ITALIAN': 'Italian', 'italiano': 'Italian',
  'english': 'English', 'ENGLISH': 'English',
  'dutch': 'Dutch', 'DUTCH': 'Dutch', 'nederlands': 'Dutch',
  'spanish': 'Spanish', 'SPANISH': 'Spanish', 'español': 'Spanish', 'espanol': 'Spanish',
  'greek': 'Greek', 'GREEK': 'Greek',
  'hebrew': 'Hebrew', 'HEBREW': 'Hebrew',
  'arabic': 'Arabic', 'ARABIC': 'Arabic',
  'portuguese': 'Portuguese', 'PORTUGUESE': 'Portuguese', 'português': 'Portuguese', 'portugues': 'Portuguese',
};

export const CANONICAL_LANGUAGES = [
  'Latin', 'German', 'French', 'Italian', 'English', 'Dutch', 'Spanish',
  'Greek', 'Hebrew', 'Arabic', 'Portuguese', 'Sanskrit', 'Syriac', 'Aramaic',
  'Old English', 'Middle English',
];

export function normalizeLanguage(language: string | null | undefined): string {
  if (!language) return 'Unknown';
  const trimmed = language.trim();
  if (LANGUAGE_NORMALIZATION[trimmed]) return LANGUAGE_NORMALIZATION[trimmed];
  if (CANONICAL_LANGUAGES.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (LANGUAGE_NORMALIZATION[lower]) return LANGUAGE_NORMALIZATION[lower];
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// GET /api/languages — powered by Supabase books_catalog (or MongoDB for tenant-scoped)
export async function GET(request: NextRequest) {
  try {
    // Tenant-scoped: bypass Supabase (no tenant_id column) and aggregate from MongoDB
    const { slug: tenantSlug, id: tenantId } = getTenantContextFromRequest(request);
    if (tenantSlug) {
      if (!tenantId) return NextResponse.json({ languages: [], total_books: 0 });
      const db = await getReadDb();
      const rawLangs = await db.collection('books').distinct('language',
        { tenantId, visible: true, pages_count: { $gt: 0 } }
      );
      const normalizedMap = new Map<string, number>();
      for (const lang of rawLangs.filter(Boolean)) {
        const normalized = normalizeLanguage(lang as string);
        normalizedMap.set(normalized, (normalizedMap.get(normalized) || 0) + 1);
      }
      const languages: LanguageWithCount[] = Array.from(normalizedMap.entries())
        .map(([code, count]) => ({ code, name: code, book_count: count }))
        .sort((a, b) => b.book_count - a.book_count);
      return NextResponse.json(
        { languages, total_books: languages.reduce((s, l) => s + l.book_count, 0) },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const langCounts = await getLanguageCounts({});

    // Normalize and aggregate
    const normalizedMap = new Map<string, number>();
    for (const item of langCounts) {
      const normalized = normalizeLanguage(item.lang);
      normalizedMap.set(normalized, (normalizedMap.get(normalized) || 0) + item.count);
    }

    const languages: LanguageWithCount[] = Array.from(normalizedMap.entries())
      .map(([code, count]) => ({ code, name: code, book_count: count }))
      .sort((a, b) => b.book_count - a.book_count);

    const total_books = languages.reduce((sum, l) => sum + l.book_count, 0);

    return NextResponse.json({ languages, total_books }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=1800' },
    });
  } catch (error) {
    console.error('Error fetching languages:', error);
    return NextResponse.json({ error: 'Failed to fetch languages' }, { status: 500 });
  }
}
