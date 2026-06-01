/**
 * Curator "Translate Next" queue — disposition dashboard over all
 * `confirmed_first` first-translation candidates.
 *
 * Background: the translation-verification pipeline (PRs #2178/#2190/#2195/
 * #2205/#2226/#2241) labelled ~6,950 books `translation_verification.disposition
 * = 'confirmed_first'` + `is_first_translation: true` — "no prior English
 * translation found, so translating this would be a first." ~93% of those are
 * already fully translated by us; the actionable tail (~450) is untranslated or
 * partial. This surface lets a curator review the whole set, filter it, and act:
 *
 *   - queue              → flag for translation; a scheduled run picks up
 *                          `translation_queue.status: 'queued'` in priority order
 *   - defer              → explicitly not now (keeps it out of the untriaged pile)
 *   - already_translated → a prior English translation DOES exist; this is not a
 *                          first-translation candidate. Flips is_first_translation
 *                          → false and disposition → 'translation_found', stashing
 *                          the prior values in translation_queue.prior for undo.
 *   - clear              → remove the curator decision (restores prior flags if the
 *                          book had been marked already_translated).
 *
 * Default ranking is the existing deterministic `processing_priority` composite
 * (src/lib/processing-priority.ts: subject + language + scan + scholarly +
 * illustrations + efficiency) — read_count is ~0 across the untranslated tail, so
 * it can't carry the ranking on its own.
 *
 * Page: /platform/admin/translate-queue. Read + mutations gated at editor
 * (curator) role via withEditorAuth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withEditorAuth } from '@/lib/auth-helpers';
import { getDb, getReadDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BASE_MATCH = {
  'translation_verification.disposition': 'confirmed_first',
  is_first_translation: true,
};

// Readable-translation threshold, matching the homepage-stats invariant in
// CLAUDE.md: translated if pages_translated >= 90% of (pages_ocr - pages_blank).
const READABLE_RATIO = 0.9;

// $expr fragment computing the readable denominator: max(0, pages_ocr - pages_blank)
const DENOM = { $max: [0, { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }] };
const PT = { $ifNull: ['$pages_translated', 0] };

const STATUS_EXPR: Record<string, Record<string, unknown>> = {
  untranslated: { $lte: [PT, 0] },
  partial: {
    $and: [
      { $gt: [PT, 0] },
      { $lt: [PT, { $multiply: [READABLE_RATIO, DENOM] }] },
    ],
  },
  translated: {
    $and: [
      { $gt: [PT, 0] },
      { $gte: [PT, { $multiply: [READABLE_RATIO, DENOM] }] },
    ],
  },
};

function translationStatus(b: {
  pages_translated?: number;
  pages_ocr?: number;
  pages_blank?: number;
}): 'translated' | 'partial' | 'untranslated' {
  const pt = b.pages_translated || 0;
  if (pt <= 0) return 'untranslated';
  const denom = Math.max(0, (b.pages_ocr || 0) - (b.pages_blank || 0));
  if (denom > 0 && pt >= READABLE_RATIO * denom) return 'translated';
  return 'partial';
}

export const GET = withEditorAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const lang = searchParams.get('lang') || '';
  const collection = searchParams.get('collection') || '';
  const status = searchParams.get('status') || 'all'; // translated|partial|untranslated|all
  const queue = searchParams.get('queue') || 'all'; // queued|deferred|already_translated|untriaged|all
  const minReads = Math.max(0, Number(searchParams.get('minReads')) || 0);
  const q = (searchParams.get('q') || '').trim();
  const sort = searchParams.get('sort') || 'priority';
  const page = Math.max(0, Number(searchParams.get('page')) || 0);
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);

  const db = await getReadDb();
  const books = db.collection('books');

  // ── Build the match for the current filters ────────────────────────────
  const match: Record<string, unknown> = { ...BASE_MATCH };
  if (lang) match.language = lang;
  if (collection) match.collections = collection;
  if (minReads > 0) match.read_count = { $gte: minReads };
  if (queue === 'untriaged') match.translation_queue = { $exists: false };
  else if (queue !== 'all') match['translation_queue.status'] = queue;
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    match.$or = [{ title: rx }, { display_title: rx }, { author: rx }];
  }
  const exprs: Record<string, unknown>[] = [];
  if (status !== 'all' && STATUS_EXPR[status]) exprs.push(STATUS_EXPR[status]);
  if (exprs.length) match.$expr = exprs.length === 1 ? exprs[0] : { $and: exprs };

  // ── Sort ────────────────────────────────────────────────────────────────
  // priority: composite processing_priority desc (the default ranking signal).
  // queue_priority: curator-flagged order (priority asc), for the scheduled run's view.
  const sortSpec: Record<string, 1 | -1> =
    sort === 'reads' ? { read_count: -1, processing_priority: -1 }
    : sort === 'pages_asc' ? { pages_count: 1, processing_priority: -1 }
    : sort === 'pages_desc' ? { pages_count: -1, processing_priority: -1 }
    : sort === 'recent' ? { 'translation_queue.set_at': -1 }
    : sort === 'queue_priority' ? { 'translation_queue.priority': 1, processing_priority: -1 }
    : { processing_priority: -1, read_count: -1 }; // priority (default)

  const projection = {
    _id: 0,
    id: 1,
    slug: 1,
    title: 1,
    display_title: 1,
    author: 1,
    language: 1,
    collections: 1,
    read_count: 1,
    pages_count: 1,
    pages_translated: 1,
    pages_ocr: 1,
    pages_blank: 1,
    processing_priority: 1,
    'translation_verification.disposition': 1,
    'translation_verification.confidence': 1,
    'translation_verification.validated_translations': 1,
    'translation_verification.verification_audit': 1,
    translation_queue: 1,
  };

  const [rows, totalArr] = await Promise.all([
    books.aggregate([
      { $match: match },
      { $sort: sortSpec },
      { $skip: page * limit },
      { $limit: limit },
      { $project: projection },
    ]).toArray(),
    books.aggregate([{ $match: match }, { $count: 'n' }]).toArray(),
  ]);
  const total = totalArr[0]?.n || 0;

  const items = rows.map((b) => {
    const tv = b.translation_verification || {};
    const validated = (tv.validated_translations || []) as Array<Record<string, unknown>>;
    const audit = tv.verification_audit || null;
    return {
      id: b.id,
      slug: b.slug,
      title: b.display_title || b.title,
      author: b.author,
      language: b.language,
      collections: b.collections || [],
      read_count: b.read_count || 0,
      pages_count: b.pages_count || 0,
      pages_translated: b.pages_translated || 0,
      status: translationStatus(b),
      priority_score: typeof b.processing_priority === 'number' ? b.processing_priority : null,
      confidence: tv.confidence || null,
      validated_count: validated.length,
      validated_first: validated[0] || null,
      audit: audit ? { verdict: audit.verdict, confidence: audit.confidence } : null,
      queue: b.translation_queue || null,
    };
  });

  // ── Global facets (over the base set, independent of active filters) ─────
  const [langFacet, statusFacet, queueFacet, collFacet] = await Promise.all([
    books.aggregate([
      { $match: BASE_MATCH },
      { $group: { _id: '$language', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 25 },
    ]).toArray(),
    books.aggregate([
      { $match: BASE_MATCH },
      {
        $group: {
          _id: null,
          untranslated: { $sum: { $cond: [STATUS_EXPR.untranslated, 1, 0] } },
          partial: { $sum: { $cond: [STATUS_EXPR.partial, 1, 0] } },
          translated: { $sum: { $cond: [STATUS_EXPR.translated, 1, 0] } },
        },
      },
    ]).toArray(),
    books.aggregate([
      { $match: BASE_MATCH },
      { $group: { _id: { $ifNull: ['$translation_queue.status', 'untriaged'] }, n: { $sum: 1 } } },
    ]).toArray(),
    books.aggregate([
      { $match: BASE_MATCH },
      { $unwind: '$collections' },
      { $group: { _id: '$collections', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 30 },
    ]).toArray(),
  ]);

  const queueCounts: Record<string, number> = {};
  for (const r of queueFacet) queueCounts[r._id as string] = r.n;

  return NextResponse.json({
    total,
    page,
    limit,
    items,
    facets: {
      languages: langFacet.map((l) => ({ language: l._id || 'Unknown', count: l.n })),
      collections: collFacet.map((c) => ({ collection: c._id, count: c.n })),
      status: statusFacet[0] || { untranslated: 0, partial: 0, translated: 0 },
      queue: queueCounts,
    },
  });
});

type Action = 'queue' | 'defer' | 'already_translated' | 'clear';

export const POST = withEditorAuth(async (request: NextRequest, session) => {
  const body = await request.json().catch(() => null);
  const id = body?.id as string | undefined;
  const action = body?.action as Action | undefined;
  if (!id || !action) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  }

  const db = await getDb();
  const books = db.collection('books');
  const book = await books.findOne(
    { id },
    { projection: { id: 1, is_first_translation: 1, 'translation_verification.disposition': 1, translation_queue: 1 } },
  );
  if (!book) return NextResponse.json({ error: 'book not found' }, { status: 404 });

  const by = (session.user as { email?: string })?.email || 'unknown';
  const now = new Date();
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (action === 'queue') {
    const priority = [1, 2, 3].includes(Number(body.priority)) ? Number(body.priority) : 2;
    await books.updateOne({ id }, {
      $set: {
        translation_queue: { status: 'queued', priority, note, set_by: by, set_at: now },
      },
    });
    return NextResponse.json({ ok: true, status: 'queued', priority });
  }

  if (action === 'defer') {
    await books.updateOne({ id }, {
      $set: { translation_queue: { status: 'deferred', note, set_by: by, set_at: now } },
    });
    return NextResponse.json({ ok: true, status: 'deferred' });
  }

  if (action === 'already_translated') {
    // Consequential: a prior English translation exists, so this is NOT a
    // first-translation candidate. Flip the bibliographic flags, stashing the
    // prior values for undo via `clear`.
    const external = body.external_translation && typeof body.external_translation === 'object'
      ? body.external_translation
      : null;
    await books.updateOne({ id }, {
      $set: {
        translation_queue: {
          status: 'already_translated',
          note,
          external_translation: external,
          set_by: by,
          set_at: now,
          prior: {
            is_first_translation: book.is_first_translation ?? null,
            disposition: book.translation_verification?.disposition ?? null,
          },
        },
        is_first_translation: false,
        'translation_verification.disposition': 'translation_found',
        'translation_verification.disposition_reasoning':
          `Curator (${by}) marked already-translated${note ? `: ${note}` : ''}`,
        'translation_verification.disposition_at': now,
      },
    });
    return NextResponse.json({ ok: true, status: 'already_translated' });
  }

  if (action === 'clear') {
    const prior = book.translation_queue?.prior;
    const update: Record<string, unknown> = { $unset: { translation_queue: '' } };
    // Restore flags if we had flipped them when marking already_translated.
    if (prior) {
      update.$set = {
        is_first_translation: prior.is_first_translation ?? true,
        'translation_verification.disposition': prior.disposition ?? 'confirmed_first',
        'translation_verification.disposition_at': now,
      };
    }
    await books.updateOne({ id }, update);
    return NextResponse.json({ ok: true, status: 'cleared', restored: !!prior });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
});
