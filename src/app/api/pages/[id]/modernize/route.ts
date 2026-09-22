import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonActionGate, SIGNIN_URL } from '@/lib/anon-gate';
import { getTriggerSource } from '@/lib/cron-auth';
import {
  hashString,
  resolveModernizationSource,
  readCachedModernization,
  generateModernization,
  loadEnglishModernizationPrompt,
  wouldBeNoOp,
} from '@/lib/modernize-page';

/**
 * On-demand modernization for one page. The logic lives in `@/lib/modernize-page` so
 * that this route and its tenant twin cannot drift — see that file's header for why the
 * gate and the fixed model are there (#4958).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const triggeredBy = getTriggerSource(request);
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

    // Cached serves are free and ungated — a reader who hits the cap must still be able
    // to read text already paid for.
    const cached = readCachedModernization(page, sourceHash, resolved.source);
    if (cached && !regenerate) {
      return NextResponse.json({
        modernized: cached,
        cached: true,
        source: resolved.source,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
      });
    }

    // Refuse before spending, not after. 200 rather than an error: "this page needs no
    // modernizing" is a successful answer to the question, and the reader renders it as
    // a note rather than a failure.
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

/** Retrieve an existing modernization without generating one. Always free. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }
    if (!page.modernized?.data) {
      return NextResponse.json({ modernized: null, message: 'No modernization. Call POST to generate.' });
    }

    const book = await db.collection('books').findOne({ id: page.book_id }, { projection: { language: 1 } });
    const resolved = resolveModernizationSource(page, book);
    const isStale = resolved
      ? readCachedModernization(page, hashString(resolved.text), resolved.source) === null
      : false;

    return NextResponse.json({
      modernized: page.modernized.data,
      model: page.modernized.model,
      source: page.modernized.source ?? null,
      updated_at: page.modernized.updated_at,
      isStale,
    });
  } catch (error) {
    console.error('Error fetching modernization:', error);
    return NextResponse.json({ error: 'Failed to fetch modernization' }, { status: 500 });
  }
}
