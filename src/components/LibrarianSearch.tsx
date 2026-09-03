'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight } from 'lucide-react';

/**
 * Search box for the "Ask the librarian" section. Submits the typed question to
 * the full librarian (/librarian?q=…, which auto-runs it) so it isn't retyped.
 * Results are NOT limited to the collection — the librarian searches everything.
 */
export default function LibrarianSearch({ placeholder = 'Ask the librarian a question…' }: { placeholder?: string }) {
  const [q, setQ] = useState('');
  const router = useRouter();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    router.push(v ? `/librarian?q=${encodeURIComponent(v)}` : '/librarian');
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-3 bg-white border border-border-light px-5 py-3.5 rounded-lg max-w-md focus-within:border-accent-rust/50 transition-colors">
      <Search className="w-5 h-5 text-muted shrink-0" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label="Ask the librarian"
        className="flex-1 min-w-0 bg-transparent text-base sm:text-sm text-primary placeholder-muted focus:outline-none"
      />
      <button type="submit" aria-label="Ask" className="shrink-0 text-muted hover:text-accent-rust transition-colors">
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}
