'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';

/**
 * Wrapper that defers Toaster rendering until after hydration.
 * Prevents React #418 hydration mismatch from sonner's SSR output
 * differing from its client-side output.
 */
export default function ClientToaster() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Toaster position="bottom-right" richColors closeButton />;
}
