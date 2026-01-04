import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 20) {
      return NextResponse.json({ valid: false, error: 'Invalid API key format' });
    }

    // Test the key by making a simple request
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Simple test prompt
    const result = await model.generateContent('Say "ok" and nothing else.');
    const response = result.response.text();

    // If we got here, the key works
    return NextResponse.json({
      valid: true,
      message: 'API key is valid',
    });
  } catch (error) {
    console.error('API key validation error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for specific error types
    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
      return NextResponse.json({ valid: false, error: 'Invalid API key' });
    }

    if (errorMessage.includes('QUOTA_EXCEEDED') || errorMessage.includes('quota')) {
      return NextResponse.json({ valid: false, error: 'API quota exceeded' });
    }

    return NextResponse.json({ valid: false, error: errorMessage });
  }
}
