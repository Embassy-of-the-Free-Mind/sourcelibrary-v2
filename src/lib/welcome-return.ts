/**
 * Where to send a reader once they save or skip the /welcome form.
 *
 * WelcomeGate interrupts whatever they were doing and records the destination as
 * `?from=`. That value used to be recorded and then discarded — everyone landed
 * on '/'. Harmless for a fresh signup headed to the homepage anyway, and exactly
 * wrong for the ~3,850 existing readers now meeting this gate mid-journey: click
 * a link to a book, get pulled to /welcome, end up on the homepage with the book
 * lost.
 *
 * `from` is user-controlled — anyone can hand out /welcome?from=<anything> — so
 * it is validated as a same-origin path rather than trusted. Rejected:
 *   - anything not starting with '/' (absolute URLs, javascript:, mailto:)
 *   - protocol-relative '//host' and the '/\host' variant browsers also resolve
 *     off-site, which are the classic open-redirect payloads
 *   - /welcome itself, which would bounce the reader back into the form
 */
export function returnDestination(rawFrom: string | null | undefined): string {
  if (!rawFrom) return '/';

  let from: string;
  try {
    from = decodeURIComponent(rawFrom);
  } catch {
    return '/'; // malformed percent-encoding
  }

  from = from.trim();
  if (!from.startsWith('/')) return '/';
  // Backslashes are normalised to forward slashes by browsers in some contexts,
  // so '/\evil.com' and '/\\evil.com' must be rejected alongside '//evil.com'.
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  if (from === '/welcome' || from.startsWith('/welcome?') || from.startsWith('/welcome/')) return '/';

  return from;
}

/**
 * Where to send a signed-OUT visitor who lands on /welcome?from=<path>.
 *
 * /welcome requires a session, so it bounces to sign-in — and it used to bounce
 * to a bare `callbackUrl=/welcome`, dropping the destination on the floor. The
 * reader signed in and arrived at the homepage instead of the book they clicked,
 * which is the same lost-your-place failure `returnDestination` exists to prevent,
 * one step earlier in the funnel.
 *
 * `from` is validated here rather than passed through, so nothing unvalidated is
 * ever embedded in a redirect target — even though /welcome would validate it
 * again on the way out. NextAuth additionally screens callbackUrl itself (see the
 * redirect callback in src/lib/auth.ts).
 */
export function welcomeSignInUrl(rawFrom: string | null | undefined): string {
  const dest = returnDestination(rawFrom);
  const callback = dest === '/' ? '/welcome' : `/welcome?from=${encodeURIComponent(dest)}`;
  return `/auth/signin?callbackUrl=${encodeURIComponent(callback)}`;
}
