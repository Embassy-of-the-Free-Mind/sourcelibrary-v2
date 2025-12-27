import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { DEFAULT_PROMPTS, LATIN_PROMPTS, GERMAN_PROMPTS } from '@/lib/types';
import type { Prompt, PromptType } from '@/lib/types';

// Helper to extract variables from prompt text
function extractVariables(text: string): string[] {
  const matches = text.match(/\{(\w+)\}/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

// GET /api/prompts - Get all prompts, optionally filtered by type
// Returns latest version of each prompt by default
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as PromptType | null;
    const name = searchParams.get('name');
    const allVersions = searchParams.get('all_versions') === 'true';
    const defaultOnly = searchParams.get('default') === 'true';

    const db = await getDb();
    const collection = db.collection('prompts');

    // Build query
    const query: Record<string, unknown> = {};
    if (type) query.type = type;
    if (name) query.name = name;
    if (defaultOnly) query.is_default = true;

    let prompts;

    if (allVersions) {
      // Return all versions
      prompts = await collection.find(query).sort({ name: 1, version: -1 }).toArray();
    } else {
      // Return only latest version of each prompt (using aggregation)
      const pipeline = [
        { $match: query },
        { $sort: { version: -1 as const } },
        { $group: {
          _id: '$name',
          doc: { $first: '$$ROOT' }
        }},
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { is_default: -1 as const, name: 1 as const } }
      ];
      prompts = await collection.aggregate(pipeline).toArray();
    }

    // If no prompts exist yet, seed the defaults
    if (prompts.length === 0 && !name) {
      await seedDefaultPrompts(db);
      prompts = await collection.find(query).sort({ is_default: -1, name: 1 }).toArray();
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

// POST /api/prompts - Create a new prompt or new version
// If a prompt with the same name exists, creates a new version
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, text, description, setAsDefault } = body;

    // Support legacy 'content' field
    const promptText = text || body.content;

    if (!name || !type || !promptText) {
      return NextResponse.json({
        error: 'Missing required fields: name, type, text (or content)'
      }, { status: 400 });
    }

    if (!['ocr', 'translation', 'summary'].includes(type)) {
      return NextResponse.json({
        error: 'Invalid type. Must be ocr, translation, or summary'
      }, { status: 400 });
    }

    const db = await getDb();
    const collection = db.collection('prompts');

    // Get the latest version for this name
    const latestVersion = await collection.findOne(
      { name },
      { sort: { version: -1 } }
    );

    const newVersion = latestVersion ? latestVersion.version + 1 : 1;
    const variables = extractVariables(promptText);

    // If setting as default, unset current default for this type
    if (setAsDefault) {
      await collection.updateMany(
        { type, is_default: true },
        { $set: { is_default: false } }
      );
    }

    const newPrompt = {
      name,
      type,
      version: newVersion,
      content: promptText,
      variables,
      description: description || (latestVersion?.description as string | undefined),
      is_default: setAsDefault || false,
      created_at: new Date(),
    };

    const result = await collection.insertOne(newPrompt);

    return NextResponse.json({
      ...newPrompt,
      id: result.insertedId.toString(),
      _id: result.insertedId,
      message: latestVersion
        ? `Created version ${newVersion} of "${name}"`
        : `Created new prompt "${name}"`
    });
  } catch (error) {
    console.error('Error creating prompt:', error);
    return NextResponse.json({ error: 'Failed to create prompt' }, { status: 500 });
  }
}

// Helper function to seed default prompts
async function seedDefaultPrompts(db: Awaited<ReturnType<typeof getDb>>) {
  const collection = db.collection('prompts');

  const defaultPrompts = [
    // Standard prompts (defaults)
    {
      name: 'Standard OCR',
      type: 'ocr' as const,
      version: 1,
      content: DEFAULT_PROMPTS.ocr,
      variables: extractVariables(DEFAULT_PROMPTS.ocr),
      description: 'Default OCR prompt for manuscript transcription',
      is_default: true,
      created_at: new Date(),
    },
    {
      name: 'Standard Translation',
      type: 'translation' as const,
      version: 1,
      content: DEFAULT_PROMPTS.translation,
      variables: extractVariables(DEFAULT_PROMPTS.translation),
      description: 'Default translation prompt for scholarly translation',
      is_default: true,
      created_at: new Date(),
    },
    {
      name: 'Standard Summary',
      type: 'summary' as const,
      version: 1,
      content: DEFAULT_PROMPTS.summary,
      variables: extractVariables(DEFAULT_PROMPTS.summary),
      description: 'Default summary prompt',
      is_default: true,
      created_at: new Date(),
    },
    // Latin prompts
    {
      name: 'Latin OCR (Neo-Latin)',
      type: 'ocr' as const,
      version: 1,
      content: LATIN_PROMPTS.ocr,
      variables: extractVariables(LATIN_PROMPTS.ocr),
      description: 'OCR prompt optimized for Neo-Latin texts (1450-1700)',
      is_default: false,
      created_at: new Date(),
    },
    {
      name: 'Latin Translation (Neo-Latin)',
      type: 'translation' as const,
      version: 1,
      content: LATIN_PROMPTS.translation,
      variables: extractVariables(LATIN_PROMPTS.translation),
      description: 'Translation prompt for Neo-Latin scholarly texts',
      is_default: false,
      created_at: new Date(),
    },
    // German prompts
    {
      name: 'German OCR (Fraktur)',
      type: 'ocr' as const,
      version: 1,
      content: GERMAN_PROMPTS.ocr,
      variables: extractVariables(GERMAN_PROMPTS.ocr),
      description: 'OCR prompt for Early Modern German/Fraktur texts',
      is_default: false,
      created_at: new Date(),
    },
    {
      name: 'German Translation (Early Modern)',
      type: 'translation' as const,
      version: 1,
      content: GERMAN_PROMPTS.translation,
      variables: extractVariables(GERMAN_PROMPTS.translation),
      description: 'Translation prompt for Early Modern German texts',
      is_default: false,
      created_at: new Date(),
    },
  ];

  await collection.insertMany(defaultPrompts);
}
