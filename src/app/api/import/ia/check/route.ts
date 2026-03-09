import { NextRequest, NextResponse } from 'next/server';

/**
 * Check if an Internet Archive item is importable without actually importing it.
 *
 * GET /api/import/ia/check?id=IDENTIFIER
 * POST /api/import/ia/check  { identifiers: ["id1", "id2", ...] }
 *
 * Returns page count, source, IIIF availability, and whether the item
 * already exists in the library.
 */

import { getDb } from '@/lib/mongodb';

interface CheckResult {
  identifier: string;
  importable: boolean;
  pageCount: number;
  pageCountSource: string;
  iiifAvailable: boolean;
  alreadyExists: boolean;
  existingBookId?: string;
  title?: string;
  creator?: string;
  date?: string;
  error?: string;
}

async function checkIdentifier(identifier: string): Promise<CheckResult> {
  const result: CheckResult = {
    identifier,
    importable: false,
    pageCount: 0,
    pageCountSource: '',
    iiifAvailable: false,
    alreadyExists: false,
  };

  // 1. Fetch IA metadata
  let metadata;
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      result.error = `IA metadata HTTP ${res.status}`;
      return result;
    }
    metadata = await res.json();
  } catch (e) {
    result.error = `IA metadata fetch failed: ${e}`;
    return result;
  }

  const iaMetadata = metadata.metadata || {};
  result.title = typeof iaMetadata.title === 'string' ? iaMetadata.title : Array.isArray(iaMetadata.title) ? iaMetadata.title[0] : undefined;
  result.creator = typeof iaMetadata.creator === 'string' ? iaMetadata.creator : Array.isArray(iaMetadata.creator) ? iaMetadata.creator[0] : undefined;
  result.date = iaMetadata.date || iaMetadata.year || undefined;

  // 2. Try IIIF manifest
  try {
    const iiifRes = await fetch(
      `https://iiif.archive.org/iiif/${identifier}/manifest.json`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (iiifRes.ok) {
      result.iiifAvailable = true;
      const manifest = await iiifRes.json();
      if (manifest.items) {
        result.pageCount = manifest.items.length;
        result.pageCountSource = 'iiif_v3';
      } else if (manifest.sequences?.[0]?.canvases) {
        result.pageCount = manifest.sequences[0].canvases.length;
        result.pageCountSource = 'iiif_v2';
      }
    }
  } catch {
    // IIIF not available
  }

  // 3. Fallback: imagecount
  if (result.pageCount === 0 && iaMetadata.imagecount) {
    result.pageCount = parseInt(iaMetadata.imagecount, 10);
    result.pageCountSource = 'imagecount';
  }

  // 4. Fallback: JP2 files
  if (result.pageCount === 0) {
    const files = metadata.files || [];
    const jp2Files = files.filter((f: { name: string }) =>
      f.name.endsWith('.jp2') && !f.name.includes('thumb')
    );
    if (jp2Files.length > 1) {
      result.pageCount = jp2Files.length;
      result.pageCountSource = 'jp2_files';
    }
  }

  result.importable = result.pageCount > 0;

  // 5. Check if already in library
  try {
    const db = await getDb();
    const existing = await db.collection('books').findOne(
      {
        $or: [
          { ia_identifier: identifier },
          { 'dublin_core.dc_identifier': `IA:${identifier}` },
        ],
      },
      { projection: { id: 1, _id: 1 } }
    );
    if (existing) {
      result.alreadyExists = true;
      result.existingBookId = existing.id || existing._id.toString();
    }
  } catch {
    // DB check failed, continue without it
  }

  return result;
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { error: 'Missing ?id= parameter' },
      { status: 400 }
    );
  }

  const result = await checkIdentifier(id);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const identifiers: string[] = body.identifiers || [];

  if (!identifiers.length || identifiers.length > 50) {
    return NextResponse.json(
      { error: 'Provide 1-50 identifiers' },
      { status: 400 }
    );
  }

  // Process in parallel, 10 at a time
  const results: CheckResult[] = [];
  for (let i = 0; i < identifiers.length; i += 10) {
    const batch = identifiers.slice(i, i + 10);
    const batchResults = await Promise.all(batch.map(checkIdentifier));
    results.push(...batchResults);
  }

  const summary = {
    total: results.length,
    importable: results.filter((r) => r.importable).length,
    alreadyImported: results.filter((r) => r.alreadyExists).length,
    notImportable: results.filter((r) => !r.importable).length,
  };

  return NextResponse.json({ summary, results });
}
