import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { DEFAULT_PROMPTS, LATIN_PROMPTS, GERMAN_PROMPTS } from '@/lib/types';

/**
 * POST /api/admin/migrate-prompts
 *
 * Creates new versions of all prompts with the updated XML syntax.
 * Body: { dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { dryRun = true } = body;

    const db = await getDb();
    const collection = db.collection('prompts');

    // Helper to extract variables from prompt text
    function extractVariables(text: string): string[] {
      const matches = text.match(/\{(\w+)\}/g) || [];
      return [...new Set(matches.map(m => m.slice(1, -1)))];
    }

    // Prompts to update with new XML syntax
    const promptUpdates = [
      {
        name: 'Standard OCR',
        type: 'ocr',
        content: DEFAULT_PROMPTS.ocr,
        description: 'Default OCR prompt with XML annotations (v2)',
      },
      {
        name: 'Standard Translation',
        type: 'translation',
        content: DEFAULT_PROMPTS.translation,
        description: 'Default translation prompt with XML annotations (v2)',
      },
      {
        name: 'Standard Summary',
        type: 'summary',
        content: DEFAULT_PROMPTS.summary,
        description: 'Default summary prompt (v2)',
      },
      {
        name: 'Latin OCR (Neo-Latin)',
        type: 'ocr',
        content: LATIN_PROMPTS.ocr,
        description: 'Neo-Latin OCR with XML annotations (v2)',
      },
      {
        name: 'Latin Translation (Neo-Latin)',
        type: 'translation',
        content: LATIN_PROMPTS.translation,
        description: 'Neo-Latin translation with XML annotations (v2)',
      },
      {
        name: 'German OCR (Fraktur)',
        type: 'ocr',
        content: GERMAN_PROMPTS.ocr,
        description: 'German/Fraktur OCR with XML annotations (v2)',
      },
      {
        name: 'German Translation (Early Modern)',
        type: 'translation',
        content: GERMAN_PROMPTS.translation,
        description: 'German translation with XML annotations (v2)',
      },
    ];

    const results = {
      dryRun,
      updates: [] as Array<{
        name: string;
        type: string;
        oldVersion: number;
        newVersion: number;
      }>,
    };

    for (const update of promptUpdates) {
      // Get the latest version for this prompt
      const latestVersion = await collection.findOne(
        { name: update.name },
        { sort: { version: -1 } }
      );

      const oldVersion = latestVersion?.version || 0;
      const newVersion = oldVersion + 1;

      results.updates.push({
        name: update.name,
        type: update.type,
        oldVersion,
        newVersion,
      });

      if (!dryRun) {
        // Check if the content has actually changed
        if (latestVersion?.content === update.content) {
          continue; // Skip if content is identical
        }

        // Create new version
        await collection.insertOne({
          name: update.name,
          type: update.type,
          version: newVersion,
          content: update.content,
          variables: extractVariables(update.content),
          description: update.description,
          is_default: latestVersion?.is_default || false,
          created_at: new Date(),
          migration_note: 'XML annotation syntax update',
        });

        // If this was the default, update the new version to be default
        if (latestVersion?.is_default) {
          await collection.updateMany(
            { name: update.name, version: { $lt: newVersion } },
            { $set: { is_default: false } }
          );
          await collection.updateOne(
            { name: update.name, version: newVersion },
            { $set: { is_default: true } }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `Dry run complete. Would create ${results.updates.length} new prompt versions.`
        : `Migration complete. Created ${results.updates.length} new prompt versions.`,
      ...results,
    });
  } catch (error) {
    console.error('Prompt migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/migrate-prompts
 *
 * Check current prompt versions and compare with types.ts
 */
export async function GET() {
  try {
    const db = await getDb();
    const collection = db.collection('prompts');

    // Get latest version of each prompt
    const pipeline = [
      { $sort: { version: -1 as const } },
      { $group: {
        _id: '$name',
        latestVersion: { $first: '$version' },
        type: { $first: '$type' },
        is_default: { $first: '$is_default' },
        created_at: { $first: '$created_at' },
        hasXmlSyntax: { $first: { $regexMatch: { input: '$content', regex: /<(note|margin|meta|lang)>/ } } },
      }},
      { $sort: { type: 1 as const, _id: 1 as const } }
    ];

    const prompts = await collection.aggregate(pipeline).toArray();

    return NextResponse.json({
      prompts: prompts.map(p => ({
        name: p._id,
        type: p.type,
        version: p.latestVersion,
        is_default: p.is_default,
        hasXmlSyntax: p.hasXmlSyntax,
        created_at: p.created_at,
      })),
      hint: 'POST with { dryRun: false } to create new versions with XML syntax',
    });
  } catch (error) {
    console.error('Prompt status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check status' },
      { status: 500 }
    );
  }
}
