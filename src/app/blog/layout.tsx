import BlogTableOfContents from '@/components/blog/BlogTableOfContents';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BlogTableOfContents />
    </>
  );
}
