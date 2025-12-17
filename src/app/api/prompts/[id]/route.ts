import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import type { Prompt } from '@/lib/types';

// GET /api/prompts/[id] - Get a single prompt
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const collection = db.collection<Prompt>('prompts');

    const prompt = await collection.findOne({ _id: new ObjectId(id) });

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...prompt,
      id: prompt._id?.toString(),
    });
  } catch (error) {
    console.error('Error fetching prompt:', error);
    return NextResponse.json({ error: 'Failed to fetch prompt' }, { status: 500 });
  }
}

// PATCH /api/prompts/[id] - Update a prompt
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, content } = body;

    const db = await getDb();
    const collection = db.collection<Prompt>('prompts');

    const updateData: Partial<Prompt> = {
      updated_at: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (content !== undefined) updateData.content = content;

    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...result,
      id: result._id?.toString(),
    });
  } catch (error) {
    console.error('Error updating prompt:', error);
    return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
  }
}

// DELETE /api/prompts/[id] - Delete a prompt
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const collection = db.collection<Prompt>('prompts');

    // Don't allow deleting default prompts
    const prompt = await collection.findOne({ _id: new ObjectId(id) });
    if (prompt?.is_default) {
      return NextResponse.json({ error: 'Cannot delete default prompts' }, { status: 400 });
    }

    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    return NextResponse.json({ error: 'Failed to delete prompt' }, { status: 500 });
  }
}
