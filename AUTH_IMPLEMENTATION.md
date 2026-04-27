# Authentication Implementation Guide

## Overview

Authentication has been implemented using NextAuth v5 with Google OAuth and email whitelisting. Only whitelisted Google accounts can sign in and access admin features.

## What Was Implemented

### 1. Email Whitelist in NextAuth ([src/lib/auth.ts](src/lib/auth.ts))
- Added `signIn` callback that checks user email against whitelist
- Configured error page for rejected logins
- Supports environment variable `ADMIN_EMAILS` for production

### 2. API Route Protection ([src/lib/auth-helpers.ts](src/lib/auth-helpers.ts))
Three helper functions for protecting API routes:
- `withAuth()` - Full protection (all methods require auth)
- `withMethodAuth()` - Method-specific (e.g., GET public, POST/DELETE protected)
- `getSession()` - Get current session in server components
- `requireAuth()` - Throw if not authenticated (for server components)

### 3. Frontend Route Protection ([src/middleware.ts](src/middleware.ts))
Next.js middleware that protects:
- `/admin/*`
- `/analytics/*`
- `/experiments/*`
- `/processing/*`
- `/qa/*`
- `/jobs/*`

### 4. UI Components
- [AuthCheck](src/components/auth/AuthCheck.tsx) - Conditionally render UI for authenticated users
- [Unauthorized page](src/app/unauthorized/page.tsx) - 403 error page
- [Auth error page](src/app/auth/error/page.tsx) - Login rejection page

### 5. Example Protection Applied
Updated [/api/admin/sync-page-counts](src/app/api/admin/sync-page-counts/route.ts) to demonstrate `withAuth` usage.

## How to Use

### Step 1: Add Your Email to Whitelist

