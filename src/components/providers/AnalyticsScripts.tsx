'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { getConsent, type ConsentState } from '@/lib/consent';

const GA_ID = 'G-C1QJNTSZT2';
const AHREFS_KEY = 'rzuKlnvyAKd8TdooDnPSYg';
const POSTHOG_KEY = 'phc_b6JJdGHB6YKKhjfPEKn3YLbsYmwAcWliAR3F8jbFch8';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

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
      {/* PostHog */}
      <Script id="posthog-init" strategy="afterInteractive">
        {`
          !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageviewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
          posthog.init('${POSTHOG_KEY}', {
            api_host: '${POSTHOG_HOST}',
            person_profiles: 'identified_only',
            capture_pageview: true,
            capture_pageleave: true
          });
        `}
      </Script>
    </>
  );
}
