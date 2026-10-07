import { redirect } from 'next/navigation';

// One system map (#5501): the component lives at /admin/system-map. This URL
// is kept because CLAUDE.md and old links name it; superadmins pass the
// /admin gate, so the redirect never strands a reader who could see this one.
export default function PlatformSystemMapRedirect() {
  redirect('/admin/system-map');
}
