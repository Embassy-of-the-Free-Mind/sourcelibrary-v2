import { NextResponse } from 'next/server';
import { getJobById } from '@/lib/job-helpers';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { job } = await getJobById(id);

    return NextResponse.json({ results: job.results || [] });
  } catch (error: any) {
    console.error('Error fetching job results:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch job results' },
      { status: error.statusCode || 500 }
    );
  }
}
