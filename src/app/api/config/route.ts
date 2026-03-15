import { NextResponse } from 'next/server';

/**
 * Public config endpoint. Returns feature flags for the client.
 * Cached for 1 hour — doesn't change at runtime.
 */
export async function GET() {
  return NextResponse.json(
    {
      payments: !!process.env.STRIPE_SECRET_KEY,
    },
    {
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    }
  );
}
