import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { DEFAULT_PROMPTS } from '@/lib/types';
import type { Prompt } from '@/lib/types';

// GET /api/prompts - Get all prompts, optionally filtered by type
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as 'ocr' | 'translation' | 'summary' | null;

    const db = await getDb();
    const collection = db.collection<Prompt>('prompts');

    // Build query
    const query = type ? { type } : {};
    const prompts = await collection.find(query).sort({ is_default: -1, name: 1 }).toArray();

    // If no prompts exist yet, seed the defaults
    if (prompts.length === 0) {
      const defaultPrompts: Omit<Prompt, '_id'>[] = [
        {
          name: 'Standard OCR',
          type: 'ocr',
          content: DEFAULT_PROMPTS.ocr,
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          name: 'Standard Translation',
          type: 'translation',
          content: DEFAULT_PROMPTS.translation,
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          name: 'Standard Summary',
          type: 'summary',
          content: DEFAULT_PROMPTS.summary,
          is_default: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      await collection.insertMany(defaultPrompts);
      const seededPrompts = await collection.find(query).sort({ is_default: -1, name: 1 }).toArray();

      return NextResponse.json(seededPrompts.map(p => ({
        ...p,
        id: p._id?.toString(),
      })));
    }

    return NextResponse.json(prompts.map(p => ({
      ...p,
      id: p._id?.toString(),
    })));
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 });
  }
}

// POST /api/prompts - Create a new prompt
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, content } = body;

    if (!name || !type || !content) {
      return NextResponse.json({ error: 'Missing required fields: name, type, content' }, { status: 400 });
    }

    if (!['ocr', 'translation', 'summary'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Must be ocr, translation, or summary' }, { status: 400 });
    }

    const db = await getDb();
    const collection = db.collection<Prompt>('prompts');

    const newPrompt: Omit<Prompt, '_id'> = {
      name,
      type,
      content,
      is_default: false,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const result = await collection.insertOne(newPrompt);

    return NextResponse.json({
      ...newPrompt,
      id: result.insertedId.toString(),
      _id: result.insertedId,
    });
  } catch (error) {
    console.error('Error creating prompt:', error);
    return NextResponse.json({ error: 'Failed to create prompt' }, { status: 500 });
  }
}
