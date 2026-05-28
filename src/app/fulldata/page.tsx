import { redirect } from 'next/navigation';

export default function FullDataRedirect() {
  redirect('/data?admin=true');
}
