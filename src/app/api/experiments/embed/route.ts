import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getGeminiClient } from '@/lib/gemini-client';

// Embedding calls (`embedContent`) are NOT metered by the client wrapper: the
// response carries no usageMetadata, so there is nothing to record from. What
// embedding costs is tracked on the worker side instead (#4162,
// scripts/lib/embedding-usage.mjs). Routed through the shared client anyway,
// for key rotation and so no construction of the SDK escapes it.
// Lazy: resolving an API key at module scope would turn a missing
// GEMINI_API_KEY into an import-time throw, and route modules are imported
// during the build.
let _genAI: ReturnType<typeof getGeminiClient> | null = null;
const genAI = () => (_genAI ??= getGeminiClient({ endpoint: '/api/experiments/embed', type: 'other' }));

export const POST = withAuth(async (req) => {
  try {
    const { texts } = await req.json();
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: 'texts must be a non-empty array' }, { status: 400 });
    }
    if (texts.length > 300) {
      return NextResponse.json({ error: 'max 300 texts per request' }, { status: 400 });
    }

    const model = genAI().getGenerativeModel({ model: 'gemini-embedding-001' });
    const result = await model.batchEmbedContents({
      requests: texts.map((t: string) => ({
        content: { role: 'user' as const, parts: [{ text: t }] },
      })),
    });

    return NextResponse.json({
      embeddings: result.embeddings.map((e) => e.values),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, { minRole: 'editor' });
