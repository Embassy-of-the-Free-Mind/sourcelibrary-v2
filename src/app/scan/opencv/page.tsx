'use client';

import { useState, useEffect, useMemo } from 'react';
import AutoScanFlow from '@/components/scan/AutoScanFlow';
import { createOpenCVEdgeDetector } from '@/lib/scan/opencv-edge-detection';
import type { EdgeDetector } from '@/lib/scan/edge-detection-types';

type LoadingState = 'loading' | 'ready' | 'error';

export default function OpenCVScanPage() {
  const edgeDetector = useMemo(() => createOpenCVEdgeDetector(), []);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadWasm() {
      try {
        await edgeDetector.init();
        if (!cancelled) {
          setLoadingState('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : 'Failed to load OpenCV.js');
          setLoadingState('error');
        }
      }
    }

    loadWasm();

    return () => {
      cancelled = true;
    };
  }, [edgeDetector]);

  if (loadingState === 'loading') {
    return (
      <div className="fixed inset-0 bg-dark flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-sm">
          <span className="block w-10 h-10 mx-auto border-3 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white text-base font-medium">Loading OpenCV.js...</p>
          <p className="text-white/50 text-sm">
            Downloading edge detection engine (~8 MB)
          </p>
        </div>
      </div>
    );
  }

  if (loadingState === 'error') {
    return (
      <div className="fixed inset-0 bg-dark flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-12 h-12 mx-auto rounded-full bg-status-error/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-white text-base font-medium">Failed to load OpenCV.js</p>
          <p className="text-white/50 text-sm">{errorMessage}</p>
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={() => {
                setLoadingState('loading');
                setErrorMessage('');
                edgeDetector.init()
                  .then(() => setLoadingState('ready'))
                  .catch((err) => {
                    setErrorMessage(err instanceof Error ? err.message : 'Failed to load OpenCV.js');
                    setLoadingState('error');
                  });
              }}
              className="py-3 bg-white/10 text-white rounded-lg text-sm font-medium"
            >
              Retry
            </button>
            <a
              href="/scan/auto"
              className="py-3 border border-white/20 text-white/70 rounded-lg text-sm font-medium text-center"
            >
              Use lightweight scanner instead
            </a>
          </div>
        </div>
      </div>
    );
  }

  return <AutoScanFlow edgeDetector={edgeDetector} />;
}
