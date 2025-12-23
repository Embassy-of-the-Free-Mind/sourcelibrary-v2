'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-stone-100 border-t border-stone-200 py-4 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-sm text-stone-500">
          <span>CC0 Public Domain</span>
          <span className="hidden sm:inline">•</span>
          <a
            href="mailto:derek@ancientwisdomtrust.org"
            className="text-amber-700 hover:text-amber-800 transition-colors"
          >
            derek@ancientwisdomtrust.org
          </a>
          <span className="hidden sm:inline">•</span>
          <Link
            href="/analytics"
            className="text-stone-400 hover:text-stone-600 transition-colors"
          >
            Analytics
          </Link>
        </div>
      </div>
    </footer>
  );
}
