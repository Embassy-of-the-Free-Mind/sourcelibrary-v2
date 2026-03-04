import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Email from 'next-auth/providers/nodemailer';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from './mongodb-client';
import { Resend } from 'resend';

const dbName = process.env.MONGODB_DB || 'bookstore';

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
            <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="font-size: 24px; color: #1c1917; margin-bottom: 8px;">Source Library</h1>
              <p style="color: #57534e; font-size: 16px; line-height: 1.6;">
                Click the link below to sign in and access the full collection of rare texts.
              </p>
              <a href="${url}" style="display: inline-block; margin: 24px 0; padding: 12px 32px; background: #1c1917; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px;">
                Sign in to Source Library
              </a>
              <p style="color: #a8a29e; font-size: 13px; margin-top: 32px;">
                If you didn't request this email, you can safely ignore it.
                This link expires in 24 hours.
              </p>
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
  callbacks: {
    // Allow all sign-ins — no admin whitelist restriction for readers
    async signIn() {
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // Check admin status on first sign-in
        if (user.email) {
          token.role = (await isAdminUser(user.email)) ? 'admin' : 'reader';
        } else {
          token.role = 'reader';
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role as string;
      }
      return session;
    },
  },
});
