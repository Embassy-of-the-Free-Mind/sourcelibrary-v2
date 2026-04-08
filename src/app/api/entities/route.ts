import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { supabase } from '@/lib/supabase';
import { withAuth } from '@/lib/auth-helpers';
import { loadAliasResolver } from '@/lib/entity-aliases';
import { buildEntityListJsonLd } from '@/lib/jsonld';

export interface Entity {
  _id?: string;
  name: string;
  type: 'person' | 'place' | 'concept';
  aliases?: string[];
  description?: string;
  wikipedia_url?: string;
  books: Array<{
    book_id: string;
    book_title: string;
    book_author: string;
    pages: number[];
  }>;
  total_mentions: number;
  book_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * GET /api/entities
 *
 * Query entities across all books
 *
 * Query params:
 * - type: 'person' | 'place' | 'concept' (filter by type)
 * - q: search query (searches name and aliases)
 * - book_id: filter to entities appearing in this book
 * - min_books: minimum number of books entity appears in (default: 1)
 * - limit: max results (default: 50)
 * - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as Entity['type'] | null;
    const query = searchParams.get('q');
    const bookId = searchParams.get('book_id');
    const minBooks = parseInt(searchParams.get('min_books') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Use Supabase for text search (trigram index, instant counts)
    // Fall back to MongoDB only for book_id filter (needs array lookup)
    if (bookId) {
      // book_id filter requires MongoDB (array field lookup)
      const db = await getDb();
      const filter: Record<string, unknown> = { 'books.book_id': bookId };
      if (type) filter.type = type;
      if (minBooks > 1) filter.book_count = { $gte: minBooks };

      const [total, entities] = await Promise.all([
        db.collection('entities').countDocuments(filter, { maxTimeMS: 10000 }),
        db.collection('entities')
          .find(filter)
          .sort({ book_count: -1, total_mentions: -1 })
          .skip(offset)
          .limit(limit)
          .maxTimeMS(10000)
          .toArray(),
      ]);

      const format = searchParams.get('format');
      if (format === 'jsonld') {
        const jsonLd = buildEntityListJsonLd(entities.map(e => ({
          name: e.name as string, type: e.type as 'person' | 'place' | 'concept',
          aliases: e.aliases as string[] | undefined, description: e.description as string | undefined,
          wikipedia_url: e.wikipedia_url as string | undefined, wikidata_id: e.wikidata_id as string | undefined,
          wikidata_birth_date: e.wikidata_birth_date as string | undefined, wikidata_death_date: e.wikidata_death_date as string | undefined,
          wikidata_coordinates: e.wikidata_coordinates as { lat: number; lng: number } | undefined,
          books: e.books as Array<{ book_id: string; book_title: string; book_author: string }>,
        })));
        return new Response(JSON.stringify(jsonLd, null, 2), {
          headers: { 'Content-Type': 'application/ld+json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return NextResponse.json({ entities, total, limit, offset, hasMore: offset + entities.length < total });
    }

    // Supabase path: text search with trigram index
    let supaQuery = supabase
      .from('entities')
      .select('*', { count: 'exact' });

    if (type) supaQuery = supaQuery.eq('type', type);
    if (query) supaQuery = supaQuery.ilike('name', `%${query}%`);
    if (minBooks > 1) supaQuery = supaQuery.gte('book_count', minBooks);

    supaQuery = supaQuery
      .order('book_count', { ascending: false })
      .order('total_mentions', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: entities, count: total, error } = await supaQuery;
    if (error) throw error;

    return NextResponse.json({
      entities: entities || [],
      total: total || 0,
      limit,
      offset,
      hasMore: offset + (entities?.length || 0) < (total || 0),
    });
  } catch (error) {
    console.error('Error fetching entities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entities' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/entities/sync
 *
 * Sync entities from all books' index data.
 * This aggregates people/places/concepts from book indexes into the entities collection.
 */
export const POST = withAuth(async (request, session) => {
  try {
    const db = await getDb();

    // Get all books with index data
    const books = await db.collection('books')
      .find({ 'index.people': { $exists: true } })
      .project({
        id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        'index.people': 1,
        'index.places': 1,
        'index.concepts': 1
      })
      .toArray();

    console.log(`Syncing entities from ${books.length} books...`);

    // Merge full index from dedicated collection for each book
    const bookIds = books.map(b => b.id).filter(Boolean);
    const indexDocs = await db.collection('book_indexes')
      .find({ book_id: { $in: bookIds } }, { projection: { _id: 0 }, maxTimeMS: 10000 })
      .toArray();
    const indexMap = new Map(indexDocs.map(d => [d.book_id, d]));
    for (const book of books) {
      const indexDoc = indexMap.get(book.id);
      if (indexDoc) {
        const { book_id: _, ...indexFields } = indexDoc;
        (book as any).index = { ...(book as any).index, ...indexFields };
      }
    }

    // Load alias resolver to merge variant names into canonical entities
    const aliasResolver = await loadAliasResolver(db);
    console.log(`Loaded ${aliasResolver.size} alias mappings`);

    // Build entity map: canonical_name -> entity data
    const entityMap = new Map<string, {
      name: string;
      type: Entity['type'];
      variantNames: Set<string>;
      books: Map<string, { book_id: string; book_title: string; book_author: string; pages: number[] }>;
    }>();

    const addToEntityMap = (
      term: string,
      type: Entity['type'],
      bookId: string,
      bookTitle: string,
      bookAuthor: string,
      pages: number[]
    ) => {
      // Resolve alias to canonical name
      const canonicalName = aliasResolver.resolve(term, type);
      const key = `${type}:${canonicalName.toLowerCase()}`;

      if (!entityMap.has(key)) {
        entityMap.set(key, {
          name: canonicalName,
          type,
          variantNames: new Set(),
          books: new Map()
        });
      }
      const entity = entityMap.get(key)!;
      // Track all variant names as aliases
      if (term !== canonicalName) {
        entity.variantNames.add(term);
      }
      // Merge book data — combine pages if same book appears via different variants
      const existing = entity.books.get(bookId);
      if (existing) {
        const allPages = [...new Set([...existing.pages, ...pages])].sort((a, b) => a - b);
        entity.books.set(bookId, { ...existing, pages: allPages });
      } else {
        entity.books.set(bookId, { book_id: bookId, book_title: bookTitle, book_author: bookAuthor, pages });
      }
    };

    for (const book of books) {
      const bookId = book.id;
      const bookTitle = book.display_title || book.title;
      const bookAuthor = book.author || 'Unknown';

      for (const person of (book.index?.people || [])) {
        if (!person.term) continue;
        addToEntityMap(person.term, 'person', bookId, bookTitle, bookAuthor, person.pages || []);
      }

      for (const place of (book.index?.places || [])) {
        if (!place.term) continue;
        addToEntityMap(place.term, 'place', bookId, bookTitle, bookAuthor, place.pages || []);
      }

      for (const concept of (book.index?.concepts || [])) {
        if (!concept.term) continue;
        addToEntityMap(concept.term, 'concept', bookId, bookTitle, bookAuthor, concept.pages || []);
      }
    }

    // Upsert entities
    const now = new Date();
    let created = 0;
    let updated = 0;

    let merged = 0;
    for (const [key, data] of entityMap) {
      const booksArray = Array.from(data.books.values());
      const totalMentions = booksArray.reduce((sum, b) => sum + b.pages.length, 0);

      // Build update — merge variant names into aliases without overwriting manual aliases
      const updateSet: Record<string, unknown> = {
        name: data.name,
        type: data.type,
        books: booksArray,
        total_mentions: totalMentions,
        book_count: booksArray.length,
        updated_at: now,
      };

      const update: Record<string, unknown> = {
        $set: updateSet,
        $setOnInsert: { created_at: now },
      };

      // Add variant names to aliases (without duplicating existing aliases)
      if (data.variantNames.size > 0) {
        update.$addToSet = { aliases: { $each: Array.from(data.variantNames) } };
        merged += data.variantNames.size;
      }

      const result = await db.collection('entities').updateOne(
        { name: data.name, type: data.type },
        update,
        { upsert: true }
      );

      if (result.upsertedCount > 0) created++;
      else if (result.modifiedCount > 0) updated++;
    }

    // Clean up orphaned entity records whose names are now aliases
    // (they were replaced by the canonical entity)
    if (aliasResolver.size > 0) {
      const aliasNames = await db.collection('entity_aliases')
        .find({})
        .project({ alias_name: 1, type: 1 })
        .toArray();

      let cleaned = 0;
      for (const alias of aliasNames) {
        // Delete entity records that match alias names (the data is now in the canonical entity)
        const del = await db.collection('entities').deleteOne({
          name: alias.alias_name,
          type: alias.type,
        });
        if (del.deletedCount > 0) cleaned++;
      }
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} orphaned alias entities`);
      }
    }

    // Create indexes
    await db.collection('entities').createIndex({ name: 1, type: 1 }, { unique: true });
    await db.collection('entities').createIndex({ type: 1 });
    await db.collection('entities').createIndex({ book_count: -1 });
    await db.collection('entities').createIndex({ 'books.book_id': 1 });

    return NextResponse.json({
      success: true,
      booksProcessed: books.length,
      entitiesCreated: created,
      entitiesUpdated: updated,
      aliasesMerged: merged,
      totalEntities: entityMap.size
    });
  } catch (error) {
    console.error('Error syncing entities:', error);
    return NextResponse.json(
      { error: 'Failed to sync entities' },
      { status: 500 }
    );
  }
});
