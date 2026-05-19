import { NextResponse } from 'next/server';
import { getDb, forceReconnect } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'derek@sourcelibrary.org';
const COOLDOWN_MS = 60 * 60 * 1000; // 1 alert per hour max

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
export async function GET() {
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

  // Alert if any provider is broken
  if (failures.length > 0) {
    await sendAuthAlert(failures);
  }

  return NextResponse.json(
    { status, checks, timestamp: new Date().toISOString() },
    { status: failures.length > 0 ? 503 : 200 }
  );
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

  // One retry on transient network errors: the api.resend.com probe occasionally
  // exceeds the 5s budget even though real `resend.emails.send` calls during
  // sign-in are unaffected. A single failed probe should not page Derek.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Validate API key by fetching domains (lightweight, no side effects)
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401 || res.status === 403) {
        return { provider: 'email', status: 'error', detail: 'RESEND_API_KEY is invalid' };
      }
      if (!res.ok) {
        return { provider: 'email', status: 'error', detail: `Resend API returned ${res.status}` };
      }
      return { provider: 'email', status: 'ok' };
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { provider: 'email', status: 'error', detail: `Resend check failed (after retry): ${msg}` };
}

async function checkMongoAdapter(): Promise<AuthCheck> {
  // One retry with forced reconnect: Atlas TLS handshakes occasionally drop
  // ("Client network socket disconnected before secure TLS connection was established").
  // The MongoDB client recovers transparently for user requests, so a single failed
  // probe should not page Derek.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const db = attempt === 0 ? await getDb() : await forceReconnect();
      const count = await db.collection('users').estimatedDocumentCount({ maxTimeMS: 5000 } as any);
      if (count === 0) {
        return { provider: 'database', status: 'error', detail: 'Users collection is empty' };
      }
      return { provider: 'database', status: 'ok' };
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { provider: 'database', status: 'error', detail: `MongoDB check failed (after retry): ${msg}` };
}

async function sendAuthAlert(failures: AuthCheck[]) {
  if (!process.env.RESEND_API_KEY) return;

  // Cooldown check
  try {
    const db = await getDb();
    const state = await db.collection('system_config').findOne(
      { _id: 'auth_alert_state' as any },
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
    .map(f => `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">${f.provider}</td><td style="padding:8px;border:1px solid #ddd;color:#c0392b">${f.detail}</td></tr>`)
    .join('\n');

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="color:#c0392b;margin:0 0 16px">Sign-in is broken</h2>
      <p style="color:#333;margin:0 0 16px">
        Users cannot sign in to Source Library. The following auth providers are failing:
      </p>
      <table style="border-collapse:collapse;width:100%;margin:0 0 16px">
        <tr style="background:#f5f5f5"><th style="padding:8px;border:1px solid #ddd;text-align:left">Provider</th><th style="padding:8px;border:1px solid #ddd;text-align:left">Error</th></tr>
        ${failureRows}
      </table>
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
      subject: '[CRITICAL] Source Library sign-in is broken',
      html,
    });

    // Record cooldown
    try {
      const db = await getDb();
      await db.collection('system_config').updateOne(
        { _id: 'auth_alert_state' as any },
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
