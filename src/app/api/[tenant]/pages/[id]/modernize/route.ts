import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonActionGate, SIGNIN_URL } from '@/lib/anon-gate';
import { getTriggerSource } from '@/lib/cron-auth';
import { resolveTenantId } from '@/lib/tenant-context';
import {
  hashString,
  resolveModernizationSource,
  readCachedModernization,
  generateModernization,
  loadEnglishModernizationPrompt,
  wouldBeNoOp,
} from '@/lib/modernize-page';

/**
 * Tenant twin of `src/app/api/pages/[id]/modernize/route.ts`. Both delegate to
 * `@/lib/modernize-page`: these two were copies, and a gate added to one of them would
 * have left the other an ungated paid endpoint — the exact shape of
 * `lesson_second_resolver_never_screened`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  try {
    const { tenant, id } = await params;
    const triggeredBy = getTriggerSource(request);

    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const db = await getDb();
    const body = await request.json().catch(() => ({}));
    // `model` is deliberately NOT read from the body — see modernize-page.ts.
    const { regenerate = false } = body;

    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { language: 1 } });
    const resolved = resolveModernizationSource(page, book);
    if (!resolved) {
      return NextResponse.json(
        { error: 'Page has no text to modernize. It needs OCR (English editions) or a translation first.' },
        { status: 400 },
      );
    }

    const sourceHash = hashString(resolved.text);

    const cached = readCachedModernization(page, sourceHash, resolved.source);
    if (cached && !regenerate) {
      return NextResponse.json({
        modernized: cached,
        cached: true,
        source: resolved.source,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      });
    }

    // Refuse before spending — see the non-tenant twin.
    if (wouldBeNoOp(resolved.text, resolved.source)) {
      return NextResponse.json({
        modernized: null,
        skipped: 'already-modern',
        source: resolved.source,
        message: 'This page is already in modern English — a modernization would return the same text.',
      });
    }

    const gate = await anonActionGate(request, { name: 'modernize', limit: 15, allowBotBypass: false });
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error: 'Modernization limit reached. Sign in (free) to keep going.',
          code: 'SIGNIN_REQUIRED',
          sign_in: SIGNIN_URL,
          retry_after: gate.retryAfter,
        },
        { status: 429, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : undefined },
      );
    }

    const customPrompt = await loadEnglishModernizationPrompt(db, resolved.source);
    const result = await generateModernization(db, page as never, resolved.text, resolved.source, sourceHash, {
      customPrompt,
      triggeredBy,
    });

    return NextResponse.json({
      modernized: result.text,
      cached: false,
      source: resolved.source,
      usage: result.usage,
    });
  } catch (error) {
    console.error('Error modernizing page:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to modernize page' },
      { status: 500 },
    );
  }
}
