import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

/**
 * Saves the /about reading-demo boxes from the box editor (/about?edit).
 * Local development only: in any deployed build this answers 404 and writes nothing.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') return new NextResponse('Not found', { status: 404 });
  const data = await req.json();
  if (!Array.isArray(data) || !data.every((r) => r && typeof r.img === 'string' && r.line && Array.isArray(r.ents) && r.plate)) {
    return NextResponse.json({ error: 'unexpected shape' }, { status: 400 });
  }
  const file = path.join(process.cwd(), 'src/components/about/readings.json');
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  return NextResponse.json({ ok: true });
}
