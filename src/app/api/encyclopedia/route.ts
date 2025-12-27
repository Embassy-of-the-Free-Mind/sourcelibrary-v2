import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId, Document } from 'mongodb';
import { EncyclopediaEntry, EncyclopediaEntryType } from '@/lib/types';

// Generate URL-friendly slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// GET /api/encyclopedia - List/search encyclopedia entries
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type') as EncyclopediaEntryType | null;
    const category = searchParams.get('category');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();

    const filter: Record<string, unknown> = {};

    // Text search on title, aliases, summary
    if (query) {
      filter.$or = [
        { title: { $regex: query, $options: 'i' } },
        { aliases: { $regex: query, $options: 'i' } },
        { summary: { $regex: query, $options: 'i' } },
      ];
    }

    if (type) {
      const validTypes: EncyclopediaEntryType[] = ['term', 'person', 'place', 'work', 'concept'];
      if (validTypes.includes(type)) {
        filter.type = type;
      }
    }

    if (category) {
      filter.categories = category;
    }

    const entries = await db.collection('encyclopedia')
      .find(filter)
      .sort({ view_count: -1, title: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const total = await db.collection('encyclopedia').countDocuments(filter);

    // Get unique categories for filtering
    const categories = await db.collection('encyclopedia').distinct('categories');

    return NextResponse.json({
      entries,
      total,
      limit,
      offset,
      categories: categories.sort(),
    });
  } catch (error) {
    console.error('Error fetching encyclopedia entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch encyclopedia entries' },
      { status: 500 }
    );
  }
}

// POST /api/encyclopedia - Create a new encyclopedia entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      aliases,
      type,
      summary,
      content,
      categories,
      related_entries,
      primary_sources,
      external_references,
      created_by,
      created_by_name,
    } = body;

    // Validate required fields
    if (!title || !type || !summary) {
      return NextResponse.json(
        { error: 'title, type, and summary are required' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes: EncyclopediaEntryType[] = ['term', 'person', 'place', 'work', 'concept'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate lengths
    if (summary.length > 500) {
      return NextResponse.json(
        { error: 'Summary must be under 500 characters' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Generate unique slug
    let slug = generateSlug(title);
    const existingWithSlug = await db.collection('encyclopedia').findOne({ slug });
    if (existingWithSlug) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const entry: EncyclopediaEntry = {
      id: new ObjectId().toHexString(),
      slug,
      title: title.trim(),
      aliases: aliases?.map((a: string) => a.trim()).filter(Boolean) || [],
      type,
      summary: summary.trim(),
      content: content?.trim() || '',
      categories: categories?.filter(Boolean) || [],
      related_entries: related_entries || [],
      primary_sources: primary_sources || [],
      external_references: external_references || [],
      created_by: created_by || undefined,
      created_by_name: created_by_name?.trim() || 'Anonymous',
      contributors: created_by ? [created_by] : [],
      view_count: 0,
      annotation_count: 0,
      created_at: new Date(),
    };

    await db.collection('encyclopedia').insertOne(entry as unknown as Document);

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('Error creating encyclopedia entry:', error);
    return NextResponse.json(
      { error: 'Failed to create encyclopedia entry' },
      { status: 500 }
    );
  }
}
