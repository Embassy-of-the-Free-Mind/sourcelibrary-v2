'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { getConsent, type ConsentState } from '@/lib/consent';

const GA_ID = 'G-C1QJNTSZT2';
const AHREFS_KEY = 'rzuKlnvyAKd8TdooDnPSYg';

/**
 * Conditionally loads Google Analytics and Ahrefs only after the user accepts cookies.
 * Re-checks on consent change events so scripts load immediately on "Accept".
 */
export default function AnalyticsScripts() {
  const [consent, setConsentState] = useState<ConsentState>(null);

  useEffect(() => {
    setConsentState(getConsent());

    const handler = (e: Event) => {
      setConsentState((e as CustomEvent<ConsentState>).detail);
    };
    window.addEventListener('sl_consent_change', handler);
    return () => window.removeEventListener('sl_consent_change', handler);
  }, []);

  if (consent !== 'accepted') return null;

  return (
    <>
      {/* Google Analytics */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
      {/* Ahrefs */}
      <Script
        src="https://analytics.ahrefs.com/analytics.js"
        data-key={AHREFS_KEY}
        strategy="lazyOnload"
      />
    </>
  );
}
