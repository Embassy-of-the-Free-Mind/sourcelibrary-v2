import { getLibraryStats, roundedCountLabel } from '@/lib/library-stats';
import BetaLandingClient, { type BetaStats } from './BetaLandingClient';

// Server wrapper: reads the daily-refreshed homepage_stats cache once (ISR/edge
// cached, so not per-visit) and passes the headline numbers to the client
// landing page. No client-side fetch — the stats render in the initial HTML.
export default async function BetaPage() {
  const s = await getLibraryStats();
  const stats: BetaStats = s
    ? {
        books: roundedCountLabel(s.books),
        languages: `${Math.floor(s.languages / 10) * 10}+`,
        illustrations: `${Math.floor(s.illustrations / 1000)}K+`,
      }
    : { books: '10,000+', languages: '100+', illustrations: '74K+' };

  return <BetaLandingClient stats={stats} />;
}
