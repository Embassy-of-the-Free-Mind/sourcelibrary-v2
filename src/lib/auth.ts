import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Email from 'next-auth/providers/nodemailer';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { toUserId } from './user-id';
import clientPromise from './mongodb-client';
import { Resend } from 'resend';
import { activatePendingMembership } from './memberships';
import { recordAuthEvent } from './auth-events';
import { resolvePostSignInRedirect } from './auth-redirect';

const dbName = process.env.MONGODB_DB || 'bookstore';

// The Resend audience every signed-up reader is added to. Exported so the
// welcome form can backfill firstName/lastName on the same contact — magic-link
// signups have no name at createUser time, which is when the contact is made.
export const RESEND_AUDIENCE_ID = '62145526-c584-4230-81f1-a62387c49055';

/**
 * Inbound request headers, or null when there is no request scope.
 *
 * The NextAuth `events` and `sendVerificationRequest` hooks receive no request
 * object, so `next/headers` is the only way to classify the caller. It throws
 * outside a request (background invocation, tests) — hence the dynamic import
 * and the swallow. Returning null is deliberate: `buildAuthEvent` then stores a
 * null traffic_class rather than inventing one.
 */
async function safeHeaders(): Promise<Headers | null> {
  try {
    const { headers } = await import('next/headers');
    return await headers();
  } catch {
    return null;
  }
}

// --- Role system ---
// Replaces the old admin | curator | inner_circle | reader system.
// superadmin:  platform owner, cross-tenant (tenantId: null in memberships)
// admin:       tenant-scoped, manages users + settings
// editor:      tenant-scoped, manages content + triggers pipeline + applies edits
// contributor: tenant-scoped, *proposes* catalog edits (gated by editor review)
// reader:      authenticated, read + personal data
export type Role = 'superadmin' | 'admin' | 'editor' | 'contributor' | 'reader';
export const ROLE_LEVEL: Record<Role, number> = {
  reader: 1,
  contributor: 2,
  editor: 3,
  admin: 4,
  superadmin: 5,
};

// TODO: Remove getUserRole — replaced by memberships collection + ROLE_LEVEL system.
// Old function queried admin_users collection with roles: admin | curator | inner_circle.
// Kept as tombstone so reviewers can trace the change. Safe to delete after Phase 1.

const WELCOME_HTML = `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px; border-radius: 50%; border: 1px solid #e7ddcc;" />
    <h1 style="font-size: 26px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">Welcome to Source Library</h1>
    <p style="color: #6b6560; font-size: 15px; line-height: 1.6; margin: 0;">
      Your account is ready. Your likes and reading history will sync across all your devices.
    </p>
  </div>
  <div style="background: #f5f0e8; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
    <p style="font-size: 15px; line-height: 1.7; margin: 0 0 16px; color: #1a1612;">
      Source Library is a digital archive of over 2,000 rare books in alchemy, Hermetica, Kabbalah,
      astrology, and the Western esoteric tradition &mdash; many translated into English for the first time using AI.
    </p>
    <p style="font-size: 15px; line-height: 1.7; margin: 0; color: #1a1612;">
      Every text is free to read, search, and cite. Here are a few places to start:
    </p>
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
        <a href="https://sourcelibrary.org/search" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Search the collection</a>
        <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">Full-text search across all books and translations</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
        <a href="https://sourcelibrary.org/gallery" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Browse the gallery</a>
        <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">Thousands of illustrations extracted from the texts</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #e8e4dc;">
        <a href="https://sourcelibrary.org/encyclopedia" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Explore the encyclopedia</a>
        <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">People, places, and concepts across the collection</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0;">
        <a href="https://sourcelibrary.org/developers" style="color: #9e4a3a; text-decoration: none; font-size: 15px; font-weight: 500;">Developer tools (MCP)</a>
        <div style="color: #6b6560; font-size: 13px; margin-top: 4px;">Use Source Library from Claude, ChatGPT, or your own tools</div>
      </td>
    </tr>
  </table>
  <div style="text-align: center; margin: 32px 0;">
    <a href="https://sourcelibrary.org" style="display: inline-block; padding: 12px 32px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-family: -apple-system, sans-serif;">
      Start reading
    </a>
  </div>
  <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; text-align: center;">
    <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
      Source Library &mdash; Rare texts, translated and searchable.
      <br />
      <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
    </p>
  </div>
</div>
`;

// Build providers
const providers: any[] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }));
}

