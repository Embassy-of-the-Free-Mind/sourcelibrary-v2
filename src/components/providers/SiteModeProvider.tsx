'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { SiteModeConfig, getClientSiteMode } from '@/lib/site-mode';

const SiteModeContext = createContext<SiteModeConfig | null>(null);

interface SiteModeProviderProps {
  children: ReactNode;
  initialMode?: SiteModeConfig;
}

export function SiteModeProvider({ children, initialMode }: SiteModeProviderProps) {
  const [config, setConfig] = useState<SiteModeConfig>(
    initialMode || {
      mode: 'library',
      isSociety: false,
      isLibrary: true,
      siteName: 'Source Library',
      siteDescription: 'Digitizing and translating rare Hermetic and esoteric texts',
    }
  );

  useEffect(() => {
    // Only re-check on client if we might be on a society domain.
    // For sourcelibrary.org (99.9% of traffic), the default library config
    // is already correct — skip the setState to avoid a full-tree re-render
    // during hydration that can cause React error #418.
    const clientMode = getClientSiteMode();
    if (clientMode.mode !== config.mode) {
      setConfig(clientMode);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SiteModeContext.Provider value={config}>
      {children}
    </SiteModeContext.Provider>
  );
}

export function useSiteMode(): SiteModeConfig {
  const context = useContext(SiteModeContext);
  if (!context) {
    throw new Error('useSiteMode must be used within a SiteModeProvider');
  }
  return context;
}
