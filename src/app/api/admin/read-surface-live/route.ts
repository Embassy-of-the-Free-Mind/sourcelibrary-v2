/**
 * GET /api/admin/read-surface-live — the live state of the read-surface experiment (#6740) for the page at
 * /platform/admin/ocr-evidence/read-surface/live, which polls it every 30 s. Returns the ops_reports doc as stored;
 * the page asserts its shape on read (shape.ts). Superadmin only, as the page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getReadDb } from '@/lib/mongodb';
import { LIVE_REPORT_ID } from '@/app/platform/(protected)/admin/ocr-evidence/read-surface/live/shape';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request: NextRequest) => {
  const db = await getReadDb();
  const doc = await db.collection<{ _id: string }>('ops_reports').findOne({ _id: LIVE_REPORT_ID });
  return NextResponse.json({ doc }, { headers: { 'Cache-Control': 'no-store' } });
}, { minRole: 'superadmin' });
