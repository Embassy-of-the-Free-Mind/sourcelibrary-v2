import { NextRequest, NextResponse } from 'next/server';

// mongodb requires the Node.js runtime (never edge).
export const runtime = 'nodejs';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getCoverMaterials } from '@/lib/cover-materials';

/**
 * GET /api/admin/cover-materials/[id]   (admin only)
 *
 * What the cover maker (/admin/covers/[bookId]) builds covers from. See
 * getCoverMaterials in src/lib/cover-materials.ts. Read-only.
 */
export const GET = withAdminAuth(async (_req: NextRequest, _session, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const materials = await getCoverMaterials(await getDb(), id);
  if (!materials) return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  return NextResponse.json(materials, { headers: { 'Cache-Control': 'private, no-store' } });
});
