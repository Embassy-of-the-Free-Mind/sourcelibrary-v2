'use client';

import { useEffect, useCallback } from 'react';
import ErrorBoundary from './ErrorBoundary';

function reportError(data: {
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
