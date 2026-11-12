import { redirect } from 'next/navigation';

// Renamed: Kinds of texts (scrolls, tablets and papyri are texts but not books).
export default function Page() {
  redirect('/revamp/kinds/texts');
}
