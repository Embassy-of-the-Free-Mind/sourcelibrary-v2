import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

// USTC enriched database (for USTC ID lookups)
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

interface SearchResult {
  id: string;
  title: string;
  englishTitle?: string;
  author?: string;
  language?: string;
  year?: string;
  place?: string;
  source?: string;
  workType?: string;
  subjectTags?: string[];
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const isNumericId = /^\d+$/.test(query);
    const results: SearchResult[] = [];

    // 1. Search local external_catalog (EFM + IA books, fast MongoDB)
    try {
      const db = await getDb();
      const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

      if (words.length > 0) {
        const wordConditions = words.map(word => ({
          $or: [
            { title: { $regex: word, $options: 'i' } },
            { author: { $regex: word, $options: 'i' } },
            { year: { $regex: word, $options: 'i' } },
          ]
        }));

        const docs = await db.collection('external_catalog')
          .find({ $and: wordConditions })
          .limit(10)
          .toArray();

        for (const doc of docs) {
          results.push({
            id: doc.identifier || doc._id.toString(),
            title: doc.title || 'Untitled',
            author: doc.author || undefined,
            language: doc.language || undefined,
            year: doc.year || undefined,
            place: doc.placeOfPublication || undefined,
            source: doc.source === 'bph' ? 'EFM' : 'IA',
          });
        }
      }
    } catch (e) {
      console.error('Catalog search error:', e);
    }

    // 2. Search USTC enrichments (has English translations)
    try {
      const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      };

      const enrichedUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
      enrichedUrl.searchParams.set('select', 'id,std_title,english_title,detected_language,work_type,original_author,subject_tags');
      enrichedUrl.searchParams.set('limit', '10');

      if (isNumericId) {
        enrichedUrl.searchParams.set('id', `eq.${query}`);
      } else {
        enrichedUrl.searchParams.set('or', `(std_title.ilike.*${query}*,english_title.ilike.*${query}*,original_author.ilike.*${query}*)`);
      }

      const res = await fetch(enrichedUrl.toString(), { headers });
      if (res.ok) {
        const data = await res.json();
        for (const row of data) {
          results.push({
            id: `USTC-${row.id}`,
            title: row.std_title || '',
            englishTitle: row.english_title || undefined,
            author: row.original_author || undefined,
            language: row.detected_language || undefined,
            source: 'USTC',
            workType: row.work_type || undefined,
            subjectTags: row.subject_tags || undefined,
          });
        }
      }

      // For numeric IDs, also check full editions table (fast by primary key)
      if (isNumericId && results.length === 0) {
        const editionsUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
        editionsUrl.searchParams.set('select', 'id,title,author_1,language_1,year,place');
        editionsUrl.searchParams.set('id', `eq.${query}`);
        const edRes = await fetch(editionsUrl.toString(), { headers });
        if (edRes.ok) {
          const edData = await edRes.json();
          for (const row of edData) {
            results.push({
              id: `USTC-${row.id}`,
              title: row.title || '',
              author: row.author_1 || undefined,
              language: row.language_1 || undefined,
              year: row.year ? String(row.year) : undefined,
              place: row.place || undefined,
              source: 'USTC',
            });
          }
        }
      }
    } catch (e) {
      console.error('USTC search error:', e);
    }

    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ results: [], error: 'Search failed' }, { status: 500 });
  }
}
