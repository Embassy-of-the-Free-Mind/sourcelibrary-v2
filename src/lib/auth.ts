import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Email from 'next-auth/providers/nodemailer';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from './mongodb-client';
import { Resend } from 'resend';

const dbName = process.env.MONGODB_DB || 'bookstore';

const WELCOME_HTML = `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
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

// Helper: check if user is in the admin whitelist
async function isAdminUser(email: string): Promise<boolean> {
  try {
    const client = await clientPromise;
    const db = client.db(dbName);
    const admin = await db.collection('admin_users').findOne({
      email: email.toLowerCase(),
      active: true,
    });
    return !!admin;
  } catch (error) {
    console.error('[auth] Error checking admin status:', error);
    return false;
  }
}

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
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
          to: email,
          subject: 'Sign in to Source Library',
          html: `
            <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
              <div style="text-align: center; margin-bottom: 32px;">
                <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
                <h1 style="font-size: 24px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">Sign in to Source Library</h1>
                <p style="color: #6b6560; font-size: 15px; line-height: 1.6; margin: 0;">
                  Click the button below to access the collection.
                </p>
              </div>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${url}" style="display: inline-block; padding: 14px 40px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-family: -apple-system, sans-serif;">
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
      } catch (error) {
        console.error('[auth] Failed to send verification email:', error);
        throw new Error('Failed to send verification email');
      }
    },
  }));
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  adapter: MongoDBAdapter(clientPromise, { databaseName: dbName }),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
    verifyRequest: '/auth/verify',
  },
  events: {
    async createUser({ user }) {
      // Auto-add new users to Resend audience + send welcome email
      if (user.email && process.env.RESEND_API_KEY) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const AUDIENCE_ID = '62145526-c584-4230-81f1-a62387c49055';

          await Promise.allSettled([
            resend.contacts.create({
              audienceId: AUDIENCE_ID,
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
  },
  callbacks: {
    // Allow all sign-ins — no admin whitelist restriction for readers
    async signIn() {
      return true;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        // Check admin status on first sign-in
        if (user.email) {
          token.role = (await isAdminUser(user.email)) ? 'admin' : 'reader';
        } else {
          token.role = 'reader';
        }
      }
      // Check membership status on sign-in and session updates
      if (token.id && (user || trigger === 'update')) {
        try {
          const client = await clientPromise;
          const db = client.db(dbName);
          const dbUser = await db.collection('users').findOne(
            { _id: token.id as any },
            { projection: { 'membership.active': 1, 'membership.plan': 1, 'membership.joined': 1 } }
          );
          // Financial contributors get 'ficino', free members get 'member', others null
          if (dbUser?.membership?.active) {
            token.membership = dbUser.membership.plan || 'ficino';
          } else if (dbUser?.membership?.joined) {
            token.membership = 'member';
          } else {
            token.membership = null;
          }
        } catch {
          // Don't block auth if membership check fails
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role as string;
        (session.user as any).membership = token.membership || null;
      }
      return session;
    },
  },
});
