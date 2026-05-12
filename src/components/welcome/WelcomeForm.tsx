'use client';

import { useState, FormEvent, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

const COMMON_LANGUAGES = [
  'Latin', 'Ancient Greek', 'German', 'Arabic', 'Hebrew',
  'Sanskrit', 'Chinese', 'French', 'Italian', 'Dutch',
];

export default function WelcomeForm() {
  const router = useRouter();
  const { update } = useSession();
  const [languages, setLanguages] = useState<string[]>([]);
  const [languageInput, setLanguageInput] = useState('');
  const [interests, setInterests] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');

  const addLanguage = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return;
    setLanguages(prev => prev.includes(cleaned) ? prev : [...prev, cleaned]);
  };

  const removeLanguage = (lang: string) => {
    setLanguages(prev => prev.filter(l => l !== lang));
  };

  const toggleCommon = (lang: string) => {
    if (languages.includes(lang)) removeLanguage(lang);
    else addLanguage(lang);
  };

  const handleLanguageKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addLanguage(languageInput);
      setLanguageInput('');
    } else if (e.key === 'Backspace' && languageInput === '' && languages.length > 0) {
      removeLanguage(languages[languages.length - 1]);
    }
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
      await update();
      router.push('/');
      router.refresh();
    } catch {
      setStatus('error');
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Commit any pending language tag before submit
    const finalLanguages = languageInput.trim()
      ? Array.from(new Set([...languages, languageInput.trim()]))
      : languages;
    send({
      languages: finalLanguages,
      interests: interests.trim(),
      help_description: helpDescription.trim(),
    });
  };

  const handleSkip = () => send({ skip: true });

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-xl p-6 md:p-8 space-y-7">
      {/* Languages */}
      <div>
        <label htmlFor="lang-input" className="block text-base font-medium text-stone-800 mb-1">
          Languages you read
        </label>
        <p className="text-sm text-stone-500 mb-3">
          Type any language and press Enter, or tap the suggestions below.
        </p>

        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border border-stone-300 rounded-lg focus-within:border-accent-rust focus-within:ring-2 focus-within:ring-accent-rust/30 transition-colors">
          {languages.map(lang => (
            <span
              key={lang}
              className="inline-flex items-center gap-1 bg-stone-900 text-white text-sm pl-2.5 pr-1 py-1 rounded-full"
            >
              {lang}
              <button
                type="button"
                onClick={() => removeLanguage(lang)}
                aria-label={`Remove ${lang}`}
                className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          <input
            id="lang-input"
            type="text"
            value={languageInput}
            onChange={e => setLanguageInput(e.target.value)}
            onKeyDown={handleLanguageKeyDown}
            onBlur={() => {
              if (languageInput.trim()) {
                addLanguage(languageInput);
                setLanguageInput('');
              }
            }}
            placeholder={languages.length === 0 ? 'e.g. Latin, Coptic, Tagalog…' : ''}
            className="flex-1 min-w-[140px] px-1.5 py-1 bg-transparent text-sm text-stone-900 placeholder-stone-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {COMMON_LANGUAGES.map(lang => {
            const selected = languages.includes(lang);
            return (
              <button
                key={lang}
                type="button"
                onClick={() => toggleCommon(lang)}
                className={`px-2.5 py-1 rounded-full text-xs transition-colors border ${
                  selected
                    ? 'bg-stone-100 text-stone-400 border-stone-200 line-through'
                    : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400 hover:text-stone-800'
                }`}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </div>

      {/* Interests */}
      <div>
        <label htmlFor="interests" className="block text-base font-medium text-stone-800 mb-1">
          What interests you about Source Library?
        </label>
        <p className="text-sm text-stone-500 mb-2">
          Authors, traditions, time periods, questions you&rsquo;re chasing — anything.
        </p>
        <textarea
          id="interests"
          rows={3}
          value={interests}
          onChange={e => setInterests(e.target.value)}
          placeholder="e.g. Hermetic texts, the Florentine Platonists, Arabic alchemy, early modern medicine…"
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-y"
        />
      </div>

      {/* How they'd like to help */}
      <div>
        <label htmlFor="help-description" className="block text-base font-medium text-stone-800 mb-1">
          How would you like to help?
          <span className="font-normal text-stone-500 ml-1">(if you&rsquo;d like to)</span>
        </label>
        <p className="text-sm text-stone-500 mb-2">
          Reviewing translations, annotating texts, suggesting books, writing, coding, study groups — or something else entirely.
        </p>
        <textarea
          id="help-description"
          rows={3}
          value={helpDescription}
          onChange={e => setHelpDescription(e.target.value)}
          placeholder="In your own words…"
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-y"
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
          className="bg-stone-900 text-white py-2.5 px-6 rounded-full hover:bg-stone-800 transition-colors text-sm font-medium disabled:opacity-50"
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
