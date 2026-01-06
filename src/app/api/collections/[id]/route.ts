import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const dynamic = 'force-static';
export const revalidate = 3600;

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const collectionPath = path.join(
      process.cwd(),
      'curator-data',
      'collections',
      `${params.id}.json`
    );

    const collectionData = await fs.readFile(collectionPath, 'utf-8');
    const collection = JSON.parse(collectionData);

    return NextResponse.json(collection);
  } catch (error) {
    console.error(`Error loading collection ${params.id}:`, error);
    return NextResponse.json(
      { error: 'Collection not found' },
      { status: 404 }
    );
  }
}
