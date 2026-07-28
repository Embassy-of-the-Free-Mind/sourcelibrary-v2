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

  // PostHog loads on entry for everyone (see below) and captures by default.
  // Honor an explicit "Decline": opt the user out of all capture + recording.
  // Undecided (null) and "accepted" both stay opted in — that's the point of
  // pre-consent loading. opt_in/opt_out are queued safely by the init stub.
  useEffect(() => {
    if (isEmbedded || consent === null) return;
    const ph = (window as unknown as { posthog?: { opt_in_capturing?: () => void; opt_out_capturing?: () => void } }).posthog;
    if (!ph || typeof ph.opt_out_capturing !== 'function') return;
    if (consent === 'declined') ph.opt_out_capturing();
    else ph.opt_in_capturing?.();
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
      {/* Ahrefs stays strictly consent-gated: loads only after "Accept". */}
      {consent === 'accepted' && (
        <Script
          src="https://analytics.ahrefs.com/analytics.js"
          data-key={AHREFS_KEY}
          strategy="lazyOnload"
        />
      )}
      {/* PostHog loads on entry for ALL visitors (not accept-gated), so product
          analytics + session replay capture the full audience, not just the
          self-selected slice who click Accept. It captures by default; an
          explicit "Decline" is honored via opt_out_capturing in the effect
          above. Closed partner reading rooms are already excluded (isEmbedded
          early-return). */}
      <Script id="posthog-init" strategy="afterInteractive">
        {`
          !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageviewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
          // Session-replay sampling: record ~30% of loads to stay under the
          // PostHog free tier (5K web replays/cycle; full capture overshot at
          // ~8K). The roll runs in the BROWSER, not at render time — rendering
          // it server-side would bake one value into the 24h edge-cached HTML
          // and hand every cached visitor the same decision. Analytics events
          // are unaffected; only the replay recording is gated.
          var _slRecordSession = Math.random() < 0.3;
          // Automated-browser gate (#3400). A headless fleet executing our
          // reader was producing ~35K "users"/day of one-hit sessions — enough
          // to make PostHog report traffic TRIPLING over a month in which real
          // human traffic actually fell 4x. Server-side filtering can't help
          // here: these loads never reach /api/track, and their user-agents are
          // spoofed desktop Chrome (an impossible 50/50 Windows/Mac split), so
          // UA matching won't catch them either.
          //
          // navigator.webdriver is the W3C-standard flag set by every
          // automation driver (Puppeteer/Playwright/Selenium) and is never true
          // in an ordinary browser, so it cannot false-positive a real reader.
          // Empty navigator.languages is a second headless tell.
          //
          // We skip posthog.init OUTRIGHT rather than passing a config option:
          // an unsupported option would be ignored silently and ship as a
          // no-op, which is the exact failure class this fix exists to correct.
          var _slAutomated = (function () {
            try {
              if (navigator.webdriver === true) return true;
              if (!navigator.languages || navigator.languages.length === 0) return true;
              return false;
            } catch (e) { return false; }
          })();
          if (!_slAutomated) posthog.init('${POSTHOG_KEY}', {
            api_host: '${POSTHOG_HOST}',
            person_profiles: 'identified_only',
            capture_pageview: true,
            capture_pageleave: true,
            // Session replay for the sampled ~30% (loaded pre-consent; explicit
            // Decline is honored via opt_out in the effect above).
            // Capture everything: unmask all text + inputs so we see exactly what
            // readers see (search queries, navigation, scroll). Passwords are
            // always masked by PostHog regardless of this config.
            disable_session_recording: !_slRecordSession,
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
  );
}
