import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const GET = withAdminAuth(async (_request: NextRequest) => {
  const db = await getDb();
  const collection = db.collection('beta_subscribers');

  const [total, bySource, recent] = await Promise.all([
    collection.countDocuments(),
    collection.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]).toArray(),
    collection.find()
      .sort({ subscribed_at: -1 })
      .limit(20)
      .project({ email: 1, source: 1, subscribed_at: 1, country: 1 })
      .toArray(),
  ]);

  const sourceMap: Record<string, number> = {};
  for (const s of bySource) {
    sourceMap[s._id || 'unknown'] = s.count;
  }

  // Mask emails for privacy: d***@gmail.com
  const maskedRecent = recent.map(r => ({
    email_masked: r.email ? r.email[0] + '***@' + r.email.split('@')[1] : '***',
    source: r.source || 'unknown',
    subscribed_at: r.subscribed_at?.toISOString() || '',
    country: r.country || undefined,
  }));

  return NextResponse.json({
    total,
    by_source: sourceMap,
    recent: maskedRecent,
  });
});
