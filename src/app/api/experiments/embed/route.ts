import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { withAuth } from '@/lib/auth-helpers';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export const POST = withAuth(async (req) => {
  try {
    const { texts } = await req.json();
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: 'texts must be a non-empty array' }, { status: 400 });
    }
    if (texts.length > 300) {
      return NextResponse.json({ error: 'max 300 texts per request' }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
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
