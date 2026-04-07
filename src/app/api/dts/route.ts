/**
 * DTS Entry Point — Distributed Text Services v1.0
 *
 * GET /api/dts
 *
 * Returns JSON-LD with URI templates for the Collection, Navigation,
 * and Document endpoints. This is the discovery root for DTS clients.
 *
 * Spec: https://distributed-text-services.github.io/specifications/
 */

import { NextResponse } from 'next/server';

const BASE = 'https://sourcelibrary.org';

export async function GET() {
  const entry = {
    '@context': 'https://dtsapi.org/context/v1.0.json',
    '@id': `${BASE}/api/dts`,
    '@type': 'EntryPoint',
    collection: `${BASE}/api/dts/collection`,
    navigation: `${BASE}/api/dts/navigation`,
    document: `${BASE}/api/dts/document`,
  };

  return NextResponse.json(entry, {
    headers: {
      'Content-Type': 'application/ld+json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
