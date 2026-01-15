'use client';

import { useSiteMode } from './SiteModeProvider';

/**
 * Visual indicator showing which site mode is active
 * Only visible in development or with ?debug=true
 */
export default function SiteModeIndicator() {
  const { mode, siteName, isSociety } = useSiteMode();

  // Only show in development or with debug flag
  const isDev = process.env.NODE_ENV === 'development';
  const hasDebug = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true';

  if (!isDev && !hasDebug) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 px-3 py-2 rounded-full text-xs font-medium shadow-lg ${
        isSociety
          ? 'bg-amber-600 text-white'
          : 'bg-stone-800 text-stone-200'
      }`}
    >
      <span className="opacity-70">Mode:</span>{' '}
      <span className="font-semibold">{siteName}</span>
      {isSociety && (
        <span className="ml-2 inline-block w-2 h-2 bg-white rounded-full animate-pulse" />
      )}
    </div>
  );
}
