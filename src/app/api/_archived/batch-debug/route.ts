import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobName = searchParams.get('job') || 'batches/9bjhc4ncqcbb6p7k2njdhzwwkvt2lm1akl4n';
  const showResults = searchParams.get('results') === 'true';

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key' }, { status: 500 });
  }

  const response = await fetch(
    `${GEMINI_API_BASE}/${jobName}?key=${apiKey}`,
    { method: 'GET' }
  );

  const data = await response.json();

  // Optionally download and show results
  let results = null;
  if (showResults && data.metadata?.output?.responsesFile) {
    const fileName = data.metadata.output.responsesFile;
    const fileResponse = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`,
      { method: 'GET' }
    );
    if (fileResponse.ok) {
      const text = await fileResponse.text();
      const lines = text.trim().split('\n').filter(line => line.trim());
      // Only show first 2 results to avoid huge responses
      results = lines.slice(0, 2).map(line => {
        const parsed = JSON.parse(line);
        return {
          key: parsed.key,
          metadata_key: parsed.metadata?.key,
          has_response: !!parsed.response,
          has_error: !!parsed.error,
          text_preview: parsed.response?.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 200),
        };
      });
    }
  }

  return NextResponse.json({
    status: response.status,
    keys: Object.keys(data),
    metadata_keys: data.metadata ? Object.keys(data.metadata) : null,
    output_keys: data.metadata?.output ? Object.keys(data.metadata.output) : null,
    responsesFile: data.metadata?.output?.responsesFile,
    results,
    raw: data,
  });
}
