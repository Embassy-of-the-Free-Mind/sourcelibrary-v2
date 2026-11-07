'use client';

import { useState } from 'react';
import SearchAskBars from '@/components/search-kit/SearchAskBars';

export default function SubjectSearch({ name, authors }: { name: string; authors: string[] }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <SearchAskBars
      search={{ id: 's-search', label: `Search within ${name}`, placeholder: 'Title, author, date', value: a, onChange: setA, onSubmit: () => {}, examples: authors }}
      ask={{ id: 's-ask', label: 'Ask the librarian', placeholder: 'What are you looking for?', value: b, onChange: setB, onSubmit: () => {}, examples: [`how ${name.toLowerCase()} changed over time`] }}
    />
  );
}