**Option A: Direct in code (for development)**
Edit [src/lib/auth.ts](src/lib/auth.ts#L11-L14):
```typescript
const ADMIN_EMAILS = [
  'your-email@gmail.com',
  'another-admin@gmail.com',
];
```

**Option B: Environment variable (for production)**
Add to `.env.local`:
```bash
ADMIN_EMAILS="your-email@gmail.com,another-admin@gmail.com"
```

### Step 2: Ensure Google OAuth Credentials

Make sure these are set in `.env.local`:
```bash
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
AUTH_SECRET="your-auth-secret"
```

### Step 3: Protect Your API Routes

**Full protection (all methods):**
```typescript
import { withAuth } from '@/lib/auth-helpers';

export const POST = withAuth(async (request, session) => {
  // session.user is guaranteed to exist
  console.log('Admin user:', session.user.email);
  // ... your code
});

export const GET = withAuth(async (request, session) => {
  // Also protected
});
```

**Method-specific protection (GET public, POST/DELETE protected):**
```typescript
import { withMethodAuth } from '@/lib/auth-helpers';

const handler = async (request: NextRequest, context: any, session?: Session) => {
  if (request.method === 'GET') {
    // Public access - anyone can call
    return NextResponse.json({ data: 'public' });
  }

  if (request.method === 'POST') {
    // Protected - session is guaranteed
    console.log('Admin:', session!.user.email);
    return NextResponse.json({ success: true });
  }
};

export const GET = withMethodAuth({ publicMethods: ['GET'] })(handler);
export const POST = withMethodAuth({ protectedMethods: ['POST'] })(handler);
```

### Step 4: Protect Server Components

```typescript
import { requireAuth } from '@/lib/auth-helpers';

export default async function AdminPage() {
  await requireAuth(); // Redirects to signin if not authenticated

  return <div>Admin content</div>;
}
```

### Step 5: Conditionally Render UI

```typescript
import { AuthCheck } from '@/components/auth/AuthCheck';

export default function BookPage() {
  return (
    <div>
      <h1>Book Title</h1>

      {/* Only show to authenticated admins */}
      <AuthCheck>
        <button>Delete Book</button>
        <button>Edit Metadata</button>
      </AuthCheck>
    </div>
  );
}
```

## Testing

### 1. Unauthenticated Access
- Visit `http://localhost:3000/admin/social`
- Should redirect to `/auth/signin`
- Call `POST /api/admin/sync-page-counts` without auth
- Should return 401 Unauthorized

### 2. Non-Whitelisted Email
- Try to sign in with a Google account not on the whitelist
- Should redirect to `/auth/error` with "Access Denied" message

### 3. Whitelisted Admin Access
- Sign in with a whitelisted Google account
- Visit `/admin/social` - should load successfully
- Call `POST /api/admin/sync-page-counts` - should execute
- Verify admin buttons are visible

### 4. Method-Specific Protection
- Without auth: `GET /api/books/123` → success (if configured as public)
- Without auth: `DELETE /api/books/123` → 401
- With auth: `DELETE /api/books/123` → success

## Routes to Protect

### High Priority (Destructive Operations)
- `/api/books/[id]/reset-ocr` - Clears OCR data
- `/api/admin/sync-page-counts` - Database updates ✓ (already protected)
- `/api/admin/ensure-indexes` - Creates indexes
- `/api/import/*` - Book imports (all 12 providers)

### Medium Priority (Expensive Operations)
- `/api/admin/generate-embeddings`
- `/api/admin/backfill-detected-images`
- `/api/analytics/usage`

### All `/api/admin/*` Routes (22+ routes)
Wrap with `withAuth` to protect administrative operations.

## Extending the Whitelist

### Add Individual Emails
```typescript
const ADMIN_EMAILS = [
  'user1@gmail.com',
  'user2@gmail.com',
  'user3@yourdomain.com',
];
```

### Allow Entire Domain
Edit the `signIn` callback in [src/lib/auth.ts](src/lib/auth.ts):
```typescript
async signIn({ user }) {
  const email = user.email?.toLowerCase();

  // Allow specific domain
  if (email?.endsWith('@yourdomain.com')) {
    return true;
  }

  // Or check against whitelist
  return ADMIN_EMAILS.includes(email || '');
}
```

## Future Enhancements

### Add Role System
If you need different permission levels (admin, editor, viewer):

1. Add `role` field to user documents in MongoDB
2. Extend JWT callback to include role:
```typescript
async jwt({ token, user }) {
  if (user) {
    token.id = user.id;
    const userDoc = await db.collection('users').findOne({ id: user.id });
    token.role = userDoc?.role || 'viewer';
  }
  return token;
}
```
3. Check role in auth helpers

### Add API Key Authentication
For programmatic access, extend `withAuth`:
```typescript
const apiKey = request.headers.get('x-api-key');
if (apiKey) {
  const user = await validateApiKey(apiKey);
  if (user) return handler(request, { user });
}
```

## Troubleshooting

### "Access Denied" when trying to sign in
- Verify your email is in the whitelist
- Check case sensitivity (emails are lowercased)
- Check environment variables are loaded

### Middleware not redirecting
- Verify middleware.ts is in the root `src/` directory
- Check the `matcher` config includes your route
- Restart dev server after adding middleware

### API routes returning 401
- Verify you're signed in (check cookies in browser dev tools)
- Look for `__Secure-authjs.session-token` cookie
- Check that your route is properly wrapped with `withAuth`

### Session not persisting
- Verify `AUTH_SECRET` is set
- In production, ensure cookies are HTTPS-only
- Check cookie settings in browser

## Security Notes

✅ **What's Protected:**
- Frontend admin pages (via middleware)
- API routes wrapped with `withAuth` or `withMethodAuth`
- Session cookies are HTTP-only and secure in production
- CSRF protection built into NextAuth

⚠️ **What's NOT Protected Yet:**
- Most API routes (need to wrap with `withAuth` manually)
- Some destructive operations still public
- No rate limiting (add as needed)

## Next Steps

1. **Add your email to whitelist** in [src/lib/auth.ts](src/lib/auth.ts)
2. **Test the flow** by visiting `/admin/social`
3. **Protect remaining routes** by applying `withAuth` to:
   - All `/api/admin/*` routes
   - All `/api/import/*` routes
   - Destructive operations like `/api/books/[id]/reset-ocr`
4. **Add `AuthCheck`** to frontend components with admin-only features
5. **Deploy** and test in production with real Google OAuth

## Files Modified/Created

**Modified:**
- [src/lib/auth.ts](src/lib/auth.ts) - Added email whitelist
- [src/app/api/admin/sync-page-counts/route.ts](src/app/api/admin/sync-page-counts/route.ts) - Example protection

**Created:**
- [src/lib/auth-helpers.ts](src/lib/auth-helpers.ts) - Auth wrapper functions
- [src/middleware.ts](src/middleware.ts) - Frontend route protection
- [src/components/auth/AuthCheck.tsx](src/components/auth/AuthCheck.tsx) - UI component
- [src/app/unauthorized/page.tsx](src/app/unauthorized/page.tsx) - 403 page
- [src/app/auth/error/page.tsx](src/app/auth/error/page.tsx) - Login rejection page
