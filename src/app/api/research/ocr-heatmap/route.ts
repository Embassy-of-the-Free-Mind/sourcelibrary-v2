import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { supabase as sb } from '@/lib/supabase';

export const maxDuration = 60;

function cosineSim(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workId = searchParams.get('work_id');

  const db = await getReadDb();

  if (!workId) {
    // List clusters with embedding counts
    const clusters = await db
      .collection('books')
      .aggregate([
        { $match: { status: 'published', work_id: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$work_id',
            count: { $sum: 1 },
            books: { $push: { id: '$id', title: '$title', year: '$year', language: '$language' } },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return NextResponse.json({ clusters });
  }

  // Get editions
  const books = await db
    .collection('books')
    .find({ work_id: workId, status: 'published' }, { projection: { id: 1, title: 1, year: 1 } })
    .sort({ year: 1 })
    .limit(3)
    .toArray();

  if (books.length < 2) {
    return NextResponse.json({ error: 'Need 2+ editions' }, { status: 400 });
  }

  const [edA, edB] = books;

  // Fetch page embeddings for both editions from Supabase
  async function getPageEmbeddings(bookId: string) {
    const allPages: Array<{ page_number: number; embedding: number[] }> = [];
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from('page_translations')
        .select('page_number, embedding')
        .eq('book_id', bookId)
        .not('embedding', 'is', null)
        .order('page_number')
        .range(offset, offset + 499);

      if (error || !data || data.length === 0) break;
      for (const row of data) {
        const emb = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
        allPages.push({ page_number: row.page_number, embedding: emb });
      }
      offset += 500;
      if (data.length < 500) break;
    }
    return allPages;
  }

  const [embA, embB] = await Promise.all([
    getPageEmbeddings(edA.id as string),
    getPageEmbeddings(edB.id as string),
  ]);

  // Sample if too many pages (limit heatmap to 80x80)
  const maxPages = 80;
  const sampleA =
    embA.length > maxPages
      ? embA.filter((_, i) => i % Math.ceil(embA.length / maxPages) === 0).slice(0, maxPages)
      : embA;
  const sampleB =
    embB.length > maxPages
      ? embB.filter((_, i) => i % Math.ceil(embB.length / maxPages) === 0).slice(0, maxPages)
      : embB;

  // Compute similarity matrix
  const matrix: number[][] = [];
  for (const pageA of sampleA) {
    const row: number[] = [];
    for (const pageB of sampleB) {
      row.push(Math.round(cosineSim(pageA.embedding, pageB.embedding) * 1000) / 1000);
    }
    matrix.push(row);
  }

  // Compute stats: diagonal alignment quality
  const diag: number[] = [];
  const minLen = Math.min(sampleA.length, sampleB.length);
  for (let i = 0; i < minLen; i++) {
    // Best match in row i
    const row = matrix[i];
    const bestIdx = row.indexOf(Math.max(...row));
    const bestSim = row[bestIdx];
    diag.push(bestSim);
  }

  const avgBestMatch = diag.reduce((s, v) => s + v, 0) / diag.length;

  return NextResponse.json({
    workId,
    editionA: { id: edA.id, title: edA.title, year: edA.year, pages: embA.length },
    editionB: { id: edB.id, title: edB.title, year: edB.year, pages: embB.length },
    pagesA: sampleA.map((p) => p.page_number),
    pagesB: sampleB.map((p) => p.page_number),
    matrix,
    stats: {
      avgBestMatch: Math.round(avgBestMatch * 1000) / 1000,
      totalA: embA.length,
      totalB: embB.length,
      sampledA: sampleA.length,
      sampledB: sampleB.length,
    },
  });
}
