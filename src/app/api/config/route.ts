import { NextResponse } from 'next/server';
import { downloadChargesEnabled } from '@/lib/payment-flags';

/**
 * Public config endpoint. Returns feature flags for the client.
 * Cached for 1 hour — doesn't change at runtime.
 */
export async function GET() {
  return NextResponse.json(
    {
      // Read by the gallery image page: is an image download priced?
      payments: downloadChargesEnabled(),
    },
    {
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    }
  );
}
