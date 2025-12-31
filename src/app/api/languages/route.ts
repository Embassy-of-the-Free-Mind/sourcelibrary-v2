import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Language normalization map to standardize language names
const LANGUAGE_NORMALIZATION: Record<string, string> = {
  // Common variations
  'latin': 'Latin',
  'LATIN': 'Latin',
  'german': 'German',
  'GERMAN': 'German',
  'deutsch': 'German',
  'french': 'French',
  'FRENCH': 'French',
  'français': 'French',
  'francais': 'French',
  'italian': 'Italian',
  'ITALIAN': 'Italian',
  'italiano': 'Italian',
  'english': 'English',
  'ENGLISH': 'English',
  'dutch': 'Dutch',
  'DUTCH': 'Dutch',
  'nederlands': 'Dutch',
  'spanish': 'Spanish',
  'SPANISH': 'Spanish',
  'español': 'Spanish',
  'espanol': 'Spanish',
  'greek': 'Greek',
  'GREEK': 'Greek',
  'hebrew': 'Hebrew',
  'HEBREW': 'Hebrew',
  'arabic': 'Arabic',
  'ARABIC': 'Arabic',
  'portuguese': 'Portuguese',
  'PORTUGUESE': 'Portuguese',
  'português': 'Portuguese',
  'portugues': 'Portuguese',
  // Add more as needed
};

// Preferred canonical language names (ISO 639-1 names)
export const CANONICAL_LANGUAGES = [
  'Latin',
  'German',
  'French',
  'Italian',
  'English',
  'Dutch',
  'Spanish',
  'Greek',
  'Hebrew',
  'Arabic',
  'Portuguese',
  'Sanskrit',
  'Syriac',
  'Aramaic',
  'Old English',
  'Middle English',
];

export interface LanguageWithCount {
  code: string;  // The canonical name
  name: string;  // Display name (same as code for now)
  book_count: number;
  variants?: string[];  // Any non-canonical variants found
}

/**
 * Normalize a language string to canonical form
 */
export function normalizeLanguage(language: string | null | undefined): string {
  if (!language) return 'Unknown';

  const trimmed = language.trim();

  // Check normalization map first
  if (LANGUAGE_NORMALIZATION[trimmed]) {
    return LANGUAGE_NORMALIZATION[trimmed];
  }

  // If already in canonical form, return as-is
  if (CANONICAL_LANGUAGES.includes(trimmed)) {
    return trimmed;
  }

  // Try case-insensitive match
  const lower = trimmed.toLowerCase();
  if (LANGUAGE_NORMALIZATION[lower]) {
    return LANGUAGE_NORMALIZATION[lower];
  }

  // Default: capitalize first letter
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// GET /api/languages - List all languages with book counts
export async function GET() {
  try {
    const db = await getDb();

    // Get language counts from books
    const languageCounts = await db.collection('books').aggregate([
      {
        $group: {
          _id: '$language',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]).toArray();

    // Normalize and aggregate languages
    const normalizedMap = new Map<string, { count: number; variants: Set<string> }>();

    for (const item of languageCounts) {
      const raw = item._id as string;
      const normalized = normalizeLanguage(raw);

      if (!normalizedMap.has(normalized)) {
        normalizedMap.set(normalized, { count: 0, variants: new Set() });
      }

      const entry = normalizedMap.get(normalized)!;
      entry.count += item.count as number;

      // Track variant if it differs from canonical
      if (raw !== normalized) {
        entry.variants.add(raw);
      }
    }

    // Convert to array format
    const languages: LanguageWithCount[] = Array.from(normalizedMap.entries()).map(([code, data]) => ({
      code,
      name: code,
      book_count: data.count,
      variants: data.variants.size > 0 ? Array.from(data.variants) : undefined,
    }));

    // Sort by book count descending
    languages.sort((a, b) => b.book_count - a.book_count);

    return NextResponse.json({
      languages,
      total_books: languageCounts.reduce((sum, c) => sum + (c.count as number), 0),
    });
  } catch (error) {
    console.error('Error fetching languages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch languages' },
      { status: 500 }
    );
  }
}
