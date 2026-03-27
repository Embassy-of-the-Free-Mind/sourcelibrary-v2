'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';

const INTEREST_SUGGESTIONS = [
  'Alchemy', 'Hermetica', 'Kabbalah', 'Astrology', 'Neoplatonism',
  'Rosicrucianism', 'Gnosticism', 'Theosophy', 'Natural Philosophy',
  'Paracelsian Medicine', 'Sacred Geometry', 'Divination', 'Pythagoreanism',
  'Freemasonry', 'Mysticism', 'Renaissance Philosophy', 'Magic',
  'Occult Sciences', 'Lullian Arts', 'Christian Kabbalah',
  'Arabic Sciences', 'Chinese Alchemy', 'Tantra', 'Sufism',
];

const LANGUAGE_SUGGESTIONS = [
  'English', 'Latin', 'German', 'French', 'Italian', 'Greek',
  'Hebrew', 'Arabic', 'Dutch', 'Spanish', 'Chinese', 'Sanskrit',
];

export default function EditProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const [customInterest, setCustomInterest] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      router.push('/auth/signin?callbackUrl=/embassy/profile/edit');
      return;
    }

    fetch('/api/embassy/profile')
      .then(r => r.json())
      .then(data => {
        setDisplayName(data.displayName || '');
        setBio(data.bio || '');
        setInterests(data.interests || []);
        setLanguages(data.languages || []);
        setVisible(data.visible !== false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [session, status, router]);

  const toggleInterest = (interest: string) => {
    setInterests(prev =>
      prev.includes(interest)
        ? prev.filter(i => i !== interest)
        : [...prev, interest]
    );
  };

  const toggleLanguage = (lang: string) => {
    setLanguages(prev =>
      prev.includes(lang)
        ? prev.filter(l => l !== lang)
        : [...prev, lang]
    );
  };

  const addCustomInterest = () => {
    const trimmed = customInterest.trim();
    if (trimmed && !interests.includes(trimmed)) {
      setInterests(prev => [...prev, trimmed]);
      setCustomInterest('');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/embassy/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, bio, interests, languages, visible }),
      });
      if (res.ok) {
        router.push(`/embassy/profile/${session?.user?.id}`);
      }
    } catch { /* */ }
    setSaving(false);
  };

  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16">
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />

      <div className="max-w-[680px] mx-auto px-6 py-8 md:py-12">
        <h1
          className="text-3xl font-serif text-[#1a1612] mb-1"
          style={{ fontWeight: 400 }}
        >
          Your Profile
        </h1>
        <p className="text-[#6b6560] text-sm font-body mb-8">
          Tell the Embassy who you are and what you study. Your profile is visible to other members.
        </p>

        {/* Display name */}
        <div className="mb-6">
          <label className="block text-[11px] text-[#6b6560] tracking-[0.15em] uppercase font-sans mb-2">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            maxLength={100}
            placeholder="How you'd like to be known"
            className="w-full border border-[#e8e4dc] rounded-lg px-4 py-2.5 text-[15px] font-body text-[#1a1612] placeholder-[#8a8480] focus:outline-none focus:border-[#c9a86c] transition-colors bg-transparent"
          />
        </div>

        {/* Interests */}
        <div className="mb-6">
          <label className="block text-[11px] text-[#6b6560] tracking-[0.15em] uppercase font-sans mb-2">
            Interests
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {INTEREST_SUGGESTIONS.map(interest => (
              <button
                key={interest}
                onClick={() => toggleInterest(interest)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors font-sans ${
                  interests.includes(interest)
                    ? 'bg-[#1a1612] text-white border-[#1a1612]'
                    : 'border-[#e8e4dc] text-[#6b6560] hover:bg-[#f5f0e8] hover:text-[#444]'
                }`}
              >
                {interest}
              </button>
            ))}
          </div>
          {/* Custom interest */}
          <div className="flex gap-2">
            <input
              type="text"
              value={customInterest}
              onChange={e => setCustomInterest(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomInterest(); } }}
              placeholder="Add your own..."
              maxLength={100}
              className="flex-1 border border-[#e8e4dc] rounded-lg px-3 py-1.5 text-xs font-sans text-[#1a1612] placeholder-[#8a8480] focus:outline-none focus:border-[#c9a86c] transition-colors bg-transparent"
            />
            <button
              onClick={addCustomInterest}
              disabled={!customInterest.trim()}
              className="px-3 py-1.5 text-xs font-sans text-[#6b6560] border border-[#e8e4dc] rounded-lg hover:bg-[#f5f0e8] disabled:opacity-30 transition-colors"
            >
              Add
            </button>
          </div>
          {/* Show custom interests that aren't in suggestions */}
          {interests.filter(i => !INTEREST_SUGGESTIONS.includes(i)).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {interests.filter(i => !INTEREST_SUGGESTIONS.includes(i)).map(interest => (
                <button
                  key={interest}
                  onClick={() => toggleInterest(interest)}
                  className="px-3 py-1 text-xs rounded-full bg-[#1a1612] text-white border border-[#1a1612] font-sans"
                >
                  {interest} &times;
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Languages */}
        <div className="mb-6">
          <label className="block text-[11px] text-[#6b6560] tracking-[0.15em] uppercase font-sans mb-2">
            Languages You Read
          </label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_SUGGESTIONS.map(lang => (
              <button
                key={lang}
                onClick={() => toggleLanguage(lang)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors font-sans ${
                  languages.includes(lang)
                    ? 'bg-[#1a1612] text-white border-[#1a1612]'
                    : 'border-[#e8e4dc] text-[#6b6560] hover:bg-[#f5f0e8] hover:text-[#444]'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* Bio — the main event */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] text-[#6b6560] tracking-[0.15em] uppercase font-sans">
              About You
            </label>
            <button
              onClick={() => setPreview(!preview)}
              className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans"
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
          </div>
          <p className="text-[12px] text-[#8a8480] font-body mb-3">
            Markdown supported. Write as much or as little as you like — your background,
            what brought you here, what you&apos;re working on, favorite texts, anything.
          </p>
          {preview ? (
            <div className="border border-[#e8e4dc] rounded-lg p-6 bg-white min-h-[200px] prose prose-sm max-w-none font-body text-[15px] leading-relaxed prose-a:text-[#9e4a3a] prose-headings:font-serif prose-headings:font-normal">
              {bio ? (
                <ReactMarkdown>{bio}</ReactMarkdown>
              ) : (
                <p className="text-[#8a8480] italic">Nothing written yet.</p>
              )}
            </div>
          ) : (
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              maxLength={10000}
              rows={12}
              placeholder={`# About me

I'm a researcher in Renaissance intellectual history, focused on the transmission of Hermetic ideas from Florence to Northern Europe...

## Current projects

- Translating Reuchlin's *De Verbo Mirifico* (1494)
- Comparing alchemical imagery in Maier and Fludd

## Favorite texts in the collection

- Agrippa, *De Occulta Philosophia* — the planetary seals in Book II
- Ficino, *De Vita Coelitus Comparanda* — still the best guide to talismanic magic`}
              className="w-full border border-[#e8e4dc] rounded-lg px-4 py-3 text-[14px] font-mono text-[#1a1612] placeholder-[#c4c0b8] focus:outline-none focus:border-[#c9a86c] transition-colors bg-transparent resize-y leading-relaxed"
            />
          )}
        </div>

        {/* Visibility */}
        <div className="mb-8">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={visible}
              onChange={e => setVisible(e.target.checked)}
              className="rounded border-[#e8e4dc]"
            />
            <span className="text-sm text-[#444] font-body">
              Show my profile in the Embassy directory
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving || !displayName.trim()}
            className="px-6 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] disabled:opacity-30 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
          <Link
            href="/embassy"
            className="text-sm text-[#6b6560] hover:text-[#444] transition-colors font-sans"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
