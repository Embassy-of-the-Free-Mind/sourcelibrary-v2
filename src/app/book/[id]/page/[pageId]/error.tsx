'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { reportError } from '@/components/providers/ErrorReporter';

export default function PageEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Report to application_errors. Route-level error boundaries are NOT caught by
  // the global ErrorReporter boundary (Next.js handles them first), so without
  // this the reader's single most visible failure was invisible in the logs —
  // the browser-translation crash ran for months unmeasured.
  useEffect(() => {
    console.error('Reader page error:', error);
    reportError({
      message: error.message || 'Reader page error',
      stack: error.stack,
      source: 'reader_error_boundary',
      componentStack: error.digest ? `digest:${error.digest}` : undefined,
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-gold/15 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-accent-rust" />
        </div>
        <h2 className="text-xl font-semibold text-stone-900 mb-2">
          This page didn&apos;t load
        </h2>
        <p className="text-stone-600 mb-6">
          Something went wrong while opening this page of the book. Try again — nothing is lost.
        </p>
        {process.env.NODE_ENV === 'development' && (
          <pre className="text-left text-xs bg-stone-100 p-4 rounded-lg mb-6 overflow-auto max-h-32 text-red-700">
            {error.message}
          </pre>
        )}
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent-rust hover:bg-accent-rust/90 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
