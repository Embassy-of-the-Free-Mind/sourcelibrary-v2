import AboutView from '@/components/about/AboutView';
import { aboutMetadata } from '@/lib/about-meta';

// The hero stats come from system_config.homepage_stats, which a job refreshes
// daily at 05:00. Without a revalidate window this page was prerendered once per
// deploy and its numbers froze until the next merge.
export const revalidate = 3600;

export const metadata = aboutMetadata('en');

export default function AboutPage() {
  return <AboutView lang="en" />;
}