// Email magic link provider — requires RESEND_API_KEY
if (process.env.RESEND_API_KEY) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  providers.push(Email({
    server: { host: 'smtp.resend.com', port: 465, auth: { user: 'resend', pass: process.env.RESEND_API_KEY! } },
    from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
    sendVerificationRequest: async ({ identifier: email, url }) => {
      try {
        // Prefetch-safe magic link. The raw `url` is the one-time-token GET
        // callback (/api/auth/callback/nodemailer?...token=...). Email clients
        // and security scanners (Gmail's com.google.android.gm especially)
        // PREFETCH links to render previews / scan for malware — which fires
        // that GET and burns the single-use token before the human ever clicks,
        // surfacing as the dominant /auth/error?error=Verification failure.
        //
        // So the button instead points at /auth/confirm?next=<real url>: a
        // static interstitial with a "Sign in" button. A prefetcher GETs the
        // interstitial (harmless — no token consumed) and stops; only a human
        // click follows through to the real callback. Token survives until then.
        let confirmUrl = url;
        try {
          const origin = new URL(url).origin;
          confirmUrl = `${origin}/auth/confirm?next=${encodeURIComponent(url)}`;
        } catch {
          // If url can't be parsed for some reason, fall back to the raw link
          // rather than failing the whole sign-in.
        }
        const linkUrl = confirmUrl;
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
          to: email,
          subject: 'Sign in to Source Library',
          html: `
            <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
              <div style="text-align: center; margin-bottom: 32px;">
                <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px; border-radius: 50%; border: 1px solid #e7ddcc;" />
                <h1 style="font-size: 24px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">Sign in to Source Library</h1>
                <p style="color: #6b6560; font-size: 15px; line-height: 1.6; margin: 0;">
                  Click the button below to access the collection.
                </p>
              </div>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${linkUrl}" style="display: inline-block; padding: 14px 40px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-family: -apple-system, sans-serif;">
                  Sign In
                </a>
              </div>
              <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; text-align: center;">
                <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
                  If you didn&rsquo;t request this email, you can safely ignore it.
                  This link expires in 24 hours.
                  <br /><br />
                  <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
                </p>
              </div>
            </div>
          `,
        });
        // Record the SEND, not just the eventual sign-in. A `magic_link_sent`
        // with no matching `signin` is the signature of a broken magic-link
        // flow (a bad provider peer range, a dead SMTP key, prefetch burning
        // the token) — and it is visible without anyone signing in by hand to
        // check. That is precisely the question left open by #3431.
        try {
          const client = await clientPromise;
          await recordAuthEvent(client.db(dbName), {
            kind: 'magic_link_sent',
            provider: 'nodemailer',
            email,
            headers: await safeHeaders(),
          });
        } catch { /* never let telemetry break a sign-in */ }
      } catch (error) {
        console.error('[auth] Failed to send verification email:', error);
        throw new Error('Failed to send verification email');
      }
    },
  }));
}

