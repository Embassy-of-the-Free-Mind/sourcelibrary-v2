import { readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'src/data/concept-diffusion-research.json');
    const data = readFileSync(filePath, 'utf8');

    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="concept-diffusion-research-v2.json"',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  }
}
