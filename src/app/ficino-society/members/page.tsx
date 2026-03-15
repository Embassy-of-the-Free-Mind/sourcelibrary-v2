import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Members — The Ficino Society',
  description: 'The people who support Source Library.',
};

export const dynamic = 'force-dynamic';

interface MemberProfile {
  name: string;
  bio: string | null;
  since: string | null;
}

async function getMembers(): Promise<MemberProfile[]> {
  const db = await getDb();
  const members = await db.collection('users').find(
    {
      'membership.active': true,
      'membership.profile.visible': { $ne: false },
    },
    {
      projection: {
        'membership.profile.displayName': 1,
        'membership.profile.bio': 1,
        'membership.activatedAt': 1,
        name: 1,
      },
    }
  ).sort({ 'membership.activatedAt': 1 }).toArray();

  return members.map(m => ({
    name: m.membership?.profile?.displayName || m.name || 'Anonymous',
    bio: m.membership?.profile?.bio || null,
    since: m.membership?.activatedAt
      ? new Date(m.membership.activatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : null,
  }));
}

export default async function MembersPage() {
  const members = await getMembers();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <div className="max-w-2xl mx-auto px-4 py-16 md:py-24">
        <div className="mb-12">
          <h1
            className="text-3xl md:text-4xl font-serif font-medium mb-4 tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Members of the Ficino Society
          </h1>
          <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            These people support the digitization and translation of ancient texts
            through Source Library. Their contributions make the collection free for everyone.
          </p>
        </div>

        {members.length > 0 ? (
          <div className="space-y-1">
            {members.map((member, i) => (
              <div
                key={i}
                className="py-4"
                style={{ borderBottom: i < members.length - 1 ? '1px solid var(--border-light)' : undefined }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {member.name}
                  </span>
                  {member.since && (
                    <span className="text-sm flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {member.since}
                    </span>
                  )}
                </div>
                {member.bio && (
                  <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {member.bio}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="rounded-xl p-8 text-center"
            style={{ background: 'white', border: '1px solid var(--border-light)' }}
          >
            <p className="text-lg font-serif mb-2" style={{ color: 'var(--text-primary)' }}>
              Be the first to join.
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              The Ficino Society is just getting started.
            </p>
            <Link
              href="/ficino-society"
              className="inline-block px-6 py-2.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent-rust)' }}
            >
              Learn more
            </Link>
          </div>
        )}

        <div className="mt-12 pt-8" style={{ borderTop: '1px solid var(--border-light)' }}>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Members can choose how they appear on this page from their{' '}
            <Link href="/account" className="underline" style={{ color: 'var(--text-muted)' }}>
              account settings
            </Link>
            , or opt out entirely.
          </p>
        </div>
      </div>
    </div>
  );
}
