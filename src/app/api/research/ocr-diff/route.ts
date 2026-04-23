import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const maxDuration = 30;

/**
 * GET /api/research/ocr-diff?work_id=X
 * Returns aligned OCR pairs for editions of a given work.
 *
 * If no work_id is provided, returns a list of available work_id clusters.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workId = searchParams.get('work_id');

  const db = await getReadDb();

  // List available clusters
  if (!workId) {
    const clusters = await db
      .collection('books')
      .aggregate([
        { $match: { status: 'published', work_id: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$work_id',
            count: { $sum: 1 },
            books: {
              $push: {
                id: '$id',
                title: '$title',
                year: '$year',
                pages_ocr: '$pages_ocr',
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return NextResponse.json({ clusters });
  }

  // Get aligned pages for a specific work_id
  const books = await db
    .collection('books')
    .find(
      { work_id: workId, status: 'published' },
      { projection: { id: 1, title: 1, year: 1, pages_ocr: 1 } },
    )
    .sort({ pages_ocr: -1 })
    .toArray();

  if (books.length < 2) {
    return NextResponse.json({ error: 'Need at least 2 editions' }, { status: 400 });
  }

  const [edA, edB] = books;

  // Load OCR and translation for both editions
  const [pagesA, pagesB] = await Promise.all([
    db
      .collection('pages')
      .find(
        { book_id: edA.id as string, 'ocr.data': { $exists: true, $ne: null } },
        { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
      )
      .sort({ page_number: 1 })
      .toArray(),
    db
      .collection('pages')
      .find(
        { book_id: edB.id as string, 'ocr.data': { $exists: true, $ne: null } },
        { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
      )
      .sort({ page_number: 1 })
      .toArray(),
  ]);

  // Strip metadata from OCR to get raw text
  function stripMeta(ocr: string): string {
    return ocr
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[\[[^\]]*\]\]/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trigrams(s: string): Set<string> {
    const p = '  ' + s.toLowerCase() + '  ';
    const set = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  }

  function triSim(a: string, b: string): number {
    if (!a || !b || a.length < 30 || b.length < 30) return 0;
    const ta = trigrams(a),
      tb = trigrams(b);
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
  }

  // Extract text pages with content
  const textsA = pagesA
    .map((p) => ({
      page: p.page_number as number,
      ocr: stripMeta(p.ocr.data as string),
      translation: (p.translation?.data as string) || '',
    }))
    .filter((p) => p.ocr.length > 80);

  const textsB = pagesB
    .map((p) => ({
      page: p.page_number as number,
      ocr: stripMeta(p.ocr.data as string),
      translation: (p.translation?.data as string) || '',
    }))
    .filter((p) => p.ocr.length > 80);

  // Align: for each page in A, find best match in B
  const alignedPairs: Array<{
    pageA: number;
    pageB: number;
    similarity: number;
    ocrA: string;
    ocrB: string;
    translationA: string;
    translationB: string;
  }> = [];

  const usedB = new Set<number>();

  for (const a of textsA) {
    let bestSim = 0;
    let bestIdx = -1;

    for (let j = 0; j < textsB.length; j++) {
      if (usedB.has(j)) continue;
      const sim = triSim(a.ocr.substring(0, 500), textsB[j].ocr.substring(0, 500));
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }

    if (bestSim > 0.25 && bestIdx >= 0) {
      usedB.add(bestIdx);
      const b = textsB[bestIdx];
      alignedPairs.push({
        pageA: a.page,
        pageB: b.page,
        similarity: Math.round(bestSim * 1000) / 1000,
        ocrA: a.ocr.substring(0, 2000),
        ocrB: b.ocr.substring(0, 2000),
        translationA: a.translation.substring(0, 1000),
        translationB: b.translation.substring(0, 1000),
      });
    }
  }

  // Sort by similarity descending (best matches first)
  alignedPairs.sort((a, b) => b.similarity - a.similarity);

  return NextResponse.json({
    workId,
    editionA: { id: edA.id, title: edA.title, year: edA.year, pages: textsA.length },
    editionB: { id: edB.id, title: edB.title, year: edB.year, pages: textsB.length },
    alignedPairs: alignedPairs.slice(0, 50), // limit for response size
    stats: {
      totalA: textsA.length,
      totalB: textsB.length,
      aligned: alignedPairs.length,
      avgSimilarity:
        alignedPairs.length > 0
          ? Math.round(
              (alignedPairs.reduce((s, p) => s + p.similarity, 0) / alignedPairs.length) * 1000,
            ) / 1000
          : 0,
    },
  });
}
