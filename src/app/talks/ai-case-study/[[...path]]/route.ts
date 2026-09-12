/**
 * /talks/ai-case-study — the Erfgoedhuis Zuid-Holland case-study deck
 * ("AI in collection management", Space Expo, 23 November 2026).
 *
 * A self-contained static deck (HTML/CSS/JS + a few images) kept OUTSIDE
 * `public/` on purpose: anything in `public/` is served before any gate.
 * Every file under this route is served by this handler, and only to
 *   - a signed-in admin (or higher), or
 *   - a browser holding the access cookie set by posting the shared password.
 *
 * The password is TALK_ACCESS_PASSWORD (Vercel env); the cookie value is an
 * HMAC of it under AUTH_SECRET so the password itself never sits in a cookie.
 * Everything is noindex + no-store; /talks/ is also disallowed in robots.txt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, normalize, extname, sep } from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import { isAdmin } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = '/talks/ai-case-study';
const ROOT = join(process.cwd(), 'src', 'content', 'talks', 'ai-case-study');
const COOKIE = 'sl_talk_ai_case_study';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const PRIVATE_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'same-origin',
};

function accessToken(): string | null {
  const password = process.env.TALK_ACCESS_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || !secret) return null;
  return createHmac('sha256', secret).update(`talk:ai-case-study:${password}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function hasAccessCookie(req: NextRequest): boolean {
  const want = accessToken();
  const got = req.cookies.get(COOKIE)?.value;
  return !!(want && got && safeEqual(got, want));
}

async function allowed(req: NextRequest): Promise<boolean> {
  if (hasAccessCookie(req)) return true;
  try {
    return await isAdmin();
  } catch {
    return false;
  }
}

function gatePage(message?: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Source Library · case study</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1612;color:#f0ece4;font-family:Inter,system-ui,sans-serif}
form{width:min(420px,90vw);border:1px solid #46413a;padding:34px 34px 30px;background:rgba(255,255,255,.03)}
.wm{display:flex;align-items:center;gap:10px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#fff;margin-bottom:26px}
.wm b{font-weight:600}.wm span{font-weight:300}
h1{font-size:20px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
p{margin:0 0 22px;color:#b3a890;font-size:14px;line-height:1.5}
label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#a09585;margin-bottom:8px}
input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px 14px;border:1px solid #6b6055;background:#241f1b;color:#fff;outline:none}
input:focus{border-color:#fff}
button{margin-top:14px;width:100%;font:inherit;font-size:14px;font-weight:500;padding:12px;border:0;background:#9e4a3a;color:#fff;cursor:pointer}
.err{color:#f2b8a8;font-size:13px;margin:10px 0 0}
.note{margin-top:18px;font-size:12px;color:#8b7d68;line-height:1.5}
.note a{color:#d8d0c2}
</style></head><body>
<form method="post" action="${BASE}">
<div class="wm"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="4"/></svg><b>Source</b><span>Library</span></div>
<h1>AI in collection management</h1>
<p>A case study for Erfgoedhuis Zuid-Holland. Internal draft, not for circulation.</p>
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
${message ? `<div class="err">${message}</div>` : ''}
<button type="submit">Open the deck</button>
<div class="note">Source Library admins are let in automatically when <a href="/auth/signin">signed in</a>.</div>
</form></body></html>`;
  return new NextResponse(html, {
    status: 401,
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404, headers: PRIVATE_HEADERS });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await params;
  if (!(await allowed(req))) {
    // The deck itself gets the password form; its assets just refuse.
    return path.length === 0
      ? gatePage()
      : new NextResponse('Not authorised', { status: 401, headers: PRIVATE_HEADERS });
  }
  const rel = path.length ? path.join('/') : 'index.html';
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep)) return notFound();
  try {
    const body = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new NextResponse(body, { headers: { ...PRIVATE_HEADERS, 'Content-Type': type } });
  } catch {
    return notFound();
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const given = String(form?.get('password') ?? '');
  const want = process.env.TALK_ACCESS_PASSWORD;
  const token = accessToken();
  if (!want || !token || !safeEqual(given, want)) {
    return gatePage(
      want
        ? 'That password did not match.'
        : 'No password is configured for this deck yet; admins can sign in instead.',
    );
  }
  const res = NextResponse.redirect(new URL(BASE, req.url), 303);
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: BASE,
    maxAge: MAX_AGE,
  });
  Object.entries(PRIVATE_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
