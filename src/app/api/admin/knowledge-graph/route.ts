import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface GraphNode {
  id: string;
  label: string;
  type: 'book' | 'author' | 'printer' | 'place' | 'subject';
  size?: number;
  year?: number;
  metadata?: Record<string, unknown>;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'authored' | 'printed_by' | 'printed_in' | 'has_subject' | 'same_work' | 'shared_entities';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope') || 'istc'; // 'istc' | 'all'
  const minYear = parseInt(searchParams.get('minYear') || '1450');
  const maxYear = parseInt(searchParams.get('maxYear') || '1501');

  const db = await getDb();

  // Query ISTC books
  const query: Record<string, unknown> = scope === 'istc'
    ? { 'catalog_ids.istc': { $exists: true } }
    : { published: { $gte: String(minYear), $lte: String(maxYear) } };

  const books = await db.collection('books').find(query).project({
    id: 1, _id: 1, title: 1, author: 1, published: 1, language: 1,
    slug: 1, pages_count: 1, catalog_ids: 1, work_id: 1,
    'image_source.provider': 1, 'image_source.place': 1,
    related_books: 1, collections: 1,
  }).toArray();

  // Also get import_candidates for richer metadata (printer, place)
  const istcIds = books.map(b => b.catalog_ids?.istc).filter(Boolean);
  const candidates = await db.collection('import_candidates').find({
    source: 'istc',
    source_id: { $in: istcIds },
  }).project({
    source_id: 1, publisher: 1, place: 1, subjects: 1, format: 1,
  }).toArray();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidateMap = new Map<string, any>(candidates.map(c => [c.source_id, c]));

  // Build graph
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const authorSet = new Map<string, { count: number; years: number[] }>();
  const placeSet = new Map<string, { count: number }>();
  const printerSet = new Map<string, { count: number }>();
  const subjectSet = new Map<string, { count: number }>();
  const workGroups = new Map<string, string[]>();

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const year = parseInt(book.published) || 0;
    const candidate = candidateMap.get(book.catalog_ids?.istc);

    // Book node
    nodes.push({
      id: `book:${bookId}`,
      label: book.title?.substring(0, 60) || 'Untitled',
      type: 'book',
      size: Math.max(4, Math.min(20, (book.pages_count || 50) / 20)),
      year,
      metadata: {
        slug: book.slug,
        author: book.author,
        language: book.language,
        pages: book.pages_count,
        istc: book.catalog_ids?.istc,
        provider: book.image_source?.provider,
      },
    });

    // Author edges
    const author = book.author?.trim();
    if (author && author !== 'Unknown' && author !== 'Anonymous') {
      const authorKey = author.toLowerCase().replace(/[,.].*$/, '').trim();
      if (!authorSet.has(authorKey)) authorSet.set(authorKey, { count: 0, years: [] });
      const a = authorSet.get(authorKey)!;
      a.count++;
      if (year) a.years.push(year);
      edges.push({ source: `author:${authorKey}`, target: `book:${bookId}`, type: 'authored' });
    }

    // Place edges (from import_candidates)
    const place = candidate?.place;
    if (place) {
      const placeKey = place.toLowerCase().trim();
      if (!placeSet.has(placeKey)) placeSet.set(placeKey, { count: 0 });
      placeSet.get(placeKey)!.count++;
      edges.push({ source: `book:${bookId}`, target: `place:${placeKey}`, type: 'printed_in' });
    }

    // Printer edges
    const printer = candidate?.publisher;
    if (printer) {
      const printerKey = printer.toLowerCase().substring(0, 40).trim();
      if (!printerSet.has(printerKey)) printerSet.set(printerKey, { count: 0 });
      printerSet.get(printerKey)!.count++;
      edges.push({ source: `book:${bookId}`, target: `printer:${printerKey}`, type: 'printed_by' });
    }

    // Subject edges
    if (candidate?.subjects) {
      for (const subj of candidate.subjects.slice(0, 3)) {
        const subjKey = subj.toLowerCase().trim();
        if (!subjectSet.has(subjKey)) subjectSet.set(subjKey, { count: 0 });
        subjectSet.get(subjKey)!.count++;
        edges.push({ source: `book:${bookId}`, target: `subject:${subjKey}`, type: 'has_subject' });
      }
    }

    // Work_id grouping
    if (book.work_id) {
      if (!workGroups.has(book.work_id)) workGroups.set(book.work_id, []);
      workGroups.get(book.work_id)!.push(bookId);
    }
  }

  // Add author nodes
  for (const [key, data] of authorSet) {
    if (data.count >= 1) {
      nodes.push({
        id: `author:${key}`,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        type: 'author',
        size: Math.max(6, Math.min(30, data.count * 3)),
        year: data.years.length ? Math.round(data.years.reduce((a, b) => a + b, 0) / data.years.length) : undefined,
      });
    }
  }

  // Add place nodes (only those with 2+ books)
  for (const [key, data] of placeSet) {
    if (data.count >= 2) {
      nodes.push({
        id: `place:${key}`,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        type: 'place',
        size: Math.max(8, Math.min(25, data.count * 2)),
      });
    }
  }

  // Add printer nodes (only those with 2+ books)
  for (const [key, data] of printerSet) {
    if (data.count >= 2) {
      nodes.push({
        id: `printer:${key}`,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        type: 'printer',
        size: Math.max(5, Math.min(20, data.count * 2)),
      });
    }
  }

  // Add subject nodes (only those with 3+ books)
  for (const [key, data] of subjectSet) {
    if (data.count >= 3) {
      nodes.push({
        id: `subject:${key}`,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        type: 'subject',
        size: Math.max(5, Math.min(20, data.count * 2)),
      });
    }
  }

  // Add same_work edges
  for (const [, bookIds] of workGroups) {
    if (bookIds.length > 1) {
      for (let i = 0; i < bookIds.length - 1; i++) {
        edges.push({ source: `book:${bookIds[i]}`, target: `book:${bookIds[i + 1]}`, type: 'same_work' });
      }
    }
  }

  // Filter edges to only include edges where both nodes exist
  const nodeIds = new Set(nodes.map(n => n.id));
  const filteredEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  return NextResponse.json({
    nodes,
    edges: filteredEdges,
    stats: {
      books: books.length,
      authors: authorSet.size,
      places: placeSet.size,
      printers: printerSet.size,
      subjects: subjectSet.size,
      workGroups: workGroups.size,
    },
  });
}
