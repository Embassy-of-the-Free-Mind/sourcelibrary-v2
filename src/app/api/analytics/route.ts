import { NextRequest, NextResponse } from 'next/server';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'sourcelibrary-v2';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;

export async function GET(request: NextRequest) {
  if (!VERCEL_API_TOKEN) {
    return NextResponse.json(
      { error: 'Analytics API token not configured' },
      { status: 500 }
    );
  }

  try {
    const headers = {
      'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // Build URL with optional team ID
    let url = `https://api.vercel.com/v1/analytics?projectId=${VERCEL_PROJECT_ID}`;
    if (VERCEL_TEAM_ID) {
      url += `&teamId=${VERCEL_TEAM_ID}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      console.error('Vercel API error:', res.status, await res.text());
      return NextResponse.json(
        { error: 'Failed to fetch analytics from Vercel' },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
