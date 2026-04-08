import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Members — The Ficino Society',
  description: 'The circle of scholars and readers translating the Western esoteric tradition.',
};

export const revalidate = false;

interface MemberProfile {
  name: string;
  bio: string | null;
  since: string | null;
  contributor: boolean;
}

async function getMembers(): Promise<MemberProfile[]> {
  const db = await getDb();
  const members = await db.collection('users').find(
    {
      $or: [
        { 'membership.joined': true },
        { 'membership.active': true },
      ],
      'membership.profile.visible': { $ne: false },
    },
    {
      projection: {
        'membership.profile.displayName': 1,
        'membership.profile.bio': 1,
        'membership.activatedAt': 1,
        'membership.joinedAt': 1,
        'membership.active': 1,
        name: 1,
      },
    }
  ).sort({ 'membership.joinedAt': 1, 'membership.activatedAt': 1 }).toArray();

  return members.map(m => ({
    name: m.membership?.profile?.displayName || m.name || 'Anonymous',
    bio: m.membership?.profile?.bio || null,
    since: (m.membership?.joinedAt || m.membership?.activatedAt)
      ? new Date(m.membership.joinedAt || m.membership.activatedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : null,
    contributor: !!m.membership?.active,
  }));
}

export default async function MembersPage() {
  const members = await getMembers();

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <div className="max-w-[640px] mx-auto px-6 py-16 md:py-24">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/ficino-society"
            className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase hover:text-[#444] transition-colors font-sans"
          >
            The Ficino Society
          </Link>
          <h1
            className="text-3xl md:text-4xl font-serif text-[#1a1612] mt-4 mb-3"
            style={{ fontWeight: 400 }}
          >
            Members
          </h1>
          <p className="text-[#6b6560] text-sm font-body leading-relaxed">
            The circle of scholars and readers translating the Western esoteric tradition.
            {members.length > 0 && (
              <span className="text-[#8a8480]"> {members.length} {members.length === 1 ? 'member' : 'members'}.</span>
            )}
          </p>
        </div>

        {members.length > 0 ? (
          <div>
            {members.map((member, i) => (
              <div
                key={i}
                className="py-5"
                style={{ borderBottom: i < members.length - 1 ? '1px solid #e8e4dc' : undefined }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-serif text-[#1a1612] text-[17px]" style={{ fontWeight: 500 }}>
                    {member.name}
                  </span>
                  <span className="text-[11px] text-[#8a8480] flex-shrink-0 font-sans tracking-wide">
                    {member.since}
                  </span>
                </div>
                {member.bio && (
                  <p className="text-sm mt-1.5 text-[#6b6560] leading-relaxed font-body">
                    {member.bio}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-[#6b6560] font-body text-lg mb-2">
              The Society is just getting started.
            </p>
            <p className="text-[#8a8480] text-sm font-body mb-8">
              Join to become a founding member.
            </p>
            <Link
              href="/ficino-society"
              className="inline-block px-6 py-2.5 rounded text-white text-sm bg-[#9e4a3a] hover:brightness-110 transition-all"
            >
              Join the Society
            </Link>
          </div>
        )}

        <div className="mt-12 pt-8 border-t border-[#e8e4dc]">
          <p className="text-[12px] text-[#8a8480] leading-relaxed font-sans">
            Members can update how they appear here from their{' '}
            <Link href="/account" className="underline hover:text-[#6b6560] transition-colors">
              account settings
            </Link>
            , or opt out entirely.
          </p>
        </div>
      </div>
    </div>
  );
}
