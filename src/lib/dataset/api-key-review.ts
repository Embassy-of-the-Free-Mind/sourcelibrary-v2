/**
 * Approve or deny one pending API key request. Shared by the admin page's route
 * (/api/admin/api-key-requests) and the decision queue (/api/admin/decisions),
 * so a request is reviewed the same way from either door.
 *
 * PRIOR ART: src/app/api/admin/api-key-requests/route.ts — this is its POST
 * body moved here unchanged in effect, plus one fix: the request is claimed
 * with a single conditional update before the key is minted, so two reviewers
 * (the page and the queue) cannot mint two keys for one request.
 */
import { ObjectId, type Db } from 'mongodb';
import { generateApiKey } from './api-keys';
import { DATASET_TIERS, type DatasetTier } from './types';
import { sendApiKeyEmail } from '@/lib/membership-email';

export const KEY_REQUESTS_COLLECTION = 'api_key_requests';

export interface KeyRequestDoc {
  _id: ObjectId;
  name: string;
  email: string;
  organization: string | null;
  use_case: string;
  requested_tier: string;
  status: 'pending' | 'approving' | 'approved' | 'denied';
  created_at: Date;
}

export type ReviewResult =
  | { ok: true; status: 'denied' }
  | { ok: true; status: 'approved'; key: string; prefix: string; tier: DatasetTier; name: string; email: string; emailed: boolean }
  | { ok: false; code: 400 | 404; error: string };

export async function reviewKeyRequest(
  db: Db,
  requestId: string,
  action: 'approve' | 'deny',
  reviewedBy: string,
  opts: { tier?: DatasetTier; notes?: string | null } = {},
): Promise<ReviewResult> {
  if (!ObjectId.isValid(requestId)) return { ok: false, code: 400, error: 'Invalid request_id' };
  const _id = new ObjectId(requestId);
  const col = db.collection(KEY_REQUESTS_COLLECTION);
  const notes = opts.notes || null;

  if (action === 'deny') {
    const res = await col.updateOne(
      { _id, status: 'pending' },
      { $set: { status: 'denied', reviewed_at: new Date(), reviewed_by: reviewedBy, notes } },
    );
    if (!res.modifiedCount) return { ok: false, code: 404, error: 'Request not found or already reviewed' };
    return { ok: true, status: 'denied' };
  }

  const pending = await col.findOne({ _id, status: 'pending' }) as KeyRequestDoc | null;
  if (!pending) return { ok: false, code: 404, error: 'Request not found or already reviewed' };
  const tier = (opts.tier || pending.requested_tier || 'full') as DatasetTier;
  if (!DATASET_TIERS[tier]) return { ok: false, code: 400, error: `Invalid tier: ${tier}` };

  // Claim before minting: only one reviewer gets past this line per request.
  const claim = await col.updateOne({ _id, status: 'pending' }, { $set: { status: 'approving' } });
  if (!claim.modifiedCount) return { ok: false, code: 404, error: 'Request not found or already reviewed' };

  const name = pending.organization ? `${pending.name} · ${pending.organization}` : pending.name;
  let minted;
  try {
    minted = await generateApiKey(pending.email, tier, name);
  } catch (e) {
    await col.updateOne({ _id, status: 'approving' }, { $set: { status: 'pending' } });
    throw e;
  }
  await col.updateOne(
    { _id },
    {
      $set: {
        status: 'approved', reviewed_at: new Date(), reviewed_by: reviewedBy,
        approved_tier: tier, api_key_prefix: minted.doc.key_prefix, notes,
      },
    },
  );

  // The plaintext key exists only in this response and the email, so a failed
  // email is reported to the reviewer rather than swallowed.
  let emailed = Boolean(process.env.RESEND_API_KEY);
  if (emailed) {
    await sendApiKeyEmail(pending.email, pending.name, minted.key, DATASET_TIERS[tier].name).catch((err) => {
      console.error('[api-keys] Failed to send key email:', err);
      emailed = false;
    });
  }
  return { ok: true, status: 'approved', key: minted.key, prefix: minted.doc.key_prefix, tier, name, email: pending.email, emailed };
}
