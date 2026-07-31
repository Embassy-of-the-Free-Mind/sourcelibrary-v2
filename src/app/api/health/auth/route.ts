import { NextRequest, NextResponse } from 'next/server';
import { getDb, forceReconnect } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { retryWithBackoff, recordFailureStreaks, clearFailureStreaks } from '@/lib/health-alerting';

export const dynamic = 'force-dynamic';
// Raised from 15s to cover the in-probe retry backoff added below. A clean run
// still finishes in ~1s; only a failing run spends the extra budget.
export const maxDuration = 25;

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'derek@sourcelibrary.org';
const COOLDOWN_MS = 60 * 60 * 1000; // 1 alert per hour max
const ALERT_STATE_KEY = 'auth_alert_state';

/**
 * Consecutive failed probes required before paging. The probe runs every 10
 * minutes, so a real outage is still reported within ~20 minutes, while a
 * single transient fault (the 2026-07-31 Atlas TLS drop) stays silent.
 */
const CONSECUTIVE_FAILURES_TO_ALERT = 2;

interface AuthCheck {
  provider: string;
  status: 'ok' | 'error';
  detail?: string;
}

/**
 * GET /api/health/auth — checks that all auth providers are functional.
 * Tests the actual OAuth/email flows would succeed, not just that env vars exist.
 * Called by Hetzner cron every 10 minutes. Alerts via Resend on failure.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const checks: AuthCheck[] = [];

  // 1. Google OAuth — test that OIDC discovery + client config works
  const googleOk = await checkGoogleOAuth();
  checks.push(googleOk);

  // 2. Email provider — test that Resend API key is valid
  const emailOk = await checkEmailProvider();
  checks.push(emailOk);

  // 3. AUTH_SECRET — must exist for JWT sessions
  if (!process.env.AUTH_SECRET) {
    checks.push({ provider: 'session', status: 'error', detail: 'AUTH_SECRET is missing' });
  } else {
    checks.push({ provider: 'session', status: 'ok' });
  }

  // 4. MongoDB adapter — test users collection is accessible
  const dbOk = await checkMongoAdapter();
  checks.push(dbOk);

  const failures = checks.filter(c => c.status === 'error');
  const status = failures.length === 0 ? 'healthy' : 'broken';

  // A single failed probe is not evidence that users cannot sign in — it is far
  // more often evidence that the probe's own connection blipped. Page only once
  // the SAME provider has failed on consecutive probes.
  let streak: Awaited<ReturnType<typeof recordFailureStreaks>> | null = null;
  const streakDb = await getStreakDb();

  if (failures.length > 0) {
    streak = await recordFailureStreaks(
      streakDb,
      ALERT_STATE_KEY,
      failures.map(f => f.provider),
      CONSECUTIVE_FAILURES_TO_ALERT
    );
    const confirmed = failures.filter(f => streak!.confirmed.includes(f.provider));
    if (confirmed.length > 0) {
      await sendAuthAlert(confirmed, streak);
    }
  } else {
    await clearFailureStreaks(streakDb, ALERT_STATE_KEY);
  }

  return NextResponse.json(
    {
      status,
      checks,
      // Surfaced so the cron log distinguishes "first failure, watching" from
      // "confirmed, paged" without opening the mailbox.
      ...(streak ? { alerted: streak.confirmed.length > 0, streaks: streak.streaks } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: failures.length > 0 ? 503 : 200 }
  );
}

/**
 * Db handle for the streak store. Returns null when Atlas is genuinely
 * unreachable, which `recordFailureStreaks` treats as "alert now" — a total DB
 * outage is exactly the case that should page on the first probe.
 */
async function getStreakDb() {
  try {
    return await getDb();
  } catch {
    return null;
  }
}

async function checkGoogleOAuth(): Promise<AuthCheck> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return { provider: 'google', status: 'error', detail: 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing' };
  }

  try {
    // Test OIDC discovery — this is what NextAuth does at sign-in time
    const res = await fetch('https://accounts.google.com/.well-known/openid-configuration', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { provider: 'google', status: 'error', detail: `OIDC discovery returned ${res.status}` };
    }
    const config = await res.json();

    // Validate the client ID by hitting the token endpoint with a dummy request
    // A valid client gets "invalid_grant", an invalid client gets "invalid_client"
    const tokenEndpoint = config.token_endpoint;
    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'health_check_dummy',
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://sourcelibrary.org/api/auth/callback/google',
      }),
      signal: AbortSignal.timeout(5000),
    });

    const tokenBody = await tokenRes.json();

    // "invalid_grant" means credentials are valid but code is fake (expected)
    // "invalid_client" means the OAuth client is broken/deleted
    // "unauthorized_client" means the client exists but redirect URI is wrong
    if (tokenBody.error === 'invalid_client') {
      return { provider: 'google', status: 'error', detail: 'OAuth client ID/secret are invalid or deleted' };
    }
    if (tokenBody.error === 'redirect_uri_mismatch') {
      return { provider: 'google', status: 'error', detail: 'Redirect URI not authorized in Google Cloud Console' };
    }

    // Any other error (invalid_grant, invalid_request) means the client itself is fine
    return { provider: 'google', status: 'ok' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider: 'google', status: 'error', detail: `OIDC check failed: ${msg}` };
  }
}

