import { handlers } from '@/lib/auth';
import type { NextRequest } from 'next/server';

export const GET = handlers.GET;

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
