'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { getConsent, type ConsentState } from '@/lib/consent';
import { useIsEmbedded } from '@/hooks/useEmbedContext';

// GA4 measurement ID, sourced from env so we can point at a Source
// Library-owned property without a code change. The literal fallback is the
// legacy property that lives under the PlayPower Labs GA account — keep it
// only until NEXT_PUBLIC_GA_ID is set in Vercel, then it's dead weight.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-C1QJNTSZT2';
const AHREFS_KEY = 'rzuKlnvyAKd8TdooDnPSYg';
const POSTHOG_KEY = 'phc_b6JJdGHB6YKKhjfPEKn3YLbsYmwAcWliAR3F8jbFch8';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

/**
 * Loads our analytics scripts with the right consent posture.
 *
 * Google Analytics uses **Consent Mode v2**: gtag.js loads on page entry with
 * all storage denied by default, so the automatic `session_start` / `page_view`
 * fires on the true landing page (cookieless) and captures the real referrer /
 * UTM. On "Accept" we upgrade `analytics_storage` to 'granted'. This is what
 * fixes the high rate of "(not set)" traffic sources we saw with the old
 * accept-gated late load: previously gtag didn't load until the user clicked
 * Accept — often after client-side navigation — so the landing attribution was
 * already gone and GA recorded the source as "(not set)".
 *
 * Ahrefs and PostHog stay strictly accept-gated (load only after "Accept") —
 * unchanged from before. Tenant subdomains and /embed/ routes are closed
 * partner reading rooms, so we load NO Source Library analytics there at all.
 */
export default function AnalyticsScripts() {
  const isEmbedded = useIsEmbedded();
  const [consent, setConsentState] = useState<ConsentState>(null);

  useEffect(() => {
    setConsentState(getConsent());

    const handler = (e: Event) => {
      setConsentState((e as CustomEvent<ConsentState>).detail);
    };
    window.addEventListener('sl_consent_change', handler);
    return () => window.removeEventListener('sl_consent_change', handler);
  }, []);

  // Propagate live consent changes to GA's Consent Mode. The initial state
  // (incl. returning visitors who already accepted) is handled inside the
  // ga-init script below, which reads localStorage synchronously and sets the
  // consent defaults in the correct order. By the time a user can click
  // Accept/Decline, gtag is already loaded — so we only act when it exists,
  // avoiding an out-of-order `update`-before-`default` push.
  useEffect(() => {
    if (isEmbedded || consent === null) return;
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    window.gtag('consent', 'update', {
      analytics_storage: consent === 'accepted' ? 'granted' : 'denied',
    });
  }, [consent, isEmbedded]);

  // Closed partner reading rooms get no Source Library analytics (and no
  // third-party-iframe pings to Google from inside a partner's site).
  if (isEmbedded) return null;

  return (
    <>
      {/* Google Analytics — Consent Mode v2, loaded on entry (not accept-gated).
          The init script reads consent from localStorage synchronously so a
          returning visitor's grant is applied before `config` fires, in order:
          default(denied) → [update(granted) if already accepted] → js → config.
          Storage key 'sl_analytics_consent' mirrors STORAGE_KEY in src/lib/consent.ts. */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
            wait_for_update: 500
          });
          try {
            if (localStorage.getItem('sl_analytics_consent') === 'accepted') {
              gtag('consent', 'update', { analytics_storage: 'granted' });
            }
          } catch (e) {}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
      {/* Ahrefs + PostHog stay strictly consent-gated: load only after "Accept". */}
      {consent === 'accepted' && (
        <>
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
            capture_pageleave: true,
            // Full session replay. We only reach this code path after the user
            // clicks "Accept" on the consent banner, so recording is consent-gated
            // by construction. Capture everything: unmask all text + inputs so we
            // see exactly what readers see (search queries, navigation, scroll).
            // Passwords are always masked by PostHog regardless of this config.
            disable_session_recording: false,
            session_recording: {
              maskAllInputs: false,
              maskTextSelector: undefined,
              maskInputOptions: { password: true },
              recordCrossOriginIframes: true,
            },
            capture_performance: true,
          });
        `}
          </Script>
        </>
      )}
    </>
  );
}
