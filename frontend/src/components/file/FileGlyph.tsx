interface FileGlyphProps {
  label: string;
  className: string;
}

export function FileGlyph({ label, className }: FileGlyphProps) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[9px] font-semibold uppercase ${className}`}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}
