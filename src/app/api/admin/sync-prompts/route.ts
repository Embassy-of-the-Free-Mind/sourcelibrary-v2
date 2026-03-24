import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { promptContentHash } from '@/lib/prompts';

/**
 * GET /api/admin/sync-prompts — Check for missing content_hash on DB prompts
 * POST /api/admin/sync-prompts — Backfill content_hash on all prompts missing it
 */

export const GET = withAuth(async () => {
  const db = await getDb();
  const collection = db.collection('prompts');

  const total = await collection.countDocuments();
  const withHash = await collection.countDocuments({ content_hash: { $exists: true } });
  const missingHash = total - withHash;

  return NextResponse.json({
    total,
    with_content_hash: withHash,
    missing_content_hash: missingHash,
    message: missingHash === 0
      ? 'All prompts have content_hash'
      : `${missingHash} prompts need content_hash backfill (POST to fix)`,
  });
});

export const POST = withAuth(async (request: NextRequest) => {
  const db = await getDb();
  const collection = db.collection('prompts');

  // Find all prompts missing content_hash
  const prompts = await collection
    .find({ content_hash: { $exists: false } })
    .toArray();

  if (prompts.length === 0) {
    return NextResponse.json({ message: 'All prompts already have content_hash', updated: 0 });
  }

  let updated = 0;
  for (const prompt of prompts) {
    const hash = promptContentHash(prompt.content as string);
    await collection.updateOne(
      { _id: prompt._id },
      { $set: { content_hash: hash } }
    );
    updated++;
  }

  return NextResponse.json({
    message: `Backfilled content_hash on ${updated} prompts`,
    updated,
  });
});
