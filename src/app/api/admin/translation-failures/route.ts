/**
 * Translation-failure triage — confirmed_first first-translation candidates that
 * are stuck in the pipeline rather than waiting to be queued.
 *
 * Motivation: of ~322 untranslated `confirmed_first` books, ~226 are
 * `pipeline_auto.status` failed / needs_attention (they ran and broke), not
 * un-queued work. Re-queuing a book that already failed just fails again — so
 * triage groups them by ROOT CAUSE and only re-enrolls the buckets that are
 * genuinely retryable. These are shippable first translations once unblocked,
 * which is why the scope is confirmed_first + untranslated specifically.
 *
 * Root-cause buckets observed in prod:
 *   - import_failed_empty   → never got pages; needs re-acquisition, NOT a retry
 *   - ocr_finalize_blocked  → OCR produced 0 pages; retry is worth a shot
 *   - ocr_failed_precondition → gemini-preview deprecation casualties; root cause
 *                              already fixed (commit f346e288), so retry should work
 *   - image_download_failed → provider hiccup (retry) unless IA access-restricted (park)
 *   - ia_access_restricted  → lending/printdisabled; unarchivable, do not retry
 *
 * Retry re-enrolls in place (status → 'queued', retry_count → 0) — the same
 * mechanism as /api/admin/enroll-pipeline, but scoped to this set so a stray id
 * can't be enrolled through here. Page: /platform/admin/translation-failures.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withEditorAuth } from '@/lib/auth-helpers';
import { getDb, getReadDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SCOPE = {
  'translation_verification.disposition': 'confirmed_first',
  is_first_translation: true,
  $expr: { $lte: [{ $ifNull: ['$pages_translated', 0] }, 0] },
  'pipeline_auto.status': { $in: ['failed', 'needs_attention'] },
};

type BucketKey =
  | 'import_failed_empty'
  | 'ocr_finalize_blocked'
  | 'ocr_failed_precondition'
  | 'image_download_failed'
  | 'ia_access_restricted'
  | 'other';

interface BucketMeta {
  label: string;
  detail: string;
  action: 'retry' | 'reacquire' | 'park' | 'review';
}

// retry = re-enrolling should help; reacquire = needs a fresh source; park = unfixable
// here; review = unknown, look before acting.
const BUCKETS: Record<BucketKey, BucketMeta> = {
  ocr_failed_precondition: {
    label: 'OCR precondition failed',
    detail: 'gemini-preview deprecation casualties — root cause fixed, retry should now succeed.',
    action: 'retry',
  },
  ocr_finalize_blocked: {
    label: 'OCR finalize blocked',
    detail: 'OCR produced 0 usable pages. Re-enrolling re-runs OCR; worth a shot.',
    action: 'retry',
  },
  image_download_failed: {
    label: 'Image download failed',
    detail: 'Page images failed to download — often a transient provider hiccup.',
    action: 'retry',
  },
  import_failed_empty: {
    label: 'Import failed (empty)',
    detail: 'The import never produced pages. Needs re-acquisition from another source — a retry will not help.',
    action: 'reacquire',
  },
  ia_access_restricted: {
    label: 'IA access-restricted',
    detail: 'Lending / print-disabled at the Internet Archive — unarchivable. Park or find another source.',
    action: 'park',
  },
  other: {
    label: 'Other / unclassified',
    detail: 'No matched signature — inspect the error before acting.',
    action: 'review',
  },
};

function classify(pa: { error?: string; attention_reason?: string }): BucketKey {
  const reason = pa.attention_reason || '';
  const err = pa.error || '';
  if (reason === 'import_failed_empty') return 'import_failed_empty';
  if (reason === 'ocr_finalize_blocked' || /Finalize blocked/i.test(err)) return 'ocr_finalize_blocked';
  if (/access-restricted|lending|printdisabled/i.test(err)) return 'ia_access_restricted';
  if (reason === 'image_download_failed' || /image downloads? failed/i.test(err)) return 'image_download_failed';
  if (/FAILED_PRECONDITION|Precondition check/i.test(err)) return 'ocr_failed_precondition';
  return 'other';
}

export const GET = withEditorAuth(async () => {
  const db = await getReadDb();
  const rows = await db.collection('books')
    .find(SCOPE)
    .project({
      _id: 0,
      id: 1,
      slug: 1,
      title: 1,
      display_title: 1,
      author: 1,
      language: 1,
      pages_count: 1,
      pages_ocr: 1,
      'pipeline_auto.status': 1,
      'pipeline_auto.error': 1,
      'pipeline_auto.attention_reason': 1,
      'pipeline_auto.retry_count': 1,
      'pipeline_auto.last_updated': 1,
    })
    .toArray();

  const grouped: Record<BucketKey, Array<Record<string, unknown>>> = {
    ocr_failed_precondition: [], ocr_finalize_blocked: [], image_download_failed: [],
    import_failed_empty: [], ia_access_restricted: [], other: [],
  };

  for (const b of rows) {
    const pa = b.pipeline_auto || {};
    const key = classify(pa);
    grouped[key].push({
      id: b.id,
      slug: b.slug,
      title: b.display_title || b.title,
      author: b.author,
      language: b.language,
      pages_count: b.pages_count || 0,
      pages_ocr: b.pages_ocr || 0,
      status: pa.status,
      retry_count: pa.retry_count || 0,
      error: (pa.error || pa.attention_reason || '').toString().slice(0, 200),
      last_updated: pa.last_updated || null,
    });
  }

  const buckets = (Object.keys(BUCKETS) as BucketKey[])
    .map((key) => ({
      key,
      ...BUCKETS[key],
      count: grouped[key].length,
      retryable: BUCKETS[key].action === 'retry',
      books: grouped[key].sort((a, b) => (b.pages_count as number) - (a.pages_count as number)),
    }))
    .filter((b) => b.count > 0);

  return NextResponse.json({ total: rows.length, buckets });
});

export const POST = withEditorAuth(async (request: NextRequest, session) => {
  const body = await request.json().catch(() => null);
  const bookIds = Array.isArray(body?.bookIds) ? body.bookIds.filter((x: unknown) => typeof x === 'string') : [];
  if (bookIds.length === 0) {
    return NextResponse.json({ error: 'bookIds (string[]) required' }, { status: 400 });
  }
  if (bookIds.length > 500) {
    return NextResponse.json({ error: 'too many books in one retry (max 500)' }, { status: 400 });
  }

  const db = await getDb();
  const now = new Date();
  const by = (session.user as { email?: string })?.email || 'unknown';

  // Scope guard: only re-enroll ids that are actually in the failed/needs_attention
  // confirmed_first untranslated set — a stray id can't be queued through here.
  const inScope = await db.collection('books')
    .find({ ...SCOPE, id: { $in: bookIds } })
    .project({ id: 1, _id: 0 })
    .toArray();
  const scopedIds = inScope.map((b) => b.id);
  if (scopedIds.length === 0) {
    return NextResponse.json({ error: 'no provided ids are in the retryable scope' }, { status: 400 });
  }

  const result = await db.collection('books').updateMany(
    { id: { $in: scopedIds } },
    {
      $set: {
        'pipeline_auto.status': 'queued',
        'pipeline_auto.source': 'admin-triage',
        'pipeline_auto.retry_count': 0,
        'pipeline_auto.queued_at': now,
        'pipeline_auto.last_updated': now,
        'pipeline_auto.requeued_by': by,
        updated_at: now,
      },
    },
  );

  return NextResponse.json({
    ok: true,
    requested: bookIds.length,
    requeued: result.modifiedCount,
    skipped: bookIds.length - scopedIds.length,
    message: `Re-enrolled ${result.modifiedCount} book(s). The pipeline cron picks them up within ~10 minutes.`,
  });
});
