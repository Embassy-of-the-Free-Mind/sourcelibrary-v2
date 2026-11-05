/**
 * Traced bulk copies (#8150 slice 8): a keyed, opaque account reference woven
 * into the readable colophon of DOWNLOADS and BULK TEXT fetched by a signed-in
 * account or an API key.
 *
 * PRIOR ART: src/lib/bot-attribution.ts — extractionRef (bots, by IP+UA+month),
 *   poolRef (proxy pools), keyRef (API keys, a readable prefix of the key id).
 *   They are kept exactly as they are. This adds the account case and an OPAQUE
 *   form for keys, behind a switch, and rides the same `ref` slot in
 *   provenance.ts colophon() rather than a new carrier.
 *
 * DARK BY DEFAULT. Nothing here does anything unless TRACED_COPIES=on. Terms
 * and sign-up must disclose it, and GDPR needs a qualified check, before
 * Derek switches it on (#8150 comment 6636416943). With the switch off every
 * route behaves exactly as before this file existed.
 *
 * What it never does, by construction:
 * - mark an anonymous reader (no account, no ref);
 * - mark normal signed-in READING: the reader pages and /api/pages are cached
 *   and identical for everyone, and never run inside runWithTraceRef;
 * - mark a single quote (the quote routes never run inside it either);
 * - say WHO: the ref is HMAC(PROVENANCE_SECRET_KEY, kind + id), so the public
 *   decoder can show that a signed reference exists and nothing more. Only a
 *   key holder resolves it (scripts/audit/decode-provenance.ts recomputes it
 *   over users._id and api_keys._id).
 *
 * The ref reaches markForExport through an AsyncLocalStorage scope instead of
 * a parameter threaded through every export generator (the download route is
 * ~2,800 lines with marks inside the EPUB, PDF and text builders). The PDF
 * builders start their writer synchronously inside the call, so the scope
 * carries into them.
 */
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

export type TraceKind = 'user' | 'key';

/** Read at call time so a test, or a later switch-on, takes effect without a reload. */
export function tracedCopiesEnabled(): boolean {
  return process.env.TRACED_COPIES === 'on' && Boolean(process.env.PROVENANCE_SECRET_KEY);
}

/** The opaque reference: `SLA-` + 10 hex of an HMAC. Same account, same ref. */
export function accountRefFor(kind: TraceKind, id: string, secret: string): string {
  const d = crypto.createHmac('sha256', secret).update(`account-ref:${kind}:${id}`).digest('hex');
  return `SLA-${d.slice(0, 10)}`;
}

/**
 * The ref for this caller, or undefined when the switch is off or there is no
 * account. An API key wins over a session (it is what a bulk client presents).
 */
export function traceRefFor(caller: { userId?: string | null; apiKeyId?: string | null }): string | undefined {
  if (!tracedCopiesEnabled()) return undefined;
  const secret = process.env.PROVENANCE_SECRET_KEY as string;
  if (caller.apiKeyId) return accountRefFor('key', String(caller.apiKeyId), secret);
  if (caller.userId) return accountRefFor('user', String(caller.userId), secret);
  return undefined;
}

const scope = new AsyncLocalStorage<string>();

/** Run `fn` so every markForExport inside it carries `ref`. No ref: runs `fn` as is. */
export function runWithTraceRef<T>(ref: string | undefined, fn: () => T): T {
  return ref ? scope.run(ref, fn) : fn();
}

/** The ref of the enclosing runWithTraceRef, if any. */
export function currentTraceRef(): string | undefined {
  return scope.getStore();
}

export const ACCOUNT_REF_PATTERN = /\bSLA-[0-9a-f]{10}\b/;
