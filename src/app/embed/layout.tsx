import type { Metadata } from 'next';
import { TenantLayoutWrapper } from '@/components/tenant/TenantLayoutWrapper';
import EmbedResizeReporter from '@/components/embed/EmbedResizeReporter';
import EmbedNavigationOverlay from '@/components/embed/EmbedNavigationOverlay';
import EmbedUserMenu from '@/components/embed/EmbedUserMenu';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Synchronous cookie reader. Runs during HTML parsing before any of the
// gated sections render, so toggling the menu options never produces a
// flash of unstyled content. The CSS rules in globals.css consume the
// data attributes set here. Kept inline + minified so it ships in the
// initial HTML payload without needing a separate script request.
const VIEW_MODE_INIT_SCRIPT = `(function(){var c=document.cookie;if(/(?:^|; )sl_hide_ai=1/.test(c))document.documentElement.dataset.slHideAi='1';if(/(?:^|; )sl_hide_guide=1/.test(c))document.documentElement.dataset.slHideGuide='1';})();`;

/**
 * Layout for embed routes. Adds data-embed attribute to hide
 * SiteHeader, GlobalFooter, and other chrome via CSS.
 * The root layout still wraps this — we just signal "embed mode".
 * EmbedUserMenu is a small floating sign-in / sign-out affordance
 * because the SiteHeader is stripped on embed pages.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantLayoutWrapper>
      <script dangerouslySetInnerHTML={{ __html: VIEW_MODE_INIT_SCRIPT }} />
      <div data-embed="" className="embed-mode">
        {children}
        <EmbedUserMenu />
        <EmbedResizeReporter />
        <EmbedNavigationOverlay />
      </div>
    </TenantLayoutWrapper>
  );
}
