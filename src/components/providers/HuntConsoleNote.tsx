'use client';

import { useEffect } from 'react';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { HUNT_DOOR_LINES } from '@/lib/hunt-doors';

/**
 * The console door of the hunt (#8150 slice 4): one note in the browser console for whoever opens
 * the developer tools. Global site only: partner reading rooms and embeds stay quiet, because the
 * hunt runs through the global library and /hunt is not served on a partner subdomain.
 */
let shown = false;

export default function HuntConsoleNote() {
  const isEmbedded = useIsEmbedded();
  useEffect(() => {
    if (shown || isEmbedded) return;
    const host = window.location.hostname;
    if (host !== 'sourcelibrary.org' && host !== 'www.sourcelibrary.org' && host !== 'localhost') return;
    shown = true;
    console.info(`%cSource Library\n%c${HUNT_DOOR_LINES.join('\n')}`, 'font-weight:bold;font-size:14px', 'font-size:12px');
  }, [isEmbedded]);
  return null;
}
