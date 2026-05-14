'use client';

import { SessionProvider } from 'next-auth/react';
import { SiteModeProvider } from './SiteModeProvider';
import { SiteModeConfig } from '@/lib/site-mode';
import ErrorReporter from './ErrorReporter';
import MigrateOnSignIn from '@/components/auth/MigrateOnSignIn';
import WelcomeGate from '@/components/auth/WelcomeGate';

interface ProvidersProps {
  children: React.ReactNode;
  siteMode?: SiteModeConfig;
}

export default function Providers({ children, siteMode }: ProvidersProps) {
  return (
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      <SiteModeProvider initialMode={siteMode}>
        <ErrorReporter>
          <MigrateOnSignIn />
          <WelcomeGate />
          {children}
        </ErrorReporter>
      </SiteModeProvider>
    </SessionProvider>
  );
}
