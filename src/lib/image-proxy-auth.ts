/**
 * Internal-caller signatures for the image proxy (`/api/image`, `/api/crop-image`).
 *
 * The image gate (src/lib/image-gate.ts) budgets anonymous non-browser traffic,
 * but several of OUR OWN server-side consumers fetch /api/image over HTTP and
 * carry no browser headers, no session, and no API key — download exports
 * (src/lib/export-page-images.ts), auto-split, batch OCR crop URLs, and the
 * MCP thumbnail embedder. Without a way to recognize them, the gate would
 * throttle our own pipeline. They identify themselves with an HMAC token in
 * the URL itself (`itk=`), because at least one consumer (a URL handed to an
 * OCR worker) can only carry credentials in the URL, not in headers.
 *
 * The token signs ONLY the `url` query param (the source image), not the size
 * params — so one signed source stays CDN-cacheable across width variants and
 * internal callers can re-request at other sizes. Leaking a signed URL exposes
 * exactly one source image, which is public content anyway; the secret is not
 * recoverable from tokens.
 *
 * Node-only (node:crypto). Do not import from client components; server
 * consumers that might be bundled elsewhere should lazy-import (see
 * src/lib/api-client/images.ts).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

function signingSecret(): string {
  return (
    process.env.IMAGE_PROXY_SIGNING_SECRET ||
    process.env.CRON_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    ''
  );
}

/** Paths the signature scheme applies to. */
const SIGNABLE_PATHS = ['/api/image', '/api/crop-image'];

export function imageProxyToken(sourceUrlParam: string): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(sourceUrlParam).digest('hex').slice(0, 32);
}

/**
 * Append an `itk` token to an /api/image or /api/crop-image URL (absolute or
 * relative, own-host only). Any other URL — or a missing secret — returns the
 * input unchanged, so callers can apply this unconditionally.
 */
export function signImageProxyUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://sourcelibrary.org');
  } catch {
    return url;
  }
  if (!SIGNABLE_PATHS.includes(parsed.pathname)) return url;
  const host = parsed.hostname.toLowerCase();
  const ownHost =
    url.startsWith('/') ||
    host === 'sourcelibrary.org' ||
    host.endsWith('.sourcelibrary.org') ||
    host.endsWith('.vercel.app') ||
    host === 'localhost' ||
    host === '127.0.0.1';
  if (!ownHost) return url;
  if (parsed.searchParams.has('itk')) return url;
  const source = parsed.searchParams.get('url');
  if (!source) return url;
  const token = imageProxyToken(source);
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}itk=${token}`;
}

/** Verify an `itk` token against the request's `url` param. Timing-safe. */
export function verifyImageProxyToken(sourceUrlParam: string, token: string | null): boolean {
  if (!token) return false;
  const expected = imageProxyToken(sourceUrlParam);
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
