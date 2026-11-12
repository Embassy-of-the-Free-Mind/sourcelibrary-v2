import { redirect } from 'next/navigation';

// Types became two pages, each answering one question: Types of pictures and Types of texts.
export default function Page() {
  redirect('/revamp/types/pictures');
}
