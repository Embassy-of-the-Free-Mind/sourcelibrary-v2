/**
 * Proof that a request comes from our own hosted MCP server (#4357).
 *
 * PRIOR ART: src/lib/citation-token.ts (a keyed HMAC of AUTH_SECRET, same
 * shape) and src/lib/inprocess-caller.ts (which proves the in-process calls
 * but cannot reach the ones /api/mcp still makes over HTTP). Neither covers a
 * self-call over the wire, which is what this adds.
 *
 * The page wall used to trust the user agent "SourceLibrary-MCP" on its own,
 * so anyone could write that name in a header and read every page of every
 * book. The hosted server now sends this header with its HTTP self-calls; the
 * wall honours the name only with the header (or for an in-process call).
 *
 * The npm package (mcp-server/) runs on the user's own machine and holds no
 * secret, so it cannot prove itself and is treated like any anonymous caller.
 *
 * Server-only (node crypto + a server secret).
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const MCP_PROOF_HEADER = 'x-sl-mcp-proof';

function secret(): string | null {
  // No fallback value: with no secret we mint nothing and verify nothing.
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

/** The header value the hosted MCP server sends, or null when no secret is set. */
export function mintMcpProof(): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac('sha256', key).update('sourcelibrary-mcp-self-call').digest('hex');
}

/** Does this request carry a valid proof that it came from our hosted MCP server? */
export function hasMcpProof(request: Request): boolean {
  const sent = request.headers.get(MCP_PROOF_HEADER);
  if (!sent || !/^[0-9a-f]{64}$/.test(sent)) return false;
  const expected = mintMcpProof();
  if (!expected) return false;
  try {
    return timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  } catch {
    return false;
  }
}
