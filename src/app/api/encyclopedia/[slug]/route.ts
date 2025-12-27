import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { EncyclopediaEntryType } from '@/lib/types';

// GET /api/encyclopedia/[slug] - Get a single encyclopedia entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = await getDb();

    const entry = await db.collection('encyclopedia').findOne({ slug });

    if (!entry) {
      return NextResponse.json(
        { error: 'Encyclopedia entry not found' },
        { status: 404 }
      );
    }

    // Increment view count
    await db.collection('encyclopedia').updateOne(
      { slug },
      { $inc: { view_count: 1 } }
    );

    // Fetch related entries
    let relatedEntries: unknown[] = [];
    if (entry.related_entries?.length > 0) {
      relatedEntries = await db.collection('encyclopedia')
        .find({ id: { $in: entry.related_entries } })
        .project({ id: 1, slug: 1, title: 1, type: 1, summary: 1 })
        .toArray();
    }

    // Fetch annotations that reference this entry
    const linkedAnnotations = await db.collection('annotations')
      .find({ encyclopedia_refs: entry.id, status: { $ne: 'hidden' } })
      .sort({ upvotes: -1 })
      .limit(10)
      .toArray();

    return NextResponse.json({
      ...entry,
      related_entries_full: relatedEntries,
      linked_annotations: linkedAnnotations,
    });
  } catch (error) {
    console.error('Error fetching encyclopedia entry:', error);
    return NextResponse.json(
      { error: 'Failed to fetch encyclopedia entry' },
      { status: 500 }
    );
  }
}

// PATCH /api/encyclopedia/[slug] - Update an encyclopedia entry
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
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
      contributor_id,
    } = body;

    const db = await getDb();

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (title !== undefined) updateData.title = title.trim();
    if (aliases !== undefined) updateData.aliases = aliases.map((a: string) => a.trim()).filter(Boolean);

    if (type !== undefined) {
      const validTypes: EncyclopediaEntryType[] = ['term', 'person', 'place', 'work', 'concept'];
      if (!validTypes.includes(type)) {
        return NextResponse.json(
          { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.type = type;
    }

    if (summary !== undefined) {
      if (summary.length > 500) {
        return NextResponse.json(
          { error: 'Summary must be under 500 characters' },
          { status: 400 }
        );
      }
      updateData.summary = summary.trim();
    }

    if (content !== undefined) updateData.content = content.trim();
    if (categories !== undefined) updateData.categories = categories.filter(Boolean);
    if (related_entries !== undefined) updateData.related_entries = related_entries;
    if (primary_sources !== undefined) updateData.primary_sources = primary_sources;
    if (external_references !== undefined) updateData.external_references = external_references;

    // Build update operation
    const updateOp: Record<string, unknown> = { $set: updateData };

    // Add contributor if provided
    if (contributor_id) {
      updateOp.$addToSet = { contributors: contributor_id };
    }

    const result = await db.collection('encyclopedia').updateOne(
      { slug },
      updateOp
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: 'Encyclopedia entry not found' },
        { status: 404 }
      );
    }

    const entry = await db.collection('encyclopedia').findOne({ slug });
    return NextResponse.json(entry);
  } catch (error) {
    console.error('Error updating encyclopedia entry:', error);
    return NextResponse.json(
      { error: 'Failed to update encyclopedia entry' },
      { status: 500 }
    );
  }
}
