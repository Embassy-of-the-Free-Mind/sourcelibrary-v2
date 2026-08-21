'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { trackEvent } from '@/lib/track-event';
import { returnDestination } from '@/lib/welcome-return';

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

export default function WelcomeForm({
  initialName = '',
  initialAboutYou = '',
  initialPreferredLanguage = '',
  initialHelpDescription = '',
  profileLoaded = true,
}: {
  initialName?: string;
  initialAboutYou?: string;
  initialPreferredLanguage?: string;
  initialHelpDescription?: string;
  /**
   * Did the server manage to read the stored profile? When false the fields are
   * blank because we couldn't look them up, NOT because the reader cleared them
   * — so a save must omit any field still untouched rather than write an empty
   * string over a real answer.
   */
  profileLoaded?: boolean;
}) {
  const router = useRouter();
  const { data: session, update } = useSession();
  // Google sign-ins arrive with a name; magic-link sign-ins never do, and this
  // is the only place we ever ask. Prefill so Google users aren't retyping it.
  const [name, setName] = useState(initialName);
  // Prefilled with what they already told us, so an empty box means "cleared"
  // rather than "never rendered". See the note in src/app/welcome/page.tsx.
  const [aboutYou, setAboutYou] = useState(initialAboutYou);
  const [preferredLanguage, setPreferredLanguage] = useState(initialPreferredLanguage);
  const [helpDescription, setHelpDescription] = useState(initialHelpDescription);
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
      // MUST pass a payload. `update()` with no argument issues a GET to
      // /api/auth/session (next-auth/react's update() only builds a body when
      // called with data, and lib/client.js only sets method:'POST' when a body
      // exists). A GET does not run the jwt callback with trigger:'update', so
      // the token kept needsWelcome:true even though welcomedAt had just been
      // written — and WelcomeGate bounced the reader straight back to this form,
      // forever. 36 readers were locked out of the site that way on 2026-07-29/30.
      await update({ welcomed: true });
      // Back to whatever they were reading when the gate interrupted them.
      const from = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('from')
        : null;
      router.push(returnDestination(from));
      router.refresh();
    } catch {
      setStatus('error');
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = { name: name.trim(), about: aboutYou.trim(), help: helpDescription.trim(), language: preferredLanguage.trim() };
    // Which boxes were filled, never their contents — the prose lives in
    // users.profile, and an analytics row is the wrong place for it.
    trackEvent('welcome_save', {
      source: arrivalSource(),
      hasName: Boolean(trimmed.name),
      hasAbout: Boolean(trimmed.about),
      hasHelp: Boolean(trimmed.help),
      hasLanguage: Boolean(trimmed.language),
    });
    // When the prefill read failed, a blank box carries no information — it may
    // be a real answer we simply could not load. Omit those fields so the route
    // leaves the stored value alone, rather than writing "" over it.
    const payload: Record<string, string> = { name: trimmed.name };
    if (profileLoaded || trimmed.about) payload.about_you = trimmed.about;
    if (profileLoaded || trimmed.language) payload.preferred_language = trimmed.language;
    if (profileLoaded || trimmed.help) payload.help_description = trimmed.help;
    send(payload);
  };

  // Mirrors UserMenu's avatar so the glyph in the pointer below matches the one
  // the reader will actually look for. Derived from the live name field, so it
  // tracks what they type.
  const initials =
    name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || session?.user?.email?.[0]?.toUpperCase() || '?';

  const handleSkip = () => {
    trackEvent('welcome_skip', { source: arrivalSource() });
    send({ skip: true });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl p-6 md:p-8 space-y-7 shadow-lg shadow-stone-900/5">
      <div>
        {/* Was "What should we call you? optional" — a question with a bare
            "optional" hanging off it. The page now says once, up top, that
            everything is optional, so each field no longer has to repeat it. */}
        <label htmlFor="welcome-name" className="block font-serif text-xl text-stone-900 mb-1">
          Your name
        </label>
        <p className="text-sm text-stone-500 mb-3">
          How we&rsquo;ll address you in emails and on your account.
        </p>
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
        <label htmlFor="preferred-language" className="block font-serif text-xl text-stone-900 mb-1">
          What language do you prefer to read in?
        </label>
        <p className="text-sm text-stone-500 mb-3">
          We translate into English first. Knowing what else readers want helps us
          decide what comes next.
        </p>
        {/* Free text rather than a fixed list: the point is to learn which
            languages readers actually want, and a dropdown can only offer the
            ones we already thought of. At this volume (thousands of users, not
            millions) grouping on a lowercased trim is fine. */}
        <input
          id="preferred-language"
          type="text"
          value={preferredLanguage}
          onChange={e => setPreferredLanguage(e.target.value)}
          maxLength={60}
          placeholder="e.g. English, Spanish, Portuguese, Chinese…"
          className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
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

      {/* Nothing here is a one-shot. Skipping in particular reads as "this
          question is now closed", which is why the pointer names the exact
          control rather than just saying "later in your account" — the avatar
          in the top right is on every page, including this one. Editor lives at
          /account#reader-profile; if that card moves, fix this sentence too. */}
      <p className="text-sm text-stone-500 border-t border-stone-200 pt-5 flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 border-stone-300 bg-stone-100 flex items-center justify-center text-[9px] font-medium text-stone-500"
        >
          {initials}
        </span>
        <span>
          You can add to or change all of this later on your reader profile — open this menu at the
          top right of any page and choose <span className="text-stone-700 font-medium">Account</span>.
        </span>
      </p>

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
