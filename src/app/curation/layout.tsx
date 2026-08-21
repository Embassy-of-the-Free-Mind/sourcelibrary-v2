import { requireInnerCircle } from '@/lib/auth-helpers';
import Link from 'next/link';

/**
 * /curation/* — surfaces for invited adjudicators (#3846): scoped strictly
 * below the admin tree. Access = superadmin OR a global inner-circle
 * membership doc; see requireInnerCircle. Listed in tenant-global-paths so
 * partner subdomains refuse the whole prefix.
 */
export default async function CurationLayout({ children }: { children: React.ReactNode }) {
  await requireInnerCircle();
  return (
    <div>
      <div className="border-b border-stone-200 bg-stone-50 px-6 py-2 text-sm text-stone-500">
        <Link href="/" className="hover:text-stone-800">Source Library</Link>
        <span className="mx-2 text-stone-300">/</span>
        <span className="text-stone-700">Curation</span>
      </div>
      {children}
    </div>
  );
}
