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

import type { NextRequest } from 'next/server';
import type { Db } from 'mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import { hasVerifiedCredential } from '@/lib/preview-credential';
import { hasForgedChromeHints } from '@/lib/client-hint-gate';
import { provableClaimIn, verifyCrawlerClaim } from '@/lib/crawler-verify';
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

/** The Embassy's reading surfaces: its subdomain, its embed, its tenant API. */
export function isProtectedSurface(host: string, pathname: string): boolean {
  if (!partnerGateEnforced()) return false;
  const h = host.toLowerCase().split(':')[0];
  // A deployment calling itself (pipeline/step) carries no user agent worth the name.
  if (h === process.env.VERCEL_URL?.toLowerCase()) return false;
  if (h === 'bph.sourcelibrary.org') return true;
  return pathname === '/embed/bph' || pathname.startsWith('/embed/bph/') || pathname.startsWith('/api/bph/');
}

// Anchored on the start of the string: these are what plain HTTP libraries send
// unasked. Nothing a person's browser sends, nor a social card or search crawler.
const SCRIPT_UA = /^(?:$|curl\/|wget\/|python|pycurl|aiohttp|httpx|scrapy|node(?:-fetch|\/|$)|undici|axios|got[ /(]|deno\/|bun\/|go-http-client|java\/|apache-httpclient|okhttp|php|guzzlehttp|ruby|perl|libwww|lwp|httpie|reqwest|dart|colly|mozilla\/5\.0$|mozilla\/5\.0 \(compatible; crawler\)$)/i;

/** A client that says, or by saying nothing shows, it is a plain HTTP library. */
export function isDeclaredScript(userAgent: string): boolean {
  return SCRIPT_UA.test(userAgent.trim());
}

export type SurfaceRefusal = 'forged-browser' | 'script' | 'forged-crawler';

/**
 * Why a request has no business on a protected surface, or null. Checks only the
 * headers and, for a crawler's name, reverse DNS; a caller holding a credential is
 * for the proxy to pass, after this says something, so readers pay nothing for it.
 * An inconclusive DNS answer is never a refusal: real crawlers keep the index.
 */
export async function surfaceRefusal(headers: Headers, clientIp: string): Promise<SurfaceRefusal | null> {
  if (hasForgedChromeHints(headers)) return 'forged-browser';
  const ua = headers.get('user-agent') || '';
  if (isDeclaredScript(ua)) return 'script';
  const claim = provableClaimIn(ua);
  if (claim && (await verifyCrawlerClaim(claim, clientIp)) === 'forged') return 'forged-crawler';
  return null;
}

export const SURFACE_REFUSED_RESPONSE =
  'This collection is open to readers in a web browser, and to search engines. Programs that copy it need an agreement.\n'
  + 'Bulk or programmatic access: https://sourcelibrary.org/developers\n'
  + 'A reader refused by mistake: team@sourcelibrary.org\n';

/**
 * The apex page APIs carry no tenant in their path, so the proxy cannot tell a
 * partner's page from any other. True when a plain HTTP library is asking for
 * pages of a protected partner's book and shows no credential. Everyone else pays
 * one regular expression.
 */
export async function isScriptOnPartnerPages(
  request: NextRequest,
  db: Db,
  pages: ReadonlyArray<Record<string, unknown>>,
): Promise<boolean> {
  if (!partnerGateEnforced() || !isDeclaredScript(request.headers.get('user-agent') || '')) return false;
  const bookIds = [...new Set(pages.map((p) => p.book_id).filter((id): id is string => typeof id === 'string'))];
  if (!bookIds.length) return false;
  const owners = await db.collection('books')
    .find({ id: { $in: bookIds } }, { projection: { _id: 0, tenantId: 1 } })
    .toArray();
  for (const book of owners) {
    if (await isProtectedPartnerBook(book)) return !(await hasVerifiedCredential(request));
  }
  return false;
}
