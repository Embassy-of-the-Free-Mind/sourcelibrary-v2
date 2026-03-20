import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const GET = withAdminAuth(async () => {
  const db = await getDb();

  const users = await db.collection('users').find(
    {
      $or: [
        { 'membership.joined': true },
        { 'membership.active': true },
      ],
    },
    {
      projection: {
        name: 1,
        email: 1,
        membership: 1,
      },
      sort: { 'membership.activatedAt': -1, 'membership.joinedAt': -1 },
    }
  ).toArray();

  // Count edits per user
  const editCounts = await db.collection('pages').aggregate([
    { $match: { edited_by: { $exists: true } } },
    { $group: { _id: '$edited_by', count: { $sum: 1 } } },
  ]).toArray();

  const editMap = new Map(editCounts.map(e => [e._id, e.count]));

  const members = users.map(u => ({
    _id: u._id.toString(),
    name: u.name,
    email: u.email,
    membership: u.membership || {},
    editCount: editMap.get(u._id.toString()) || 0,
  }));

  const contributors = members.filter(m => m.membership.active);
  const free = members.filter(m => m.membership.joined && !m.membership.active);

  return NextResponse.json({
    members,
    stats: {
      total: members.length,
      contributors: contributors.length,
      free: free.length,
    },
  });
});
