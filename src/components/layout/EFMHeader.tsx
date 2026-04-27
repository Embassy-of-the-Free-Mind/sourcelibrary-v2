/**
 * Minimal EFM (Embassy of the Free Mind) header for embedded contexts
 * Shown when Source Library is embedded in EFM Webflow site
 */

'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';

export default function EFMHeader() {
    return (
        <header className="bg-white border-b border-stone-200">
            <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                <Link href="/" className="font-serif font-bold text-lg">
                    Bibliotheca Philosophica Hermetica
                </Link>
                <nav className="hidden md:flex gap-6 text-sm">
                    <Link href="/search" className="text-stone-600 hover:text-primary">
                        Browse
                    </Link>
                    <Link href="/collection-areas" className="text-stone-600 hover:text-primary">
                        Areas
                    </Link>
                </nav>
                <button className="md:hidden">
                    <Menu className="w-5 h-5" />
                </button>
            </div>
        </header>
    );
}