// Share the session cookie across every *.sourcelibrary.org subdomain
// (production only — Vercel previews stay host-scoped because they live on
// *.vercel.app, and localhost dev needs host-only too). Without this each
// subdomain (sourcelibrary.org, bph.sourcelibrary.org, future kloss/jung
// tenants) holds its own session and users have to sign in N times.
// Roles still gate per-tenant via tenant_memberships — sharing identity does
// not share permissions.
const SHARE_SUBDOMAIN_COOKIE = process.env.VERCEL_ENV === 'production';
const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const SHARED_COOKIE_DOMAIN = '.sourcelibrary.org';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  adapter: MongoDBAdapter(clientPromise, { databaseName: dbName }),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  cookies: SHARE_SUBDOMAIN_COOKIE ? {
    sessionToken: {
      name: '__Secure-authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        domain: SHARED_COOKIE_DOMAIN,
      },
    },
    callbackUrl: {
      name: '__Secure-authjs.callback-url',
      options: {
        sameSite: 'lax',
        path: '/',
        secure: true,
        domain: SHARED_COOKIE_DOMAIN,
      },
    },
    // csrfToken keeps its NextAuth default: the `__Host-` prefix forbids
    // a `domain` attribute, and each subdomain hits its own /api/auth/*
    // routes, so a per-host CSRF cookie is fine.
  } : undefined,
  // Silences a warning about not detecting an explicit secure-flag setting
  // when running behind Vercel's proxy.
  useSecureCookies: SECURE_COOKIE,
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
    verifyRequest: '/auth/verify',
  },
  events: {
    async createUser({ user }) {
      // Timestamp new users (MongoDBAdapter doesn't set createdAt).
      // welcomedAt is set to null so the welcome interstitial can detect first-time users.
      // Existing users (pre-feature) won't have the field at all and are skipped.
      try {
        const client = await clientPromise;
        const db = client.db(dbName);
        await db.collection('users').updateOne(
          { email: user.email },
          { $set: { createdAt: new Date(), welcomedAt: null } }
        );
      } catch (error) {
        console.error('[auth] Failed to set createdAt:', error);
      }

      // Auto-add new users to Resend audience + send welcome email
      if (user.email && process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);

          await Promise.allSettled([
            resend.contacts.create({
              audienceId: RESEND_AUDIENCE_ID,
              email: user.email,
              firstName: user.name?.split(' ')[0] || undefined,
              lastName: user.name?.split(' ').slice(1).join(' ') || undefined,
            }),
            resend.emails.send({
              from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
              to: user.email,
              subject: 'Welcome to Source Library',
              html: WELCOME_HTML,
            }),
          ]);
        } catch (error) {
          console.error('[auth] Resend audience sync failed:', error);
        }
      }
    },
    // Stamp lastLogin on every actual authentication (fires on real sign-in,
    // not on every JWT validation / page load — so it measures returning
    // members who re-authenticate, e.g. after their session expires). Pairs
    // with createdAt so we can tell new sign-ups from returning ones.
    async signIn({ user, account, isNewUser }) {
      if (!user?.email) return;
      try {
        const client = await clientPromise;
        const db = client.db(dbName);
        await db.collection('users').updateOne(
          { email: user.email.toLowerCase() },
          { $set: { lastLogin: new Date() }, $inc: { loginCount: 1 } }
        );
        // Append the event too. lastLogin is overwritten each time and records
        // no provider, so it cannot answer "how many sign-ins today" or "did
        // the magic-link path work" — see src/lib/auth-events.ts.
        await recordAuthEvent(db, {
          kind: 'signin',
          provider: account?.provider,
          email: user.email,
          isNewUser,
          headers: await safeHeaders(),
        });
      } catch (error) {
        console.error('[auth] Failed to stamp lastLogin:', error);
      }
    },
  },
  callbacks: {
    // Send people back where they started, including across the subdomain
    // boundary. Sign-in exists only on the apex, so a BPH cataloguer signing
    // in from bph.sourcelibrary.org needs a cross-origin return trip that
    // NextAuth's default callback refuses. Restricted to *.sourcelibrary.org
    // over https — see src/lib/auth-redirect.ts for the allowlist rationale.
    async redirect({ url, baseUrl }) {
      return resolvePostSignInRedirect(url, baseUrl);
    },
    // Enforce signup restrictions based on tenant allowSignup setting
    async signIn({ user, account }) {
      if (!user?.email) return true;

      const email = user.email.toLowerCase();
      
      try {
        const client = await clientPromise;
        const db = client.db(dbName);

        // Check if this is a new user (only during initial sign-in)
        // If we have an `account` object, it's a new OAuth sign-in
        const isNewOAuthUser = !!account && account.type !== 'email';
        
        // For email provider, check if user already exists
        let isNewEmailUser = false;
        if (!isNewOAuthUser && account?.provider === 'email') {
          const existingUser = await db.collection('users').findOne({ email });
          isNewEmailUser = !existingUser;
        }

        const isNewUser = isNewOAuthUser || isNewEmailUser;

        // If user exists, allow sign-in (they're logging in)
        if (!isNewUser) return true;

        // If it's a new user attempting to sign up, check tenant restrictions
        // Try to determine which tenant they're accessing
        // This is a best-effort approach — signup restrictions are primarily enforced
        // at the [tenant]/login level where we have clear tenant context.
        
        // For now, allow all signups at the auth layer. The real enforcement happens
        // in [tenant]/login/page.tsx which checks allowSignup before rendering the form.
        // We'll add per-tenant enforcement in Phase 1.5 when we have tenant context
        // from the callbackUrl during session initialization.
        
        return true;
      } catch (error) {
        console.error('[auth] signIn callback error:', error);
        return true; // Allow on error (don't block auth)
      }
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;

        if (user.email) {
          const email = user.email.toLowerCase();
          try {
            const client = await clientPromise;
            const db = client.db(dbName);

            // 1. Check PLATFORM_ADMIN_EMAILS env var — bootstrap superadmin on first sign-in
            const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
              .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

            if (adminEmails.includes(email)) {
              token.role = 'superadmin';
              // Idempotent upsert — safe to run on every sign-in
              await db.collection('memberships').updateOne(
                { email, tenantId: null, role: 'superadmin' },
                {
                  $set: { userId: user.id },
                  $setOnInsert: {
                    email,
                    tenantId: null,
                    role: 'superadmin',
                    status: 'active',
                    invitedBy: null,
                    addedAt: new Date(),
                  },
                },
                { upsert: true }
              );
            } else {
              // 2. Check memberships for active or pending superadmin record
              // (covers platform admins invited via the dashboard)
              const superRecord = await db.collection('memberships').findOne({
                email,
                tenantId: null,
                role: 'superadmin',
                status: { $in: ['active', 'pending'] },
              });
              if (superRecord) {
                token.role = 'superadmin';
                // Activate pending invite on first sign-in
                if (superRecord.status === 'pending') {
                  await activatePendingMembership({
                    db,
                    email,
                    tenantId: null,
                    userId: user.id!,
                  });
                }
              } else {
                token.role = 'reader';
              }
              // TODO (Phase 1): resolve tenant-scoped role (admin/editor) from memberships
              // when tenantSlug is available via callbackUrl at sign-in time.
            }
          } catch (error) {
            console.error('[auth] Role resolution failed:', error);
            token.role = 'reader';
          }
        } else {
          token.role = 'reader';
        }
      }

      // Check ficino membership status on sign-in and session updates.
      // Kept for future per-tenant membership tiers — returns null gracefully on empty DB.
      if (token.id && (user || trigger === 'update')) {
        try {
          const client = await clientPromise;
          const db = client.db(dbName);
          // token.id is the adapter's string form of the user _id, but the
          // MongoDBAdapter stores _id as an ObjectId — querying with the raw
          // string silently matches nothing. That made needsWelcome and
          // membership permanently falsy (see the empty catch below, which hid
          // it): 3,850 of 3,854 users never saw the welcome interstitial.
          const dbUser = await db.collection('users').findOne(
            { _id: toUserId(token.id as string) as any },
            { projection: { name: 1, 'membership.active': 1, 'membership.plan': 1, 'membership.joined': 1, welcomedAt: 1 } }
          );
          if (dbUser?.membership?.active) {
            token.membership = dbUser.membership.plan || 'ficino';
          } else if (dbUser?.membership?.joined) {
            token.membership = 'member';
          } else {
            token.membership = null;
          }

          // Pick up a name saved after sign-in (magic-link users have none until
          // they fill in /welcome) so the session greets them without a re-login.
          if (dbUser?.name) token.name = dbUser.name;

          // needsWelcome is true only when welcomedAt is explicitly null (set on createUser).
          // Pre-feature users have no welcomedAt field at all — treat as already welcomed.
          (token as any).needsWelcome = dbUser && 'welcomedAt' in dbUser && dbUser.welcomedAt === null;
        } catch (error) {
          // Don't block auth if the lookup fails — but never swallow it silently
          // again; the previous bare catch is why the _id type mismatch above
          // went unnoticed from the day it shipped.
          console.error('[auth] User lookup failed (membership/needsWelcome):', error);
        }
      }

      // The welcome form has just saved and says so explicitly. The DB read
      // above already reaches the same conclusion when it succeeds — this is the
      // fallback for when it doesn't, because the cost of a stale true here is
      // not a missing badge but a reader who cannot leave /welcome. Outside the
      // try/catch on purpose: a failed lookup must not be able to re-trap them.
      if (trigger === 'update' && (session as any)?.welcomed === true) {
        (token as any).needsWelcome = false;
      }

      // Phase 1: resolve tenant-scoped role when the client triggers a session update
      // with { _pendingTenantSlug }. Called from [tenant]/layout.tsx after sign-in.
      const pendingTenantSlug =
        trigger === 'update' && session && typeof (session as any)._pendingTenantSlug === 'string'
          ? ((session as any)._pendingTenantSlug as string)
          : null;

      if (pendingTenantSlug) {
        const slug = pendingTenantSlug;
        try {
          const client = await clientPromise;
          const db = client.db(dbName);
          const tenant = await db.collection('tenants').findOne({ slug, status: { $ne: 'deleted' } });
          if (tenant) {
            const email = ((token as any).email as string || '').toLowerCase();
            const membership = await db.collection('memberships').findOne({
              email,
              tenantId: tenant.id,
              status: 'active',
            });
            (token as any).tenantId = tenant.id;
            (token as any).tenantSlug = slug;
            (token as any).tenantRole = membership?.role || 'reader';
          }
        } catch {
          // Non-blocking — tenant role resolution failure doesn't break the session
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role as string;
        (session.user as any).membership = token.membership || null;
        (session.user as any).tenantId = (token as any).tenantId || null;
        (session.user as any).tenantSlug = (token as any).tenantSlug || null;
        (session.user as any).tenantRole = (token as any).tenantRole || null;
        (session.user as any).needsWelcome = (token as any).needsWelcome === true;
      }
      return session;
    },
  },
});
