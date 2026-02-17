import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { z } from 'zod';
import { applyFix, validateTranslation } from '@/lib/validateTranslation';
import { withAuth } from '@/lib/auth-helpers';

const quickFixSchema = z.object({
  field: z.enum(['translation', 'ocr']),
  fix: z.object({
    type: z.enum(['insert', 'delete', 'replace']),
    position: z.number().int().min(0),
    text: z.string().optional(),
    length: z.number().int().min(0).optional(),
  }),
});

export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const rawBody = await request.json();

    // Validate request
    const parseResult = quickFixSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { field, fix } = parseResult.data;

    // Get page
    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Get current text
    const currentText = page[field]?.data;
    if (!currentText) {
      return NextResponse.json({ error: `No ${field} data found` }, { status: 400 });
    }

    // Apply the fix
    const newText = applyFix(currentText, fix);

    // Validate the result
    const validationResult = validateTranslation(newText);

    // Update the page
    const updateField = `${field}.data`;
    const result = await db.collection('pages').updateOne(
      { id },
      {
        $set: {
          [updateField]: newText,
          [`${field}.updated_at`]: new Date(),
          updated_at: new Date(),
        },
        $inc: { edit_count: 1 }
      }
    );

    if (result.modifiedCount === 0) {
      return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      field,
      newText,
      remainingIssues: validationResult.issues.length,
      validation: validationResult
    });
  } catch (error) {
    console.error('Error applying quick fix:', error);
    return NextResponse.json({ error: 'Failed to apply fix' }, { status: 500 });
  }
});
