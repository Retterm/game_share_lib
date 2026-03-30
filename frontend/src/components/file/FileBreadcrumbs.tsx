interface FileBreadcrumb {
  name: string;
  path: string;
}

interface FileBreadcrumbsProps {
  items: FileBreadcrumb[];
  onSelect: (path: string) => void;
}

export function FileBreadcrumbs({ items, onSelect }: FileBreadcrumbsProps) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm">
      {items.map((crumb, idx) => (
        <div key={crumb.path} className="flex items-center gap-1">
          {idx > 0 ? <span className="text-muted-foreground">/</span> : null}
          <button className="hover:underline" onClick={() => onSelect(crumb.path)}>
            {crumb.name}
          </button>
        </div>
      ))}
    </div>
  );
}
