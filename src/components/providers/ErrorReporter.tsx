'use client';

import { useEffect, useCallback } from 'react';
import ErrorBoundary from './ErrorBoundary';

export function reportError(data: {
  message: string;
  stack?: string;
  source: string;
  componentStack?: string;
}) {
  try {
    const payload = {
      ...data,
      url: window.location.href,
      userAgent: navigator.userAgent,
    };
    // Use sendBeacon for reliability (works even during page unload)
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (!navigator.sendBeacon('/api/errors', blob)) {
      // Fallback to fetch if sendBeacon fails
      fetch('/api/errors', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    }

    // Mirror into PostHog Error Tracking. The win over the Mongo /api/errors
    // pipeline above is correlation: a captured exception links to the session
    // replay of the visit it happened in, plus PostHog's grouping/trends/alerts.
    // This is the SINGLE client-error funnel (window.onerror, unhandledrejection
    // and the React boundary all route through reportError), so we deliberately
    // do NOT enable PostHog exception autocapture — that would double-count.
    // Capture respects the same Decline opt-out that gates all PostHog capture.
    const ph = (window as unknown as {
      posthog?: { captureException?: (e: unknown, p?: Record<string, unknown>) => void };
    }).posthog;
    if (ph && typeof ph.captureException === 'function') {
      const err = new Error(data.message);
      if (data.stack) err.stack = data.stack;
      ph.captureException(err, {
        error_source: data.source,
        component_stack: data.componentStack,
        page_url: window.location.href,
      });
    }
  } catch {
    // Silently fail — error reporting should never cause errors
  }
}

function ErrorListeners() {
  const handleWindowError = useCallback((event: ErrorEvent) => {
    reportError({
      message: event.message || 'Unknown error',
      stack: event.error?.stack,
      source: 'window.onerror',
    });
  }, []);

  const handleUnhandledRejection = useCallback((event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportError({
      message: reason?.message || String(reason) || 'Unhandled promise rejection',
      stack: reason?.stack,
      source: 'unhandledrejection',
    });
  }, []);

  useEffect(() => {
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [handleWindowError, handleUnhandledRejection]);

  return null;
}

export default function ErrorReporter({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        reportError({
          message: error.message,
          stack: error.stack,
          source: 'react_error_boundary',
          componentStack: errorInfo.componentStack || undefined,
        });
      }}
    >
      <ErrorListeners />
      {children}
    </ErrorBoundary>
  );
}
