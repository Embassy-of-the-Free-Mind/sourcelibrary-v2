import { redirect } from 'next/navigation';

// Types became two pages, each answering one question: Kinds of pictures and Kinds of books.
export default function Page() {
  redirect('/revamp/kinds/pictures');
}
