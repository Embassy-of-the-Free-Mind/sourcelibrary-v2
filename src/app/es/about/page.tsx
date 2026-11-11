import AboutView from '@/components/about/AboutView';
import { aboutMetadata } from '@/lib/about-meta';

export const revalidate = 3600;

export const metadata = aboutMetadata('es');

export default function AboutPage() {
  return <AboutView lang="es" />;
}
