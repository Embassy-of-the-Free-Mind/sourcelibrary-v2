import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { logAuditEvent } from '@/lib/audit-logger';
import { withBphLibrarianAuth } from '@/lib/auth-helpers';

/**
 * POST /api/catalog/bph/[ubn]/edit
 *
 * BPH cataloguer panel write endpoint. Updates Supabase `bph_works` for the
 * given UBN with librarian-edited fields. Auth-gated to BPH-tenant editors
 * (or global admins) — see withBphLibrarianAuth.
 *
 * Atlas `books` is NOT touched. Surfacing edits back to the digitised
 * book document is a separate sync problem (see #1921 P3 / out-of-scope notes).
 *
 * Audit trail: writes to the Mongo `audit_log` collection via logAuditEvent,
 * with the per-field before/after diff and the actor email. We deliberately
 * reuse the existing audit pipeline instead of creating a new `bph_works_audit`
 * Supabase table for v1 — Mongo `audit_log` is already the canonical history
 * surface and we want one place to read from when auditing librarian edits.
 *
 * The resource being edited (`bph_works.ubn`) is BPH by definition, so the
 * tenant lockdown invariant is satisfied at the data layer — there's no path
 * by which this route could mutate another tenant's catalogue.
 *
 * See issue #1921 P2.
 */

export const dynamic = 'force-dynamic';

// Allowed librarian-editable fields. Anything else in the request body is
// silently dropped. Adding a new field requires (a) confirming the column
// exists in `bph_works`, (b) deciding the type contract, (c) adding it here.
const ALLOWED_FIELDS = [
  // Bibliographic identity
  'title',
  'parallel_title',
  'uniform_title',
  'author',
  'variant_author',
  'pseudonym',
  'editor',
  'variant_editor',
  // Impressum
  'place',
  'printer',
  'publisher',
  'variant_printer',
  'variant_publisher',
  'year',
  // Physical
  'bibliographic_format',
  'binding',
  'bound_with',
  'shelf_mark',
  'state_shelf_mark',
  'present_location',
  'object_size_cm',
  'number_of_copies',
  // Content
  'keywords',
  'language',
  'series_title',
  'volume_title',
  'bibliography',
  'remarks',
  'provenance',
] as const;
type EditableField = (typeof ALLOWED_FIELDS)[number];

const INTEGER_FIELDS = new Set<EditableField>(['year', 'number_of_copies']);

interface EditBody {
  [k: string]: unknown;
}

function coerceField(field: EditableField, raw: unknown): { ok: true; value: string | number | null } | { ok: false; reason: string } {
  // Treat undefined as "do not change" — caller filters first; here we only
  // see fields that were explicitly present in the request body.
  if (raw === null) return { ok: true, value: null };

  if (INTEGER_FIELDS.has(field)) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed === '') return { ok: true, value: null };
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, reason: `${field} must be an integer` };
      return { ok: true, value: n };
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { ok: false, reason: `${field} must be an integer` };
      return { ok: true, value: raw };
    }
    return { ok: false, reason: `${field} must be an integer or string` };
  }

  if (typeof raw !== 'string') return { ok: false, reason: `${field} must be a string` };
  const trimmed = raw.trim();
  // Empty string normalizes to NULL — easier for librarians who clear a field.
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

export const POST = withBphLibrarianAuth(async (request: NextRequest, session, context) => {
  const { ubn } = await context.params as { ubn: string };
  if (!ubn) {
    return NextResponse.json({ error: 'Missing ubn' }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Service unavailable — SUPABASE_SERVICE_ROLE_KEY not configured' },
      { status: 503 }
    );
  }

  let body: EditBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Fetch the existing row first (read via the anon client — same row that
  // the public catalogue page would show). 404 if it doesn't exist; we don't
  // create new bph_works rows from the editor.
  const existingFields = ALLOWED_FIELDS.join(', ');
  const { data: existing, error: fetchError } = await supabase
    .from('bph_works')
    .select(`ubn, ${existingFields}`)
    .eq('ubn', ubn)
    .maybeSingle();

  if (fetchError) {
    console.error('[bph-edit] Failed to fetch existing row:', fetchError);
    return NextResponse.json({ error: 'Failed to fetch existing record' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: `No BPH catalogue entry for UBN ${ubn}` }, { status: 404 });
  }

  // Build the update set + diff.
  const updates: Record<string, string | number | null> = {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  const existingRow = existing as unknown as Record<string, unknown>;
  for (const field of ALLOWED_FIELDS) {
    if (!(field in body)) continue;
    const result = coerceField(field, body[field]);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    const before = existingRow[field] ?? null;
    const after = result.value;
    // Skip no-ops so we don't pollute the audit trail.
    if (before === after) continue;
    // Treat null/empty-string equivalents as no-ops too.
    if ((before === null || before === '') && (after === null || after === '')) continue;
    updates[field] = after;
    changes[field] = { before, after };
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, updated: [], message: 'No changes' });
  }

  // Persist via the service-role client (anon writes are blocked by RLS).
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('bph_works')
    .update(updates)
    .eq('ubn', ubn)
    .select(`ubn, ${existingFields}`)
    .maybeSingle();

  if (updateError || !updated) {
    console.error('[bph-edit] Update failed:', updateError);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }

  // Audit trail (non-blocking). The book_id field is repurposed for the BPH
  // UBN here — see logAuditEvent comments; the field is typed string and the
  // history surfacing already handles non-Mongo ids.
  const actorEmail = session.user?.email || 'unknown';
  logAuditEvent({
    action: 'book_metadata_updated',
    book_id: `bph:${ubn}`,
    book_title: (existingRow.title as string | null | undefined) || undefined,
    actor: actorEmail,
    triggered_by: 'manual',
    metadata: {
      source: 'bph_cataloguer_panel',
      ubn,
      fields_changed: Object.keys(changes),
      changes,
    },
  });

  // Revalidate the catalogue detail pages (server-rendered, ISR-friendly).
  try {
    revalidatePath(`/embed/[tenant]/catalog/${ubn}`, 'page');
    revalidatePath(`/catalog/${ubn}`, 'page');
  } catch {
    // revalidatePath is best-effort; failures shouldn't fail the request.
  }

  return NextResponse.json({
    ok: true,
    ubn,
    updated: Object.keys(changes),
    work: updated,
  });
});
