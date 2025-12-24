import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import type { Job, JobType } from '@/lib/types';

// GET - List all jobs (with optional filters)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const bookId = searchParams.get('book_id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const db = await getDb();

    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (bookId) query.book_id = bookId;

    const jobs = await db.collection('jobs')
      .find(query)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      jobs: jobs.map(j => ({
        ...j,
        id: j.id || j._id?.toString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

// POST - Create a new job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      type,
      book_id,
      book_title,
      page_ids,
      model,
      prompt_name,
      language,
      initiated_by,
    } = body as {
      type: JobType;
      book_id?: string;
      book_title?: string;
      page_ids: string[];
      model?: string;
      prompt_name?: string;
      language?: string;
      initiated_by?: string;
    };

    if (!type || !page_ids || !Array.isArray(page_ids) || page_ids.length === 0) {
      return NextResponse.json(
        { error: 'type and page_ids are required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const jobId = nanoid(12);

    const job: Job = {
      id: jobId,
      type,
      status: 'pending',
      progress: {
        total: page_ids.length,
        completed: 0,
        failed: 0,
      },
      book_id,
      book_title,
      initiated_by,
      created_at: new Date(),
      updated_at: new Date(),
      results: [],
      config: {
        model: model || 'gemini-2.0-flash',
        prompt_name,
        language: language || 'Latin',
        page_ids,
      },
    };

    await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);

    return NextResponse.json({ job, message: 'Job created' });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}
