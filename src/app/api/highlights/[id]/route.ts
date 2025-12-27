import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { z } from 'zod';

// Allowed highlight colors
const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const;

// Validation schema for highlight updates
const highlightUpdateSchema = z.object({
  note: z.string().max(5000, 'Note too long').optional(),
  color: z.enum(HIGHLIGHT_COLORS).optional(),
}).refine(data => data.note !== undefined || data.color !== undefined, {
  message: 'At least one of note or color must be provided',
});

// GET /api/highlights/[id] - Get a single highlight
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const highlight = await db.collection('highlights').findOne({ id });

    if (!highlight) {
      return NextResponse.json(
        { error: 'Highlight not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(highlight);
  } catch (error) {
    console.error('Error fetching highlight:', error);
    return NextResponse.json(
      { error: 'Failed to fetch highlight' },
      { status: 500 }
    );
  }
}

// DELETE /api/highlights/[id] - Delete a highlight
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const result = await db.collection('highlights').deleteOne({ id });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Highlight not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting highlight:', error);
    return NextResponse.json(
      { error: 'Failed to delete highlight' },
      { status: 500 }
    );
  }
}

// PATCH /api/highlights/[id] - Update a highlight (e.g., add note)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rawBody = await request.json();

    // Validate request body
    const parseResult = highlightUpdateSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { note, color } = parseResult.data;

    const db = await getDb();

    const updateData: Record<string, unknown> = {};
    if (note !== undefined) updateData.note = note.trim();
    if (color) updateData.color = color;

    const result = await db.collection('highlights').updateOne(
      { id },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: 'Highlight not found' },
        { status: 404 }
      );
    }

    const highlight = await db.collection('highlights').findOne({ id });
    return NextResponse.json(highlight);
  } catch (error) {
    console.error('Error updating highlight:', error);
    return NextResponse.json(
      { error: 'Failed to update highlight' },
      { status: 500 }
    );
  }
}
