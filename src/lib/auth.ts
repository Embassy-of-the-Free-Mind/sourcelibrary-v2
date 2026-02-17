import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import { getDb } from './mongodb';

// Helper function to check if user is admin in database
async function isAdminUser(email: string): Promise<boolean> {
  try {        
    const db = await getDb();
    const adminUser = await db.collection('users').findOne({      
      email: email.toLowerCase(),
      active: true, // Only allow active admin users
    });
    return !!adminUser;
  } catch (error) {
    console.error('[auth] Error checking admin status:', error);
    return false;
  }
}

// Build providers array based on what's configured
// Focus on Google OAuth only for admin authentication
const providers = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }));
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(GitHub({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }));
}

export const { handlers, signIn, signOut, auth } = NextAuth({  
  providers,
  // AUTH_SECRET is required in production - must be set in Vercel env vars
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async signIn({ user }) {
      // Check if user is in admin_users collection
      const email = user.email?.toLowerCase();
      if (!email) {
        console.log(`[auth] Rejected login attempt: no email provided`);
        return false;
      }
      
      const isAdmin = await isAdminUser(email);
      if (!isAdmin) {
        console.log(`[auth] Rejected login attempt from: ${email}`);
        return false; // Reject sign-in
      }
      
      console.log(`[auth] Allowed login for admin: ${email}`);
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
