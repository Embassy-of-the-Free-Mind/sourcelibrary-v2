import { handlers } from '@/lib/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { verifyTurnstile, turnstileEnabled, TURNSTILE_FIELD } from '@/lib/turnstile';

export const GET = handlers.GET;

// Abuse guard for the magic-link send. POSTing to /signin/nodemailer makes us
// send (and pay Resend for) a verification email, so it's the cheap-to-abuse,
// real-cost endpoint in the auth flow. Two layers, both fail-open so a limiter
// or Cloudflare outage can never wall sign-in:
//   1. A SHARED per-IP rate limit (global across lambdas, unlike the in-memory
//      one) — caps email blasts even with Turnstile off.
//   2. Cloudflare Turnstile verification — only when keys are configured
//      (turnstileEnabled()); a complete no-op otherwise.
// Returns true if the request may proceed to NextAuth, or a Response to short-
// circuit with.
async function guardMagicLink(request: NextRequest): Promise<true | Response> {
  const ip = getClientIp(request);

  const rl = await checkRateLimitShared({ name: 'magic-link', limit: 5, windowSeconds: 3600 }, ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  if (turnstileEnabled()) {
    // Read the token off a clone so the original body stream stays intact for
    // NextAuth's own handler.
    let token: string | null = null;
    try {
      const form = await request.clone().formData();
      const v = form.get(TURNSTILE_FIELD);
      token = typeof v === 'string' ? v : null;
    } catch {
      token = null;
    }
    if (!(await verifyTurnstile(token, ip))) {
      return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 403 });
    }
  }

  return true;
}

// Wrap NextAuth's POST handler so signout also clears legacy host-only
// session cookies left behind by older deployments.
//
// Context: PR #1943 added `domain: .sourcelibrary.org` to the session cookie.
// Cookie name (`__Secure-authjs.session-token`) is unchanged, but the new
// Domain attribute makes the browser store it as a separate cookie from any
// host-only cookie of the same name. Users authenticated before #1943 ended
// up with TWO cookies: NextAuth's signOut() expires the domain-scoped one,
// the host-only one survives, and they appear perpetually signed in.
//
// On every /api/auth/signout response we append Set-Cookie headers that
// expire the host-only variants too. Safe to leave in indefinitely — it's
// a no-op for users who only have one cookie.
export async function POST(request: NextRequest) {
  // Guard the magic-link send before it reaches NextAuth (and before any email
  // is sent). Other auth POSTs (csrf, callbacks, Google, signout) pass through.
  if (request.nextUrl.pathname.endsWith('/signin/nodemailer')) {
    const guard = await guardMagicLink(request);
    if (guard !== true) return guard;
  }

  const response = await handlers.POST(request);

  if (request.nextUrl.pathname.endsWith('/signout')) {
    response.headers.append(
      'Set-Cookie',
      '__Secure-authjs.session-token=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
    );
    response.headers.append(
      'Set-Cookie',
      '__Secure-authjs.callback-url=; Path=/; Max-Age=0; Secure; SameSite=Lax',
    );
    // Older NextAuth v4 cookie names, just in case.
    response.headers.append(
      'Set-Cookie',
      '__Secure-next-auth.session-token=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
    );
    response.headers.append(
      'Set-Cookie',
      '__Secure-next-auth.callback-url=; Path=/; Max-Age=0; Secure; SameSite=Lax',
    );
  }

  return response;
}
