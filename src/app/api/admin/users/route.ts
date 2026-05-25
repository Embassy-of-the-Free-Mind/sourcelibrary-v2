import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const GET = withAdminAuth(async () => {
  const db = await getDb();

  const [users, usage, subscribers] = await Promise.all([
    db.collection('users').find(
      {},
      { projection: { name: 1, email: 1, image: 1, emailVerified: 1, createdAt: 1, welcomedAt: 1 } },
    ).toArray(),
    db.collection('reading_history').aggregate([
      { $match: { user_id: { $ne: null } } },
      {
        $group: {
          _id: '$user_id',
          books: { $addToSet: '$book_id' },
          pages_viewed: { $sum: '$pages_viewed' },
          last_active: { $max: '$updated_at' },
          first_active: { $min: '$started_at' },
        },
      },
      {
        $project: {
          book_count: { $size: '$books' },
          pages_viewed: 1,
          last_active: 1,
          first_active: 1,
        },
      },
    ]).toArray(),
    db.collection('beta_subscribers').find(
      {},
      { projection: { email: 1, source: 1, country: 1, efm_newsletter_opt_in: 1, subscribed_at: 1, comment: 1 } },
    ).toArray(),
  ]);

  const usageById = new Map(usage.map(u => [String(u._id), u]));
  const subByEmail = new Map<string, typeof subscribers[number]>();
  for (const s of subscribers) {
    if (s.email) subByEmail.set(String(s.email).toLowerCase(), s);
  }

  const rows = users.map(u => {
    const uid = String(u._id);
    const stat = usageById.get(uid);
    const sub = u.email ? subByEmail.get(String(u.email).toLowerCase()) : undefined;
    return {
      id: uid,
      name: u.name || null,
      email: u.email || null,
      image: u.image || null,
      email_verified: !!u.emailVerified,
      created_at: u.createdAt ? new Date(u.createdAt).toISOString() : null,
      welcomed_at: u.welcomedAt ? new Date(u.welcomedAt).toISOString() : null,
      // Engagement
      book_count: stat?.book_count || 0,
      pages_viewed: stat?.pages_viewed || 0,
      first_active: stat?.first_active ? new Date(stat.first_active).toISOString() : null,
      last_active: stat?.last_active ? new Date(stat.last_active).toISOString() : null,
      // Newsletter
      source: sub?.source || (u.email ? 'oauth' : null),
      country: sub?.country || null,
      efm_newsletter_opt_in: sub?.efm_newsletter_opt_in === true,
      comment: sub?.comment || null,
    };
  });

  // Also include email-only subscribers (not in users collection) so the
  // table reflects every contact we have, not only OAuth signups.
  const knownEmails = new Set(rows.map(r => r.email?.toLowerCase()).filter(Boolean));
  for (const s of subscribers) {
    const email = s.email ? String(s.email).toLowerCase() : null;
    if (!email || knownEmails.has(email)) continue;
    rows.push({
      id: `subscriber:${String(s._id)}`,
      name: null,
      email,
      image: null,
      email_verified: false,
      created_at: s.subscribed_at ? new Date(s.subscribed_at).toISOString() : null,
      welcomed_at: null,
      book_count: 0,
      pages_viewed: 0,
      first_active: null,
      last_active: null,
      source: s.source || 'beta_landing',
      country: s.country || null,
      efm_newsletter_opt_in: s.efm_newsletter_opt_in === true,
      comment: s.comment || null,
    });
  }

  const totals = {
    users: users.length,
    subscribers_only: rows.length - users.length,
    active_readers: rows.filter(r => r.book_count > 0).length,
    efm_opt_in: rows.filter(r => r.efm_newsletter_opt_in).length,
  };

  return NextResponse.json({ rows, totals });
});
