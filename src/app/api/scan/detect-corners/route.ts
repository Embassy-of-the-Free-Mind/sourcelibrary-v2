export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { performOCRWithBuffer } from '@/lib/ai';

const CORNER_PROMPT = `Detect the boundaries of the book page in this photo. Return ONLY valid JSON:

{
  "corners": [[topLeft_x, topLeft_y], [topRight_x, topRight_y], [bottomRight_x, bottomRight_y], [bottomLeft_x, bottomLeft_y]]
}

Coordinates are normalized 0-1 (0,0 = top-left of photo, 1,1 = bottom-right).
Only include the page itself, not the desk/background.
If the page fills the entire image, return [[0,0],[1,0],[1,1],[0,1]].
Return ONLY the JSON object, no markdown fences.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file || !file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Image file required' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const result = await performOCRWithBuffer(
      buffer,
      file.type,
      CORNER_PROMPT
    );

    let corners: [number, number][] | null = null;

    try {
      const cleaned = result.text
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      corners = parsed.corners || null;
    } catch {
      // Corner detection failed — client will skip correction
    }

    return NextResponse.json({ corners });
  } catch (error) {
    console.error('Corner detection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
