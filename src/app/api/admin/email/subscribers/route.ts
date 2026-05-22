import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const GET = withAdminAuth(async (_request: NextRequest) => {
  const db = await getDb();
  const collection = db.collection('beta_subscribers');

  const [total, bySource, efmOptIn, recent] = await Promise.all([
    collection.countDocuments(),
    collection.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]).toArray(),
    collection.countDocuments({ efm_newsletter_opt_in: true }),
    collection.find()
      .sort({ subscribed_at: -1 })
      .limit(20)
      .project({ email: 1, source: 1, subscribed_at: 1, country: 1, efm_newsletter_opt_in: 1 })
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
    efm_newsletter_opt_in: r.efm_newsletter_opt_in === true,
  }));

  return NextResponse.json({
    total,
    by_source: sourceMap,
    efm_newsletter_opt_in: efmOptIn,
    recent: maskedRecent,
  });
});
