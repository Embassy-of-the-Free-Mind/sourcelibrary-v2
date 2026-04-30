import BlogTableOfContents from '@/components/blog/BlogTableOfContents';

export const dynamic = 'force-dynamic';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BlogTableOfContents />
    </>
  );
}
