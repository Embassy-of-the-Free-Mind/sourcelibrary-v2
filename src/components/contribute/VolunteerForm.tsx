'use client';

import { useState, FormEvent } from 'react';

const LANGUAGES = [
  'Latin', 'Ancient Greek', 'German', 'Arabic', 'Hebrew',
  'Sanskrit', 'Chinese', 'French', 'Italian', 'Dutch',
];

const INTERESTS = [
  { id: 'translation_review', label: 'Review AI translations', description: 'Red-team our Latin, Greek, or other translations for accuracy' },
  { id: 'annotation', label: 'Annotate texts', description: 'Add scholarly context, cross-references, and notes' },
  { id: 'suggest_books', label: 'Suggest books for the collection', description: 'Recommend texts from digital archives we should import' },
  { id: 'research', label: 'Write or contribute research', description: 'Essays, close readings, or thematic explorations for the blog' },
  { id: 'study_group', label: 'Lead or join a study group', description: 'Organize group reading and discussion around specific texts' },
  { id: 'development', label: 'Software development', description: 'Contribute code, build tools, or work with our API' },
];

export default function VolunteerForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [otherLanguage, setOtherLanguage] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const toggleLanguage = (lang: string) => {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]);
  };

  const toggleInterest = (id: string) => {
    setInterests(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('submitting');

    const allLanguages = otherLanguage.trim()
      ? [...languages, otherLanguage.trim()]
      : languages;

    try {
      const res = await fetch('/api/volunteer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, languages: allLanguages, interests, message }),
      });
      if (!res.ok) throw new Error('Failed');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      /* Do not make this a dead end again. Before 2026-08-02 this screen said
         "we'll be in touch" and offered no next action, so 132 people signed up
         and none of them ever reached the review queues — which were live and
         working the whole time. Any rewrite of this screen must still hand the
         volunteer something to do in the next thirty seconds. */
      <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
        <h3 className="text-xl font-semibold text-green-900 mb-2">Thank you!</h3>
        <p className="text-green-700 mb-6">
          We read every one of these, and we&apos;ll write to you about the work that fits what you
          told us. You don&apos;t have to wait for that to start.
        </p>
        <a
          href="/review"
          className="inline-block bg-green-800 text-white py-3 px-7 rounded-full hover:bg-green-900 transition-colors text-base font-medium"
        >
          Help check a few pages now &rarr;
        </a>
        <p className="text-sm text-green-700 mt-4">
          A few seconds each, signed in so your work is yours. Or just{' '}
          <a href="/" className="underline hover:text-green-900">open a book and read</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-xl p-6 md:p-8 space-y-6">
      {/* Name & Email */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="vol-name" className="block text-base font-medium text-stone-700 mb-1">Name</label>
          <input
            id="vol-name"
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
          />
        </div>
        <div>
          <label htmlFor="vol-email" className="block text-base font-medium text-stone-700 mb-1">Email</label>
          <input
            id="vol-email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
          />
        </div>
      </div>

      {/* Interests */}
      <div>
        <label className="block text-base font-medium text-stone-700 mb-2">
          How would you like to help?
          <span className="font-normal text-stone-500 ml-1">(select all that apply)</span>
        </label>
        <div className="space-y-2">
          {INTERESTS.map(interest => (
            <label
              key={interest.id}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                interests.includes(interest.id)
                  ? 'bg-accent-gold/8 border-accent-gold/20'
                  : 'bg-white border-stone-200 hover:border-stone-300'
              }`}
            >
              <input
                type="checkbox"
                checked={interests.includes(interest.id)}
                onChange={() => toggleInterest(interest.id)}
                className="mt-0.5 accent-stone-900"
              />
              <div>
                <span className="text-base font-medium text-stone-900">{interest.label}</span>
                <p className="text-sm text-stone-500 mt-0.5">{interest.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Languages */}
      <div>
        <label className="block text-base font-medium text-stone-700 mb-2">
          Languages you read
          <span className="font-normal text-stone-500 ml-1">(select all that apply)</span>
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {LANGUAGES.map(lang => (
            <button
              key={lang}
              type="button"
              onClick={() => toggleLanguage(lang)}
              className={`px-3 py-1.5 rounded-full text-base transition-colors border ${
                languages.includes(lang)
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Other language..."
          value={otherLanguage}
          onChange={e => setOtherLanguage(e.target.value)}
          className="w-full md:w-64 px-3 py-2 border border-stone-300 rounded-lg text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
        />
      </div>

      {/* Message */}
      <div>
        <label htmlFor="vol-message" className="block text-base font-medium text-stone-700 mb-1">
          Anything else?
          <span className="font-normal text-stone-500 ml-1">(optional)</span>
        </label>
        <textarea
          id="vol-message"
          rows={3}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Your background, what texts interest you, how you'd like to contribute..."
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-y"
        />
      </div>

      {/* Submit */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="bg-stone-900 text-white py-3 px-8 rounded-full hover:bg-stone-800 transition-colors text-base font-medium disabled:opacity-50"
        >
          {status === 'submitting' ? 'Sending...' : 'Sign Up to Volunteer'}
        </button>
        {status === 'error' && (
          <span className="text-status-error text-sm">Something went wrong. Please try again or email directly.</span>
        )}
      </div>
    </form>
  );
}
