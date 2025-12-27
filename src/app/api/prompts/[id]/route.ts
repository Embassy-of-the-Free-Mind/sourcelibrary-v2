import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import type { Prompt } from '@/lib/types';

// Helper to extract variables from prompt text
function extractVariables(text: string): string[] {
  const matches = text.match(/\{(\w+)\}/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

// GET /api/prompts/[id] - Get a single prompt by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const collection = db.collection('prompts');

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

// PATCH /api/prompts/[id] - Create a new version of a prompt
// Instead of updating in place, creates a new version for audit trail
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { text, description, setAsDefault } = body;

    // Support legacy 'content' field
    const promptText = text || body.content;

    const db = await getDb();
    const collection = db.collection('prompts');

    // Get the existing prompt
    const existingPrompt = await collection.findOne({ _id: new ObjectId(id) });
    if (!existingPrompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    // Get the latest version for this prompt name
    const latestVersion = await collection.findOne(
      { name: existingPrompt.name },
      { sort: { version: -1 } }
    );

    const newVersion = (latestVersion?.version || 0) + 1;

    // If setting as default, unset current default for this type
    if (setAsDefault) {
      await collection.updateMany(
        { type: existingPrompt.type, is_default: true },
        { $set: { is_default: false } }
      );
    }

    // Create new version
    const newPrompt = {
      name: existingPrompt.name as string,
      type: existingPrompt.type as string,
      version: newVersion,
      content: promptText || existingPrompt.content as string,
      variables: promptText ? extractVariables(promptText) : existingPrompt.variables as string[],
      description: description || existingPrompt.description as string | undefined,
      is_default: setAsDefault ?? existingPrompt.is_default as boolean,
      created_at: new Date(),
    };

    const result = await collection.insertOne(newPrompt);

    return NextResponse.json({
      ...newPrompt,
      id: result.insertedId.toString(),
      _id: result.insertedId,
      previousVersion: existingPrompt.version,
      message: `Created version ${newVersion} of "${existingPrompt.name}"`
    });
  } catch (error) {
    console.error('Error updating prompt:', error);
    return NextResponse.json({ error: 'Failed to update prompt' }, { status: 500 });
  }
}

// POST /api/prompts/[id]/set-default - Set this prompt as the default for its type
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const collection = db.collection('prompts');

    const prompt = await collection.findOne({ _id: new ObjectId(id) });
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }

    // Unset current default for this type
    await collection.updateMany(
      { type: prompt.type, is_default: true },
      { $set: { is_default: false } }
    );

    // Set this one as default
    await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { is_default: true } }
    );

    return NextResponse.json({
      success: true,
      message: `"${prompt.name}" v${prompt.version} is now the default ${prompt.type} prompt`
    });
  } catch (error) {
    console.error('Error setting default prompt:', error);
    return NextResponse.json({ error: 'Failed to set default prompt' }, { status: 500 });
  }
}

// DELETE is intentionally not supported - prompts are immutable for audit trail
// Old versions can be marked as deprecated but not deleted
