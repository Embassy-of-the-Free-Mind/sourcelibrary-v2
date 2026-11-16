import Link from 'next/link';
import { QUALITY_LOOP } from '@/lib/admin-links';

/**
 * The quality loop's neighbouring steps (#244), one line at the top of /admin/quality and /admin/router, so each
 * page says where it sits (colours inherited, so it reads on /admin/quality's own theme): the page shown is in bold, the rest link out with the question each one answers.
 * PRIOR ART: none for a cross-page strip; the steps and their order come from QUALITY_LOOP in src/lib/admin-links.ts.
 */
export default function QualityLoopLinks({ current }: { current: string }) {
  return (
    <nav aria-label="Quality loop" className="text-xs leading-relaxed">
      <span className="uppercase tracking-wider mr-1.5 opacity-60">Quality loop</span>
      {QUALITY_LOOP.map((s, i) => (
        <span key={s.href}>
          {i > 0 && <span className="mx-1 opacity-40">→</span>}
          {s.href === current
            ? <span className="font-semibold">{s.label}</span>
            : <Link href={s.href} className="text-accent-rust hover:underline">{s.label}</Link>}
          <span className="opacity-60">: {s.question}{s.gate === 'superadmin' ? ' (super-admin)' : ''}</span>
        </span>
      ))}
    </nav>
  );
}
