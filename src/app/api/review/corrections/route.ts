import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/mongodb';
import { guardPublicSubmission } from '@/lib/public-submission-guard';
import { isValidVolunteerId } from '@/lib/review-queue';
import { contentHash } from '@/lib/write-provenance';
import { applySpanEdits, normalizeEdits } from '../../../../../scripts/lib/span-edits.mjs';

export const maxDuration = 10;

const FIELDS = new Set(['ocr', 'translation']);
const DRAFTED_BY = new Set(['volunteer', 'assistant_accepted', 'mixed']);
const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * POST /api/review/corrections — a volunteer PROPOSES a correction (#6418).
 *
 * Body: { page_id, field: 'ocr'|'translation', base_hash, edits: [{find, replace, reason?}],
 *         volunteer_id, volunteer_label?, drafted_by?, assistant_model?, note?, shift_id? }
 *
 * A proposal never touches `pages`. It lands in `page_corrections` with status
 * `proposed`; a second reader applies it with
 * scripts/maintenance/apply-page-correction.mjs, which saves a revision, writes
 * compare-and-set against the same `base_hash`, and stamps provenance. See
 * .claude/docs/volunteer-shifts-design.md.
 *
 * Refused here rather than at apply time, so the volunteer can fix it while the
 * page is still open in front of them:
 *  - the page's stored text no longer matches `base_hash` (409, re-load the page)
 *  - a `find` is absent, repeated, or overlaps another (the span-edit contract)
 *  - the book is not visible
 */
export async function POST(request: NextRequest) {
  const limited = await guardPublicSubmission(request, 'page-corrections');
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const pageId = clip(body.page_id, 64);
  const field = String(body.field ?? '');
  const baseHash = clip(body.base_hash, 64);
  const volunteerId = String(body.volunteer_id ?? '').trim();
  if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 });
  if (!FIELDS.has(field)) return NextResponse.json({ error: "field must be 'ocr' or 'translation'" }, { status: 400 });
  if (!baseHash) return NextResponse.json({ error: 'base_hash required (text_version from the shift)' }, { status: 400 });
  if (!isValidVolunteerId(volunteerId)) return NextResponse.json({ error: 'invalid volunteer_id' }, { status: 400 });

  const normalized = normalizeEdits(body.edits);
  if ('error' in normalized) return NextResponse.json({ error: normalized.error }, { status: 400 });

  const db = await getDb();
  const page = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { id: 1, book_id: 1, page_number: 1, [`${field}.data`]: 1 } },
  );
  const current = (page?.[field] as { data?: string } | undefined)?.data;
  if (!page || !current) return NextResponse.json({ error: 'page or text not found' }, { status: 404 });

  const bookId = String(page.book_id);
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, ...(ObjectId.isValid(bookId) ? [{ _id: new ObjectId(bookId) }] : [])] },
    { projection: { visible: 1 } },
  );
  if (book?.visible !== true) return NextResponse.json({ error: 'book not open for corrections' }, { status: 404 });

  const currentHash = contentHash(current);
  if (currentHash !== baseHash) {
    return NextResponse.json(
      { error: 'stale: this page changed since it was loaded; start a new shift or reload it', current_hash: currentHash },
      { status: 409 },
    );
  }

  const applied = applySpanEdits(current, normalized.edits);
  if ('error' in applied) return NextResponse.json({ error: applied.error }, { status: 400 });

  const draftedBy = DRAFTED_BY.has(String(body.drafted_by)) ? String(body.drafted_by) : 'volunteer';
  const doc = {
    id: nanoid(12),
    status: 'proposed' as const,
    page_id: pageId,
    book_id: bookId,
    page_number: page.page_number ?? null,
    field,
    base_hash: baseHash,
    proposed_hash: contentHash(applied.text),
    edits: normalized.edits,
    note: clip(body.note, 2000),
    volunteer_id: volunteerId,
    volunteer_label: clip(body.volunteer_label, 80),
    drafted_by: draftedBy,
    assistant_model: clip(body.assistant_model, 80),
    shift_id: clip(body.shift_id, 64),
    via: 'mcp-shift',
    created_at: new Date(),
  };
  await db.collection('page_corrections').insertOne(doc);

  return NextResponse.json({ ok: true, id: doc.id, status: doc.status, edits: doc.edits.length });
}
