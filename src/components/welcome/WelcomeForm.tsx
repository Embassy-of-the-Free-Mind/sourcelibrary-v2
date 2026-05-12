'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

export default function WelcomeForm() {
  const router = useRouter();
  const { update } = useSession();
  const [aboutYou, setAboutYou] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');

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
    send({
      about_you: aboutYou.trim(),
      help_description: helpDescription.trim(),
    });
  };

  const handleSkip = () => send({ skip: true });

  return (
    <form onSubmit={handleSubmit} className="bg-white/95 backdrop-blur-sm border border-stone-200 rounded-xl p-6 md:p-8 space-y-7 shadow-lg shadow-stone-900/5">
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
