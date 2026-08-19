import { redirect } from 'next/navigation';

// Moved to /curation/identity-review (#3846) so inner-circle reviewers can
// reach it without superadmin. Admins keep their old links working.
export default function IdentityReviewMoved() {
  redirect('/curation/identity-review');
}
