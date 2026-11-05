import { SibuIndex, sibuIndexMetadata } from '@/components/sibu/SibuPages';

export const metadata = sibuIndexMetadata('en');

export default function SibuPage() {
  return <SibuIndex lang="en" />;
}
