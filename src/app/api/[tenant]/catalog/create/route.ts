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

/**
 * POST /api/[tenant]/catalog/create
 *
 * Create a brand-new BPH catalogue entry. Editor+ only — unlike the edit
 * endpoint there is no contributor "queue for review" path yet: a proposed
 * new record needs a UBN and a home before it can be reviewed, which is a
 * larger design. Contributors get a 403 with a clear message.
 *
 * Body:
 *   {
 *     ubn: string,                       // required — unique catalogue id
 *     fieldChanges: { <field>: { to }… },// at least `title` recommended
 *     note?: string
 *   }
 *
 * On success the new row is written via applyWorkRevision(changeType:'create'),
 * which records a `create` revision in the same append-only history every edit
 * lands in. Returns { ok, mode:'created', ubn, revisionId, appliedAt }.
 *
 * Sibling of the edit route; see ./[ubn]/edit/route.ts.
 */

const EDITABLE_SET = new Set<string>(EDITABLE_BPH_FIELDS);

/** Record types Memorix issues no UBN for. Mirrors TYPES_WITHOUT_UBN in the form. */
const UBN_OPTIONAL_TYPES = new Set(['manuscript', 'photocopy']);

interface CreatePayload {
  ubn?: string;
  fieldChanges?: Record<string, { to: unknown; source?: string; evidence?: string }>;
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

// A UBN must be a short, URL-safe token. We accept numeric BPH UBNs and our
// own `SL-…` ids, but reject slashes/whitespace/anything that would break the
// /catalog/<ubn> route or look like an injection.
function isValidUbn(ubn: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(ubn);
}

export const POST = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string }>);
    const { tenant } = params;

    if (tenant !== 'bph') {
      return NextResponse.json(
        { error: `Editor not available for tenant "${tenant}" yet` },
        { status: 404 },
      );
    }

    const userEmail = session.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: 'Session is missing an email — re-sign in' }, { status: 400 });
    }

    const platformRole = normalizeRole((session.user as { role?: unknown }).role);
    const role = await effectiveRole(userEmail, platformRole, tenant);
    if (ROLE_LEVEL[role] < ROLE_LEVEL['editor']) {
      return NextResponse.json(
        { error: 'Creating new records is limited to editors. Ask an editor (Paul or José) to add it, or to grant you editor access.' },
        { status: 403 },
      );
    }

    let payload: CreatePayload;
    try {
      payload = (await request.json()) as CreatePayload;
    } catch {
      return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 });
    }

    // Manuscripts and photographs have NO UBN — Memorix issues none, and the
    // BPH writes UBNs into the physical book by hand, so inventing one would
    // put a number in ink inside an object that is not supposed to carry one
    // (José Bouman, 2026-08-13). Those records are keyed by a minted uuid and
    // found by their manuscript number / shelf mark instead.
    const ubn = typeof payload.ubn === 'string' ? payload.ubn.trim() : '';
    if (ubn && !isValidUbn(ubn)) {
      return NextResponse.json(
        { error: 'UBN may only contain letters, numbers, dot, dash and underscore (no spaces or slashes)' },
        { status: 400 },
      );
    }
    const recordType = (payload.fieldChanges?.record_type?.to ?? null) as string | null;
    if (!ubn && !UBN_OPTIONAL_TYPES.has(recordType ?? '')) {
      return NextResponse.json(
        {
          error:
            'A UBN (catalogue id) is required for printed books. Set the record type to Manuscript or Photograph if this object has no UBN.',
        },
        { status: 400 },
      );
    }
    if (!ubn && !String(payload.fieldChanges?.shelf_mark?.to ?? '').trim()) {
      return NextResponse.json(
        { error: 'A record with no UBN needs a shelf mark (its manuscript number) — it is the only way to find the object.' },
        { status: 400 },
      );
    }
    // The key the revision hangs off. A uuid here makes applyWorkRevision write
    // the row with ubn = NULL; see src/lib/bph-catalog.ts.
    const key = ubn || crypto.randomUUID();

    const rawChanges = payload?.fieldChanges;
    if (!rawChanges || typeof rawChanges !== 'object' || Object.keys(rawChanges).length === 0) {
      return NextResponse.json(
        { error: 'Add at least one field (a title at minimum) before saving' },
        { status: 400 },
      );
    }

    const fieldChanges: FieldChangeMap = {};
    for (const [key, change] of Object.entries(rawChanges)) {
      if (!EDITABLE_SET.has(key)) {
        return NextResponse.json({ error: `Field "${key}" is not editable` }, { status: 400 });
      }
      if (!change || typeof change !== 'object' || !('to' in change)) {
        return NextResponse.json(
          { error: `fieldChanges["${key}"] must be an object with a "to" property` },
          { status: 400 },
        );
      }
      const to = (change as { to: unknown }).to;
      // Skip empty fields — a create payload may carry blanks for untouched
      // inputs; we only want the fields the cataloguer actually filled in.
      if (to === null || to === undefined || to === '') continue;
      (fieldChanges as Record<string, unknown>)[key] = {
        from: null,
        to,
        ...(typeof (change as { source?: unknown }).source === 'string'
          ? { source: (change as { source: string }).source }
          : {}),
        ...(typeof (change as { evidence?: unknown }).evidence === 'string'
          ? { evidence: (change as { evidence: string }).evidence }
          : {}),
      };
    }

    if (Object.keys(fieldChanges).length === 0) {
      return NextResponse.json(
        { error: 'Add at least one field (a title at minimum) before saving' },
        { status: 400 },
      );
    }

    try {
      const result = await applyWorkRevision({
        ubn: key,
        changeType: 'create',
        fieldChanges,
        editorEmail: userEmail,
        note: typeof payload.note === 'string' ? payload.note : null,
      });
      // `key` is what the record is addressable by; `ubn` stays for callers
      // that expect it and is empty for the no-UBN types.
      return NextResponse.json({ ok: true, mode: 'created', ubn, key, ...result });
    } catch (err) {
      if (err instanceof BphCatalogError) {
        const msg = err.message;
        const status = msg.includes('already exists') ? 409 : msg.includes('not editable') ? 400 : 500;
        return NextResponse.json({ error: msg }, { status });
      }
      console.error('[catalog/create] unexpected error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  },
  { minRole: 'editor' },
);
