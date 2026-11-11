import AboutView from '@/components/about/AboutView';
import { aboutMetadata } from '@/lib/about-meta';

export const revalidate = 3600;

export const metadata = aboutMetadata('zh');

export default function AboutPage() {
  return <AboutView lang="zh" />;
}
