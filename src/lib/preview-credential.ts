/**
 * Does this request carry a REAL credential? Used by the preview-host content
 * gate in src/proxy.ts.
 *
 * PRIOR ART: src/lib/api-auth.ts requireApiAccess resolves the same three
 * identities, but it also rate-limits, logs and accepts same-origin/bot traffic.
 * The gate needs only "is this credential genuine", and must not let a forged
 * Origin header or a bot UA through, so this is the narrow form.
 *
 * Before this the gate only checked that a session cookie or an Authorization
 * header was PRESENT: `Authorization: Bearer x` lifted it and served whole books
 * from preview hosts to anyone (#7155). Each credential is now verified:
 *   - session cookie: decrypted with AUTH_SECRET (a forged one fails to decode)
 *   - Bearer CRON_SECRET: compared in constant time
 *   - Bearer API key: looked up as an active, unexpired key
 */
import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { decode } from 'next-auth/jwt';
import { validateApiKey } from '@/lib/dataset/api-keys';

const SESSION_COOKIES = ['__Secure-authjs.session-token', 'authjs.session-token'];

/** Auth.js splits a large cookie into `name.0`, `name.1`, ...; rejoin it. */
function readCookie(request: NextRequest, name: string): string | null {
  const whole = request.cookies.get(name)?.value;
  if (whole) return whole;
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const part = request.cookies.get(`${name}.${i}`)?.value;
    if (!part) break;
    chunks.push(part);
  }
  return chunks.length ? chunks.join('') : null;
}

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  for (const name of SESSION_COOKIES) {
    const token = readCookie(request, name);
    if (!token) continue;
    try {
      const payload = await decode({ token, secret, salt: name });
      if (payload && (!payload.exp || payload.exp * 1000 > Date.now())) return true;
    } catch {
      // Malformed or forged token: not a session.
    }
  }
  return false;
}

function isCronSecret(authHeader: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function hasVerifiedCredential(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    if (isCronSecret(authHeader)) return true;
    try {
      if (await validateApiKey(authHeader)) return true;
    } catch {
      // Key store unreachable: fail shut on preview hosts. Production readers
      // never reach this gate.
    }
  }
  return hasValidSession(request);
}
