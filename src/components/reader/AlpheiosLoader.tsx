'use client';

/**
 * PROTOTYPE (#3823): load the Alpheios embedded reading tools on original-
 * language pages, instead of our own popover. Alpheios provides dictionary
 * entries, full morphology, inflection tables, and grammar links for Latin
 * and Ancient Greek — the mature learner/scholar toolset (ISC license,
 * actively maintained, https://alpheios.net).
 *
 * The pane it activates on must carry class="alpheios-enabled" and a lang
 * attribute Alpheios recognizes ('lat' / 'grc'). Loads from jsDelivr CDN —
 * fine for a dev prototype; a production ship should vendor the bundles
 * (self-host via npm) so we're not executing third-party-mutable script.
 */

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    AlpheiosEmbed?: {
      importDependencies: (opts: { mode: string }) => Promise<new (opts: { clientId: string | null }) => { activate: () => void }>;
    };
    __alpheiosActive?: boolean;
  }
}

export default function AlpheiosLoader({ enabled }: { enabled: boolean }) {
  const attempted = useRef(false);

  useEffect(() => {
    if (!enabled || attempted.current || window.__alpheiosActive) return;
    attempted.current = true;

    if (!document.querySelector('link[data-alpheios-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/alpheios-components@latest/dist/style/style-components.min.css';
      link.setAttribute('data-alpheios-css', '1');
      document.head.appendChild(link);
    }

    import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/alpheios-embedded@latest/dist/alpheios-embedded.min.js' as string)
      .then(() => window.AlpheiosEmbed?.importDependencies({ mode: 'cdn' }))
      .then((Embedded) => {
        if (!Embedded) throw new Error('AlpheiosEmbed missing');
        new Embedded({ clientId: 'sourcelibrary-prototype' }).activate();
        window.__alpheiosActive = true;
      })
      .catch((e) => console.error('[alpheios] load failed:', e));
  }, [enabled]);

  return null;
}
