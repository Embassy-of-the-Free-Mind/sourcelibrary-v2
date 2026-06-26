/**
 * Cloudflare Turnstile — bot challenge for the magic-link sign-in path.
 *
 * Why only the magic-link path: a bot hitting `signIn('nodemailer')` in a loop
 * makes us send (and pay Resend for) a verification email per hit and spams real
 * inboxes whose addresses were guessed. Google OAuth needs a real Google account
 * per sign-up, so it carries its own friction and isn't fronted here.
 *
 * ENTIRELY opt-in. `turnstileEnabled()` is false unless BOTH keys are set, and
 * every caller no-ops when disabled — so with no keys the sign-in flow is
 * byte-for-byte unchanged. Enable by adding the two env vars (see below) and
 * testing on a preview deploy before flipping it on in production.
 *
 * Env:
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY  — public site key (client widget)
 *   TURNSTILE_SECRET_KEY            — secret key (server siteverify)
 * Create a widget at https://dash.cloudflare.com → Turnstile (free).
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The form field Cloudflare's widget injects, and the name we forward it under. */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

/** True only when both keys are configured — otherwise the feature is off. */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Verify a Turnstile token with Cloudflare. Returns true on success. Returns
 * true (fail-OPEN) when the feature is disabled so callers can guard with a
 * single check. Network/parse errors fail CLOSED (false) — when the feature is
 * deliberately on, an unverifiable token should not pass.
 */
export async function verifyTurnstile(token: string | null | undefined, ip?: string | null): Promise<boolean> {
  if (!turnstileEnabled()) return true; // feature off → nothing to verify
  if (!token) return false;

  try {
    const body = new URLSearchParams();
    body.set('secret', process.env.TURNSTILE_SECRET_KEY!);
    body.set('response', token);
    if (ip) body.set('remoteip', ip);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // fail closed when enabled
  }
}
