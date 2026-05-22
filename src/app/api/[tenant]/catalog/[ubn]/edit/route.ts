import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import {
  applyWorkRevision,
  EDITABLE_BPH_FIELDS,
  BphCatalogError,
  type FieldChangeMap,
} from '@/lib/bph-catalog';

/**
 * POST /api/[tenant]/catalog/[ubn]/edit
 *
 * Editor-only mutation endpoint for BPH catalogue entries. Body shape:
 *
 *   {
 *     fieldChanges: { <field>: { to: <value>, source?: string, evidence?: string }, … },
 *     note?: string
 *   }
 *
 * Calls applyWorkRevision (src/lib/bph-catalog.ts), which writes the revision
 * row first, then updates bph_works in one statement, then best-effort mirrors
 * the curated subset to Atlas books. Returns the revisionId so the client can
 * link to the history entry if needed.
 *
 * Phase 1 is editor-only. PR-D extends the same endpoint to contributors
 * by routing them through the pending-changes flow instead of applying
 * directly — see issue #1877.
 */

const EDITABLE_SET = new Set<string>(EDITABLE_BPH_FIELDS);

interface EditPayload {
  fieldChanges?: Record<string, { to: unknown; source?: string; evidence?: string; from?: unknown }>;
  note?: string;
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

    const editorEmail = session.user?.email;
    if (!editorEmail) {
      return NextResponse.json({ error: 'Session is missing an email — re-sign in' }, { status: 400 });
    }

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

    try {
      const result = await applyWorkRevision({
        ubn,
        changeType: 'edit',
        fieldChanges,
        editorEmail,
        note: typeof payload.note === 'string' ? payload.note : null,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof BphCatalogError) {
        // Field whitelist / not-found / empty changes — surface as 400.
        // Mid-flight failures (revision written but update failed) also
        // throw — surface as 500 so monitoring picks them up.
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
  },
  { minRole: 'editor' },
);
