'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { trackEvent } from '@/lib/track-event';

// Did the reader arrive because WelcomeGate redirected them (it appends ?from=),
// or did they navigate to /welcome themselves? Those are different populations —
// the ~3,850 backfilled users all arrive via the gate — and mixing them would
// make the completion rate meaningless. Read from window.location rather than
// useSearchParams: this component renders inside a page that already opts out of
// static prerendering, but the hook would add a bailout boundary for no reason.
function arrivalSource(): 'gate' | 'direct' {
  if (typeof window === 'undefined') return 'direct';
  return new URLSearchParams(window.location.search).has('from') ? 'gate' : 'direct';
}

export default function WelcomeForm({ initialName = '' }: { initialName?: string }) {
  const router = useRouter();
  const { update } = useSession();
  // Google sign-ins arrive with a name; magic-link sign-ins never do, and this
  // is the only place we ever ask. Prefill so Google users aren't retyping it.
  const [name, setName] = useState(initialName);
  const [aboutYou, setAboutYou] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const viewed = useRef(false);

  // One view per mount. Without this the denominator does not exist, and a low
  // completion rate reads identically to a page nobody can reach — the failure
  // this form actually had.
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    trackEvent('welcome_view', { source: arrivalSource() });
  }, []);

  const send = async (payload: object) => {
    setStatus('submitting');
    try {
      const res = await fetch('/api/me/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      await update();
      router.push('/');
      router.refresh();
    } catch {
      setStatus('error');
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = { name: name.trim(), about: aboutYou.trim(), help: helpDescription.trim() };
    // Which boxes were filled, never their contents — the prose lives in
    // users.profile, and an analytics row is the wrong place for it.
    trackEvent('welcome_save', {
      source: arrivalSource(),
      hasName: Boolean(trimmed.name),
      hasAbout: Boolean(trimmed.about),
      hasHelp: Boolean(trimmed.help),
    });
    send({
      name: trimmed.name,
      about_you: trimmed.about,
      help_description: trimmed.help,
    });
  };

  const handleSkip = () => {
    trackEvent('welcome_skip', { source: arrivalSource() });
    send({ skip: true });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl p-6 md:p-8 space-y-7 shadow-lg shadow-stone-900/5">
      <div>
        <label htmlFor="welcome-name" className="block font-serif text-xl text-stone-900 mb-1">
          What should we call you?
          <span className="font-sans font-normal text-base text-stone-500 ml-2">optional</span>
        </label>
        <input
          id="welcome-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="name"
          maxLength={100}
          placeholder="Your name"
          className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
        />
      </div>

      <div>
        <label htmlFor="about-you" className="block font-serif text-xl text-stone-900 mb-1">
          Who are you, and what interests you about Source Library?
        </label>
        <p className="text-sm text-stone-500 mb-3">
          A few words — your background, the authors or traditions you&rsquo;re drawn to, questions you&rsquo;re chasing.
        </p>
        <textarea
          id="about-you"
          rows={5}
          value={aboutYou}
          onChange={e => setAboutYou(e.target.value)}
          placeholder="e.g. I&rsquo;m a graduate student in early modern history, working on Florentine Neoplatonism. I&rsquo;m here for Ficino, Pico, and anything that touches the Hermetica…"
          className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-y"
        />
      </div>

      <div>
        <label htmlFor="help-description" className="block font-serif text-xl text-stone-900 mb-1">
          How would you like to help?
          <span className="font-sans font-normal text-base text-stone-500 ml-2">if at all</span>
        </label>
        <p className="text-sm text-stone-500 mb-3">
          Reviewing translations, annotating texts, suggesting books, writing, coding, study groups — or just here to read.
        </p>
        <textarea
          id="help-description"
          rows={3}
          value={helpDescription}
          onChange={e => setHelpDescription(e.target.value)}
          placeholder="In your own words…"
          className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-y"
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={handleSkip}
          disabled={status === 'submitting'}
          className="text-sm text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50"
        >
          Skip for now
        </button>
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="bg-stone-900 text-white py-2.5 px-7 rounded-full hover:bg-stone-800 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {status === 'submitting' ? 'Saving…' : 'Save & start reading'}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-sm text-status-error">Something went wrong. Try again or skip for now.</p>
      )}
    </form>
  );
}
