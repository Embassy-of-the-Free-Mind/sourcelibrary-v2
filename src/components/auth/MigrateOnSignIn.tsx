'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { getStoredVisitorId, clearStoredVisitorId } from '@/hooks/useIdentity';

const MIGRATED_KEY = 'sl_migration_done';

/**
 * Runs once after sign-in: migrates anonymous likes/bookshelf to the authenticated account.
 * Fire-and-forget — doesn't block rendering or show UI.
 */
export default function MigrateOnSignIn() {
  const { data: session, status } = useSession();
  const migrating = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;
    if (migrating.current) return;

    // Already migrated this browser
    if (localStorage.getItem(MIGRATED_KEY)) return;

    const visitorId = getStoredVisitorId();
    if (!visitorId || visitorId === session.user.id) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return;
    }

    migrating.current = true;

    fetch('/api/account/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId }),
    })
      .then(res => res.json())
      .then(() => {
        clearStoredVisitorId();
        localStorage.setItem(MIGRATED_KEY, '1');
        // Clear the anonymous like count so nudge doesn't re-appear
        localStorage.removeItem('sl_anon_like_count');
      })
      .catch(() => {
        // Migration failed — will retry next page load
        migrating.current = false;
      });
  }, [session, status]);

  return null;
}
