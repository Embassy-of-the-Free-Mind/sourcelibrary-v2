import { Suspense } from 'react';
import SearchPage from '../[tenant]/search/page';

export default function RootSearchPage() {
    return (
        <Suspense>
            <SearchPage />
        </Suspense>
    );
}
