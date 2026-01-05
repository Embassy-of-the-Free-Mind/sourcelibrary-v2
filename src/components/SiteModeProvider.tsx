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
    // Update on client to catch ?society=true override
    setConfig(getClientSiteMode());
  }, []);

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
