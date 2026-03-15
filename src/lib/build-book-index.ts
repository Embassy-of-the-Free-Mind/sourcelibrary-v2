/**
 * Build a book index by extracting <vocab>, <term>, and <keywords> tags
 * from existing OCR and translation data. No AI calls needed.
 */

export interface IndexEntry {
  term: string;
  pages: number[];
  type: 'vocab' | 'term' | 'keyword';
}

interface PageRow {
  page_number: number;
  ocr?: { data?: string };
  translation?: { data?: string };
}

/** Extract comma-separated values from a single XML-like tag */
function extractTag(text: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) {
      // Split on commas, clean up each term
      for (const raw of content.split(',')) {
        const term = raw.trim();
        if (term && term.length > 1 && term.length < 100) {
          results.push(term);
        }
      }
    }
  }
  return results;
}

/** Extract inline <term>...</term> tags from translation text */
function extractInlineTerms(text: string): string[] {
  const regex = /<term>([^<]+)<\/term>/gi;
  const results: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const term = match[1].trim();
    if (term && term.length > 1 && term.length < 100) {
      results.push(term);
    }
  }
  return results;
}

/** Normalize a term for deduplication (lowercase, trim, collapse whitespace) */
function normalizeKey(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Build an inverted index from page-level tags.
 * Returns entries sorted by number of page references (most referenced first).
 */
export function buildBookIndex(pages: PageRow[]): IndexEntry[] {
  // Map: normalized_key -> { displayTerm, pages Set, type }
  const index = new Map<string, { term: string; pages: Set<number>; type: 'vocab' | 'term' | 'keyword' }>();

  function addEntry(term: string, pageNum: number, type: 'vocab' | 'term' | 'keyword') {
    const key = normalizeKey(term);
    if (!key) return;

    const existing = index.get(key);
    if (existing) {
      existing.pages.add(pageNum);
      // Prefer 'term' type (English) over 'vocab' (Latin) for display
      if (type === 'term' && existing.type === 'vocab') {
        existing.type = 'term';
        existing.term = term; // Use the English form as display
      }
    } else {
      index.set(key, { term, pages: new Set([pageNum]), type });
    }
  }

  for (const page of pages) {
    const pageNum = page.page_number;

    // Extract <vocab> from OCR
    if (page.ocr?.data) {
      for (const v of extractTag(page.ocr.data, 'vocab')) {
        addEntry(v, pageNum, 'vocab');
      }
    }

    // Extract <term> and <keywords> from translation
    if (page.translation?.data) {
      for (const t of extractInlineTerms(page.translation.data)) {
        addEntry(t, pageNum, 'term');
      }
      for (const k of extractTag(page.translation.data, 'keywords')) {
        addEntry(k, pageNum, 'keyword');
      }
    }
  }

  // Convert to array, sort by page count descending
  return Array.from(index.values())
    .map(({ term, pages, type }) => ({
      term,
      pages: Array.from(pages).sort((a, b) => a - b),
      type,
    }))
    .sort((a, b) => b.pages.length - a.pages.length);
}
