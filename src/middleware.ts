import { NextResponse, NextRequest } from 'next/server';

// Simple middleware that doesn't use auth/database in edge runtime
// Auth is handled by individual routes as needed
export function middleware(request: NextRequest) {
  // All pages are public - auth is handled at the route level
  return NextResponse.next();
}

export const config = {
  // Only match specific paths if needed, otherwise let everything through
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
