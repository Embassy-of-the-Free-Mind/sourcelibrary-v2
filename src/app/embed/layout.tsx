import type { Metadata } from 'next';
import { TenantLayoutWrapper } from '@/components/tenant/TenantLayoutWrapper';
import EmbedResizeReporter from '@/components/embed/EmbedResizeReporter';
import EmbedNavigationOverlay from '@/components/embed/EmbedNavigationOverlay';
import EmbedUserMenu from '@/components/embed/EmbedUserMenu';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
      <div data-embed="" className="embed-mode">
        {children}
        <EmbedUserMenu />
        <EmbedResizeReporter />
        <EmbedNavigationOverlay />
      </div>
    </TenantLayoutWrapper>
  );
}