async function checkEmailProvider(): Promise<AuthCheck> {
  if (!process.env.RESEND_API_KEY) {
    return { provider: 'email', status: 'error', detail: 'RESEND_API_KEY missing' };
  }

  // Retry transient network errors WITH BACKOFF: the api.resend.com probe
  // occasionally exceeds the 5s budget even though real `resend.emails.send`
  // calls during sign-in are unaffected. Back-to-back retries with no delay
  // (the previous behaviour) are defeated by any fault lasting a second or two.
  try {
    return await retryWithBackoff(async () => {
      // Validate API key by fetching domains (lightweight, no side effects)
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      // A definitive answer from Resend is not worth retrying — return it as-is.
      if (res.status === 401 || res.status === 403) {
        return { provider: 'email', status: 'error', detail: 'RESEND_API_KEY is invalid' } as AuthCheck;
      }
      if (!res.ok) {
        return { provider: 'email', status: 'error', detail: `Resend API returned ${res.status}` } as AuthCheck;
      }
      return { provider: 'email', status: 'ok' } as AuthCheck;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider: 'email', status: 'error', detail: `Resend check failed (after retries): ${msg}` };
  }
}

async function checkMongoAdapter(): Promise<AuthCheck> {
  // Retry with forced reconnect AND backoff: Atlas TLS handshakes occasionally
  // drop ("Client network socket disconnected before secure TLS connection was
  // established"), most often when a pile of cold functions dial out at once.
  // The MongoDB client recovers transparently for user requests. The previous
  // version retried immediately, which is why a single ~2s fault on 2026-07-31
  // exhausted both attempts and paged a "sign-in is broken" email while users
  // were signing in normally.
  try {
    const count = await retryWithBackoff(
      async attempt => {
        const db = attempt === 0 ? await getDb() : await forceReconnect();
        return db.collection('users').estimatedDocumentCount({ maxTimeMS: 5000 } as any);
      }
    );
    if (count === 0) {
      return { provider: 'database', status: 'error', detail: 'Users collection is empty' };
    }
    return { provider: 'database', status: 'ok' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { provider: 'database', status: 'error', detail: `MongoDB check failed (after retries): ${msg}` };
  }
}

async function sendAuthAlert(
  failures: AuthCheck[],
  streak: Awaited<ReturnType<typeof recordFailureStreaks>>
) {
  if (!process.env.RESEND_API_KEY) return;

  // Cooldown check
  try {
    const db = await getDb();
    const state = await db.collection('system_config').findOne(
      { _id: ALERT_STATE_KEY as any },
      { maxTimeMS: 5000 } as any
    );
    if (state?.last_sent_at) {
      const elapsed = Date.now() - new Date(state.last_sent_at).getTime();
      if (elapsed < COOLDOWN_MS) return;
    }
  } catch {
    // Send anyway if DB is down
  }

  const failureRows = failures
    .map(f => `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">${f.provider}</td><td style="padding:8px;border:1px solid #ddd;color:#c0392b">${f.detail}</td><td style="padding:8px;border:1px solid #ddd;text-align:center">${streak.streaks[f.provider] ?? 1}</td></tr>`)
    .join('\n');

  // Say what was actually observed. The old copy asserted "Users cannot sign in"
  // off a single probe; on 2026-07-31 that was false — accounts were being
  // created while the email sat in the inbox.
  const confidence = streak.storeUnavailable
    ? 'The streak store was unreachable, so this fired on the first failed probe — Atlas itself is likely down.'
    : `Failing on ${CONSECUTIVE_FAILURES_TO_ALERT}+ consecutive probes (10 min apart), so this is not a transient blip.`;

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="color:#c0392b;margin:0 0 16px">Auth provider check is failing</h2>
      <p style="color:#333;margin:0 0 8px">
        Sign-in on Source Library may be affected. These providers failed their health probe:
      </p>
      <p style="color:#666;font-size:13px;margin:0 0 16px">${confidence}</p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 16px">
        <tr style="background:#f5f5f5"><th style="padding:8px;border:1px solid #ddd;text-align:left">Provider</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Error</th><th style="padding:8px;border:1px solid #ddd">Probes</th></tr>
        ${failureRows}
      </table>
      <p style="color:#666;font-size:13px">
        Confirm real user impact before treating this as an outage — check for recent
        account creations and sign-in links, not just this probe.
      </p>
      <p style="color:#666;font-size:13px">
        Check: <a href="https://sourcelibrary.org/api/health/auth">health/auth endpoint</a> |
        <a href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</a>
      </p>
      <p style="color:#999;font-size:12px;margin-top:24px">Alerts are rate-limited to 1 per hour.</p>
    </div>
  `;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Source Library <noreply@sourcelibrary.org>',
      to: ALERT_EMAIL,
      subject: `[CRITICAL] Source Library auth check failing: ${failures.map(f => f.provider).join(', ')}`,
      html,
    });

    // Record cooldown
    try {
      const db = await getDb();
      await db.collection('system_config').updateOne(
        { _id: ALERT_STATE_KEY as any },
        { $set: { last_sent_at: new Date(), failures } },
        { upsert: true }
      );
    } catch {
      // Non-fatal
    }
  } catch (e) {
    console.error('[health/auth] Failed to send alert:', e);
  }
}
