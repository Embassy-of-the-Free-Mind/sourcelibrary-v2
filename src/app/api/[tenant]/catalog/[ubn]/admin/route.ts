import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import {
  BphCatalogError,
  changeWorkUbn,
  restoreWork,
  softDeleteWork,
} from '@/lib/bph-catalog';
import { isCatalogAdmin, normalizeCatalogRole } from '@/lib/catalog-role';

/**
 * POST /api/[tenant]/catalog/[ubn]/admin
 *
 * Catalogue-admin actions on one record. Only people with `catalog_admin` on
 * their tenant membership (José Bouman and Paul Dijstelberge for the BPH) or a
 * platform admin may call it; every BPH librarian is an `editor`, and editors
 * get a 403 here (#6799, #6800).
 *
 * Body, one of:
 *   { action: 'delete',     reason: string }
 *   { action: 'restore',    note?: string }
 *   { action: 'change_ubn', newUbn: string, note?: string }
 *
 * Delete is soft: the row stays and can be restored. See softDeleteWork().
 */

interface AdminPayload {
  action?: unknown;
  reason?: unknown;
  note?: unknown;
  newUbn?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const POST = withAuth(
  async (request: NextRequest, session, ctx) => {
    const { tenant, ubn } = await (ctx?.params as Promise<{ tenant: string; ubn: string }>);
    if (tenant !== 'bph') {
      return NextResponse.json({ error: `Not available for tenant "${tenant}"` }, { status: 404 });
    }
    // UBNs like "BPH 151" arrive percent-encoded (#2625).
    let key = ubn || '';
    try {
      key = decodeURIComponent(key);
    } catch {
      /* already decoded */
    }
    if (!key) return NextResponse.json({ error: 'Missing UBN' }, { status: 400 });

    const email = session.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'Session is missing an email. Please sign in again' }, { status: 400 });
    }
    const platformRole = normalizeCatalogRole((session.user as { role?: unknown }).role);
    if (!(await isCatalogAdmin(email, platformRole, tenant))) {
      return NextResponse.json(
        { error: 'Only catalogue administrators can delete records or change a UBN' },
        { status: 403 },
      );
    }

    let body: AdminPayload;
    try {
      body = (await request.json()) as AdminPayload;
    } catch {
      return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 });
    }

    try {
      switch (body.action) {
        case 'delete': {
          const r = await softDeleteWork({ key, editorEmail: email, reason: str(body.reason) });
          return NextResponse.json({ ok: true, action: 'delete', ...r });
        }
        case 'restore': {
          const r = await restoreWork({ key, editorEmail: email, note: str(body.note) });
          return NextResponse.json({ ok: true, action: 'restore', ...r });
        }
        case 'change_ubn': {
          const r = await changeWorkUbn({ key, newUbn: str(body.newUbn), editorEmail: email, note: str(body.note) });
          return NextResponse.json({ ok: true, action: 'change_ubn', ...r });
        }
        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }
    } catch (err) {
      if (err instanceof BphCatalogError) {
        // Database failures carry a cause; everything else is a refusal the
        // admin can act on (empty reason, UBN taken, already deleted…).
        const status = err.message.includes('not found') ? 404 : err.cause ? 500 : 400;
        if (status === 500) console.error('[catalog/admin]', err.message, err.cause);
        return NextResponse.json({ error: err.message }, { status });
      }
      console.error('[catalog/admin] unexpected error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  },
  { minRole: 'contributor' },
);
