/**
 * How much of a partner's book one call of the text export hands over (#8098).
 *
 * PRIOR ART: src/lib/bot-gate.ts — the site-wide gate, keyed on names a client
 * chooses; this adds the partner rung, which also covers clients naming nothing.
 * src/lib/image-gate.ts isBrowserShapedImageRequest — asks the narrower question
 * of an image load (a Sec-Fetch-Dest value, or our own Referer).
 *
 * The Embassy's collection stays open to readers and to search. What it stops
 * being is a single download for anything that is not reading. Browser-shaped
 * means fetch metadata, which every engine has sent since Safari 16.4. This raises
 * the cost of bulk copying and is not a boundary. The daily page budget still
 * applies to everybody it applied to before.
 *
 * Switch: BPH_BOT_GATE_ENFORCE=0 puts every partner book back on the site rules.
 */

import { resolveTenantId } from '@/lib/tenant-context';
import type { ApiIdentity } from '@/lib/api-auth';

/** Tenants whose collections the rungs below protect. */
const PROTECTED_TENANT_SLUGS = ['bph'] as const;

/** Most pages one call returns to a client that says it reads for a person. */
export const ASSISTANT_PAGE_WINDOW = 25;

/** Claims of reading on someone's behalf, or of indexing for answers. A name, not a proof. */
const ASSISTANT_CLAIMS = [
  'claude-user', 'chatgpt-user', 'perplexity-user',
  'claude-searchbot', 'oai-searchbot',
  'sourcelibrary-mcp',
];

/** The crawlers api-auth proves by reverse DNS; any other `bot` identity is only a name. */
const PROVEN_CRAWLERS = new Set(['googlebot', 'bingbot', 'msnbot', 'applebot']);

export function partnerGateEnforced(): boolean {
  return process.env.BPH_BOT_GATE_ENFORCE !== '0';
}

/** True when the book belongs to a protected tenant and the gate is on. */
export async function isProtectedPartnerBook(book: object): Promise<boolean> {
  if (!partnerGateEnforced()) return false;
  const owner = (book as { tenantId?: string | null }).tenantId;
  if (!owner) return false;
  for (const slug of PROTECTED_TENANT_SLUGS) {
    if ((await resolveTenantId(slug)) === owner) return true;
  }
  return false;
}

/** A browser engine says what it is fetching; plain HTTP clients say nothing. */
export function isBrowserShaped(headers: Headers): boolean {
  const ua = headers.get('user-agent') || '';
  return ua.startsWith('Mozilla/') && !!(headers.get('sec-fetch-mode') || headers.get('sec-fetch-site'));
}

export type PartnerTextAccess =
  | { kind: 'full' }
  | { kind: 'window'; pages: number }
  | { kind: 'preview' };

/**
 * The rung for one caller of a protected book. Credentials first, so an editor,
 * a key holder or a proven crawler never depends on what its headers look like.
 * The pipeline's own secret is the caller's to check: this module stays free of
 * the session stack, so the proxy can use it too.
 */
export function partnerTextAccess(request: Request, identity: ApiIdentity, declaredBot: boolean): PartnerTextAccess {
  if (identity.kind === 'session' || identity.kind === 'apikey') return { kind: 'full' };
  if (identity.kind === 'bot' && identity.bot && PROVEN_CRAWLERS.has(identity.bot)) return { kind: 'full' };

  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (ASSISTANT_CLAIMS.some((claim) => ua.includes(claim))) {
    return { kind: 'window', pages: ASSISTANT_PAGE_WINDOW };
  }
  if (!declaredBot && isBrowserShaped(request.headers)) return { kind: 'full' };
  return { kind: 'preview' };
}
