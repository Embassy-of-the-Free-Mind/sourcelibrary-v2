'use client';

import { useState, useEffect, use } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';

interface Profile {
  id: string;
  displayName: string;
  bio: string;
  interests: string[];
  languages: string[];
  image: string | null;
}

export default function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const isOwn = session?.user?.id === id;

  useEffect(() => {
    fetch(`/api/embassy/profile/${id}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(data => {
        setProfile(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16">
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16 text-center">
          <h1 className="text-2xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            Profile not found
          </h1>
          <Link href="/embassy" className="text-sm text-[#9e4a3a] hover:underline font-sans">
            Return to the Embassy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />

      <div className="max-w-[680px] mx-auto px-6 py-8 md:py-12">
        {/* Header */}
        <div className="flex items-start gap-4 mb-8">
          {profile.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.image}
              alt={profile.displayName}
              className="w-16 h-16 rounded-full flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[#1a1612] flex items-center justify-center text-white text-xl font-sans flex-shrink-0">
              {profile.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1
              className="text-2xl md:text-3xl font-serif text-[#1a1612]"
              style={{ fontWeight: 400 }}
            >
              {profile.displayName}
            </h1>
            {isOwn && (
              <Link
                href="/embassy/profile/edit"
                className="text-[12px] text-[#9e4a3a] hover:underline font-sans"
              >
                Edit profile
              </Link>
            )}
          </div>
        </div>

        {/* Interests */}
        {profile.interests.length > 0 && (
          <div className="mb-6">
            <h2 className="text-[11px] text-[#6b6560] tracking-[0.15em] uppercase font-sans mb-2">
              Interests
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile.interests.map(interest => (
                <span
                  key={interest}
                  className="px-3 py-1 text-xs rounded-full border border-[#e8e4dc] text-[#444] font-sans"
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Languages */}
        {profile.languages.length > 0 && (
          <div className="mb-6">
            <h2 className="text-[11px] text-[#6b6560] tracking-[0.15em] uppercase font-sans mb-2">
              Languages
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile.languages.map(lang => (
                <span
                  key={lang}
                  className="px-3 py-1 text-xs rounded-full border border-[#e8e4dc] text-[#444] font-sans"
                >
                  {lang}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bio */}
        {profile.bio && (
          <div className="mt-8 pt-6 border-t border-[#e8e4dc]">
            <div className="prose prose-sm md:prose-base max-w-none font-body text-[15px] leading-relaxed text-[#333] prose-a:text-[#9e4a3a] prose-a:no-underline hover:prose-a:underline prose-headings:font-serif prose-headings:font-normal prose-headings:text-[#1a1612] prose-blockquote:border-l-[#c9a86c] prose-blockquote:text-[#444] prose-strong:text-[#1a1612]">
              <ReactMarkdown>{profile.bio}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* No bio yet — prompt */}
        {!profile.bio && isOwn && (
          <div className="mt-8 pt-6 border-t border-[#e8e4dc] text-center py-8">
            <p className="text-[#6b6560] font-body mb-3">
              You haven&apos;t written anything yet.
            </p>
            <Link
              href="/embassy/profile/edit"
              className="inline-block px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors"
            >
              Write your profile
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
