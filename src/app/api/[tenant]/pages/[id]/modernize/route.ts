import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performModernization } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getTriggerSource } from '@/lib/cron-auth';
import { resolveTenantId } from '@/lib/tenant-context';
import { withAuth } from '@/lib/auth-helpers';

// Simple hash function to detect translation changes
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

// Gated at `editor` (ops#6) — see the note on the unscoped twin. Note that
// `resolveTenantId` below is a slug->UUID lookup, not an authorization check;
// it was the only thing in front of this route.
export const POST = withAuth(async (request, session, context) => {
  const startTime = Date.now();

  try {
    const { tenant, id } = await context.params;
    const triggeredBy = getTriggerSource(request);
    const db = await getDb();
    
    // Resolve tenant slug to UUID
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    
    const body = await request.json().catch(() => ({}));

    // `model` is no longer taken from the body — nothing sends it.
    const { regenerate = false } = body;
    const model = DEFAULT_MODEL;

    // Fetch the page
    const page = await db.collection('pages').findOne({ id, tenantId });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Check if translation exists
    if (!page.translation?.data) {
      return NextResponse.json({
        error: 'Page has no translation. Translate first before modernizing.'
      }, { status: 400 });
    }

    const translationHash = hashString(page.translation.data);

    // Check if we can use cached version
    const hasValidCache = page.modernized?.data &&
                          page.modernized.source_translation_hash === translationHash;

    if (hasValidCache && !regenerate) {
      return NextResponse.json({
        modernized: page.modernized.data,
        cached: true,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
      });
    }

    // Get previous page for context
    let previousContext: { translation?: string; modernized?: string } | undefined;

    if (page.page_number > 1) {
      const prevPage = await db.collection('pages').findOne({
        book_id: page.book_id,
        page_number: page.page_number - 1,
        tenantId
      });

      if (prevPage) {
        previousContext = {
          translation: prevPage.translation?.data,
          modernized: prevPage.modernized?.data
        };
      }
    }

    // Perform modernization
    const result = await performModernization(
      page.translation.data,
      previousContext,
      undefined, // customPrompt
      model
    );

    // Save to database
    await db.collection('pages').updateOne(
      { id, tenantId },
      {
        $set: {
          'modernized.data': result.text,
          'modernized.model': model,
          'modernized.updated_at': new Date(),
          'modernized.source_translation_hash': translationHash,
          updated_at: new Date()
        }
      }
    );

    // Log AI usage to gemini_usage (single source of truth)
    const duration = Date.now() - startTime;
    logGeminiCall({
      type: 'translation',
      mode: 'realtime',
      model,
      book_id: page.book_id,
      page_ids: [id],
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      status: 'success',
      duration_ms: duration,
      prompt_version: 'modernize-inline-v1',
      endpoint: '/api/[tenant]/pages/[id]/modernize',
      triggered_by: triggeredBy,
    });

    return NextResponse.json({
      modernized: result.text,
      cached: false,
      usage: result.usage
    });
  } catch (error) {
    console.error('Error modernizing page:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to modernize page' },
      { status: 500 }
    );
  }
}, { minRole: 'editor' });
