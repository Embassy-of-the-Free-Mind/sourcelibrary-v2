'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';

// Minimal PostHog shape we touch — the global is installed by the snippet in
// AnalyticsScripts.tsx (and queues calls before the lib finishes loading).
type PostHogLike = {
  identify: (id: string, props?: Record<string, unknown>) => void;
  reset: () => void;
  get_distinct_id?: () => string;
};

function getPostHog(): PostHogLike | undefined {
  return (window as unknown as { posthog?: PostHogLike }).posthog;
}

/**
 * Links the signed-in member to their PostHog profile so anonymous analytics +
 * session replay become attributable ("what did this member read/do?").
 *
 * - On sign-in: posthog.identify(userId, { email, name }) — once per user id.
 * - On sign-out: posthog.reset() so the next visitor on a shared device starts
 *   a fresh anonymous identity (no cross-account bleed).
 *
 * PostHog only exists when AnalyticsScripts mounted it (i.e. not on tenant/embed
 * reading rooms, where it returns null) — so every call is guarded. The init
 * snippet stubs `identify`/`reset` and queues them, but the global itself can
 * lag this component by a tick, so we retry briefly until it appears.
 */
export default function PostHogIdentify() {
  const { data: session, status } = useSession();
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    const userId = session?.user?.id;

    // Signed in — identify once per distinct user id.
    if (status === 'authenticated' && userId && identifiedId.current !== userId) {
      let attempts = 0;
      const tryIdentify = () => {
        const ph = getPostHog();
        if (!ph) {
          if (attempts++ < 20) setTimeout(tryIdentify, 250); // up to ~5s
          return;
        }
        ph.identify(userId, {
          email: session.user?.email ?? undefined,
          name: session.user?.name ?? undefined,
        });
        identifiedId.current = userId;
      };
      tryIdentify();
      return;
    }

    // Signed out after having been identified — reset so the device's next
    // anonymous session isn't attributed to the previous member.
    if (status === 'unauthenticated' && identifiedId.current) {
      getPostHog()?.reset();
      identifiedId.current = null;
    }
  }, [session, status]);

  return null;
}
