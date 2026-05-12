'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

const LANGUAGES = [
  'Latin', 'Ancient Greek', 'German', 'Arabic', 'Hebrew',
  'Sanskrit', 'Chinese', 'French', 'Italian', 'Dutch',
];

const INTERESTS = [
  { id: 'translation_review', label: 'Review AI translations', hint: 'Latin, Greek, and others — accuracy passes' },
  { id: 'annotation', label: 'Annotate texts', hint: 'Add context, notes, cross-references' },
  { id: 'suggest_books', label: 'Suggest books', hint: 'Texts from archives we should import' },
  { id: 'research', label: 'Write research', hint: 'Essays or close readings for the blog' },
  { id: 'study_group', label: 'Join a study group', hint: 'Group reading around specific texts' },
  { id: 'development', label: 'Software development', hint: 'Code, tools, API work' },
];

export default function WelcomeForm() {
  const router = useRouter();
  const { update } = useSession();
  const [languages, setLanguages] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');

  const toggleLanguage = (lang: string) => {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]);
  };
  const toggleInterest = (id: string) => {
    setInterests(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const send = async (payload: object) => {
    setStatus('submitting');
    try {
      const res = await fetch('/api/me/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      // Refresh session so needsWelcome flips to false and WelcomeGate stops firing.
      await update();
      router.push('/');
      router.refresh();
    } catch {
      setStatus('error');
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    send({ languages, interests, message: message.trim() });
  };

  const handleSkip = () => send({ skip: true });

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-xl p-6 md:p-8 space-y-6">
      <div>
        <label className="block text-base font-medium text-stone-800 mb-2">
          Languages you read
          <span className="font-normal text-stone-500 ml-1">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map(lang => (
            <button
              key={lang}
              type="button"
              onClick={() => toggleLanguage(lang)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors border ${
                languages.includes(lang)
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-base font-medium text-stone-800 mb-2">
          What sounds interesting?
          <span className="font-normal text-stone-500 ml-1">(optional)</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {INTERESTS.map(interest => (
            <label
              key={interest.id}
              className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                interests.includes(interest.id)
                  ? 'bg-accent-gold/8 border-accent-gold/30'
                  : 'bg-white border-stone-200 hover:border-stone-300'
              }`}
            >
              <input
                type="checkbox"
                checked={interests.includes(interest.id)}
                onChange={() => toggleInterest(interest.id)}
                className="mt-0.5 accent-stone-900"
              />
              <div className="leading-snug">
                <span className="text-sm font-medium text-stone-900">{interest.label}</span>
                <span className="block text-xs text-stone-500">{interest.hint}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="welcome-message" className="block text-base font-medium text-stone-800 mb-1">
          Anything else?
          <span className="font-normal text-stone-500 ml-1">(optional)</span>
        </label>
        <textarea
          id="welcome-message"
          rows={3}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="What brought you here? A text you're hunting? Anything we should know..."
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-y"
        />
      </div>

      <div className="flex items-center justify-between pt-2">
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
          className="bg-stone-900 text-white py-2.5 px-6 rounded-full hover:bg-stone-800 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {status === 'submitting' ? 'Saving...' : 'Save & start reading'}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-sm text-status-error">Something went wrong. Try again or skip for now.</p>
      )}
    </form>
  );
}
