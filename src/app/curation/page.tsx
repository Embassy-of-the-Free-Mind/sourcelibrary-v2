import { redirect } from 'next/navigation';

// /curation currently has one surface; land people on it directly. When a
// second curation queue arrives, replace this with an index of queues.
export default function CurationIndex() {
  redirect('/curation/identity-review');
}
