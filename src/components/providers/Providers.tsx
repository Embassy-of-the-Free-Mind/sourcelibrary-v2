'use client';

import { SessionProvider } from 'next-auth/react';
import { SiteModeProvider } from './SiteModeProvider';
import { SiteModeConfig } from '@/lib/site-mode';
import ErrorReporter from './ErrorReporter';

interface ProvidersProps {
  children: React.ReactNode;
  siteMode?: SiteModeConfig;
}

export default function Providers({ children, siteMode }: ProvidersProps) {
  return (
    <SessionProvider>
      <SiteModeProvider initialMode={siteMode}>
        <ErrorReporter>
          {children}
        </ErrorReporter>
      </SiteModeProvider>
    </SessionProvider>
  );
}
