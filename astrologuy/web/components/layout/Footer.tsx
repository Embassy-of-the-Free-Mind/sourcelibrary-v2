export function Footer() {
  return (
    <footer className="border-t border-border text-center py-6 mt-12 text-faint text-xs">
      <p>
        Astronomical calculations by{" "}
        <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener" className="text-accent-gold hover:underline">
          astronomy-engine
        </a>
        . Chinese calendar by{" "}
        <a href="https://github.com/6tail/lunar-typescript" target="_blank" rel="noopener" className="text-accent-gold hover:underline">
          lunar-typescript
        </a>
        .
      </p>
      <p className="mt-1">
        Part of{" "}
        <a href="https://sourcelibrary.org" target="_blank" rel="noopener" className="text-accent-gold hover:underline">
          Source Library
        </a>
      </p>
    </footer>
  );
}
