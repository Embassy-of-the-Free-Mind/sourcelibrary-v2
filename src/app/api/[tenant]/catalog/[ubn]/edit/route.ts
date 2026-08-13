import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import {
  applyWorkRevision,
  EDITABLE_BPH_FIELDS,
  BphCatalogError,
  type FieldChangeMap,
} from '@/lib/bph-catalog';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';
import { catalogKeyColumn } from '@/lib/bph-catalog-key';

/**
 * POST /api/[tenant]/catalog/[ubn]/edit
 *
 * Catalog mutation endpoint. Role-branched at runtime:
 *
 *   editor+      → apply directly via applyWorkRevision (writes the revision
 *                  row + updates bph_works + best-effort Atlas mirror).
 *   contributor  → queue a row in bph_works_pending_changes for editor review.
 *                  bph_works is untouched; response carries the pending_id.
 *
 * Body shape (identical in both modes):
 *
 *   {
 *     fieldChanges: { <field>: { to: <value>, source?: string, evidence?: string }, … },
 *     note?: string
 *   }
 *
 * Both flows store the same field_changes JSONB so the review UI renders
 * the same diff regardless of which mode produced the record.
 *
 * Phase 1 — issue #1877.
 */

const EDITABLE_SET = new Set<string>(EDITABLE_BPH_FIELDS);

interface EditPayload {
  fieldChanges?: Record<string, { to: unknown; source?: string; evidence?: string; from?: unknown }>;
  note?: string;
}

function normalizeRole(role: unknown): Role {
  if (
    role === 'superadmin' ||
    role === 'admin' ||
    role === 'editor' ||
    role === 'contributor' ||
    role === 'reader'
  ) {
    return role;
  }
  if (role === 'inner_circle' || role === 'curator') return 'editor';
  return 'reader';
}

async function effectiveRole(email: string | null | undefined, platformRole: Role, tenantSlug: string): Promise<Role> {
  if (!email) return platformRole;
  if (ROLE_LEVEL[platformRole] >= ROLE_LEVEL['editor']) return platformRole;
  try {
    const db = await getDb();
    const tenant = await db.collection('tenants').findOne({ slug: tenantSlug, status: { $ne: 'deleted' } });
    if (!tenant) return platformRole;
    const m = await db.collection('memberships').findOne({
      email: email.toLowerCase(),
      tenantId: tenant.id,
      status: 'active',
    });
    const r = normalizeRole(m?.role);
    return ROLE_LEVEL[r] >= ROLE_LEVEL[platformRole] ? r : platformRole;
  } catch {
    return platformRole;
  }
}

export const POST = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string; ubn: string }>);
    const { tenant, ubn } = params;

    if (tenant !== 'bph') {
      return NextResponse.json(
        { error: `Editor not available for tenant "${tenant}" yet` },
        { status: 404 },
      );
    }
    if (!ubn) {
      return NextResponse.json({ error: 'Missing UBN' }, { status: 400 });
    }

    const userEmail = session.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: 'Session is missing an email — re-sign in' }, { status: 400 });
    }
    const userId = (session.user as { id?: string }).id ?? null;

    let payload: EditPayload;
    try {
      payload = (await request.json()) as EditPayload;
    } catch {
      return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 });
    }

    const rawChanges = payload?.fieldChanges;
    if (!rawChanges || typeof rawChanges !== 'object' || Object.keys(rawChanges).length === 0) {
      return NextResponse.json({ error: 'fieldChanges is required and must be non-empty' }, { status: 400 });
    }

    // Build the typed FieldChangeMap that applyWorkRevision expects. The
    // helper already whitelists keys, but we validate here too so we can
    // return a precise 400 instead of bubbling the BphCatalogError up as a
    // 500. Two layers of validation are cheap and keep the API honest.
    const fieldChanges: FieldChangeMap = {};
    for (const [key, change] of Object.entries(rawChanges)) {
      if (!EDITABLE_SET.has(key)) {
        return NextResponse.json(
          { error: `Field "${key}" is not editable` },
          { status: 400 },
        );
      }
      if (!change || typeof change !== 'object' || !('to' in change)) {
        return NextResponse.json(
          { error: `fieldChanges["${key}"] must be an object with a "to" property` },
          { status: 400 },
        );
      }
      (fieldChanges as Record<string, unknown>)[key] = {
        from: null, // ignored by applyWorkRevision — it reads the live row
        to: (change as { to: unknown }).to,
        ...(typeof (change as { source?: unknown }).source === 'string'
          ? { source: (change as { source: string }).source }
          : {}),
        ...(typeof (change as { evidence?: unknown }).evidence === 'string'
          ? { evidence: (change as { evidence: string }).evidence }
          : {}),
      };
    }

    // Decide whether to apply directly or queue for review.
    const platformRole = normalizeRole((session.user as { role?: unknown }).role);
    const role = await effectiveRole(userEmail, platformRole, tenant);

    if (ROLE_LEVEL[role] >= ROLE_LEVEL['editor']) {
      try {
        const result = await applyWorkRevision({
          ubn,
          changeType: 'edit',
          fieldChanges,
          editorEmail: userEmail,
          note: typeof payload.note === 'string' ? payload.note : null,
        });
        return NextResponse.json({ ok: true, mode: 'applied', ...result });
      } catch (err) {
        if (err instanceof BphCatalogError) {
          const msg = err.message;
          const status =
            msg.includes('not editable') || msg.includes('not found') || msg.includes('empty')
              ? 400
              : 500;
          return NextResponse.json({ error: msg }, { status });
        }
        console.error('[catalog/edit] unexpected error:', err);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
      }
    }

    // Contributor path: queue a pending row. bph_works is untouched.
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'supabaseAdmin not configured — SUPABASE_SERVICE_ROLE_KEY missing' },
        { status: 500 },
      );
    }
    // Key the proposal the same way a revision is keyed: by UBN when the record
    // has one, by uuid for the 2,012 that don't. Both columns carry a FK to
    // bph_works, so putting a uuid in `ubn` would be rejected outright.
    // work_uuid is only sent when it is actually needed, so a ubn-keyed
    // proposal still inserts cleanly on an environment where
    // add-bph-uuid-keyed-revisions.sql hasn't been applied yet.
    const pendingKey = catalogKeyColumn(ubn) === 'uuid' ? { ubn: null, work_uuid: ubn } : { ubn };
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('bph_works_pending_changes')
      .insert({
        ...pendingKey,
        change_type: 'edit',
        proposer_email: userEmail,
        proposer_user_id: userId,
        field_changes: fieldChanges,
        note: typeof payload.note === 'string' ? payload.note : null,
        status: 'pending',
      })
      .select('id, created_at')
      .single();

    if (insertErr || !inserted) {
      console.error('[catalog/edit] pending insert failed:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message || 'Failed to queue change for review' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      mode: 'queued',
      pendingId: (inserted as { id: string }).id,
      createdAt: (inserted as { created_at: string }).created_at,
    });
  },
  { minRole: 'contributor' },
);
