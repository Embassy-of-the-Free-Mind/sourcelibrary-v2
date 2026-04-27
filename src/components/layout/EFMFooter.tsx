/**
 * Minimal EFM (Embassy of the Free Mind) footer for embedded contexts
 * Shown when Source Library is embedded in EFM Webflow site
 */

'use client';

import Link from 'next/link';

export default function EFMFooter() {
  return (
    <footer className="bg-stone-900 text-stone-300 border-t border-stone-800 mt-12">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          <div>
            <h3 className="font-serif font-bold text-white mb-3">
              Bibliotheca Philosophica Hermetica
            </h3>
            <p className="text-xs text-stone-400">
              Digitized and translated rare historical texts
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-2 text-sm">Browse</h4>
            <ul className="space-y-1 text-sm">
              <li><Link href="/search" className="hover:text-white transition">Search</Link></li>
              <li><Link href="/collection-areas" className="hover:text-white transition">Areas</Link></li>
              <li><Link href="/collections" className="hover:text-white transition">Collections</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-2 text-sm">About</h4>
            <ul className="space-y-1 text-sm">
              <li><a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Library Website</a></li>
              <li><Link href="/about" className="hover:text-white transition">About</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-stone-800 pt-4 text-xs text-stone-500 flex items-center justify-between">
          <p>&copy; 2024 Bibliotheca Philosophica Hermetica</p>
          <p>Powered by <Link href="https://sourcelibrary.org" target="_blank" rel="noopener noreferrer" className="text-stone-400 hover:text-stone-300">Source Library</Link></p>
        </div>
      </div>
    </footer>
  );
}
