import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isOnAuthPage = req.nextUrl.pathname.startsWith('/auth');
  const isOnApiAuth = req.nextUrl.pathname.startsWith('/api/auth');
  const isPublicPage = req.nextUrl.pathname === '/' ||
                       req.nextUrl.pathname.startsWith('/books/');

  // Allow auth API routes
  if (isOnApiAuth) {
    return NextResponse.next();
  }

  // Allow public pages
  if (isPublicPage) {
    return NextResponse.next();
  }

  // Redirect to sign-in if not logged in
  if (!isLoggedIn && !isOnAuthPage) {
    return NextResponse.redirect(new URL('/auth/signin', req.url));
  }

  // Redirect to home if logged in and on auth page
  if (isLoggedIn && isOnAuthPage) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
