import { Button } from "../ui/button";

interface FileFilterBarProps {
  filterType: string;
  availableTypes: string[];
  sortBy: "name" | "size" | "modified" | "type";
  sortOrder: "asc" | "desc";
  onFilterChange: (value: string) => void;
  onFilterClear: () => void;
}

export function FileFilterBar({
  filterType,
  availableTypes,
  sortBy,
  sortOrder,
  onFilterChange,
  onFilterClear,
}: FileFilterBarProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">过滤:</span>
      <select
        value={filterType}
        onChange={(event) => onFilterChange(event.target.value)}
        className="h-8 rounded-md border border-[hsl(var(--tw-border))] bg-transparent px-2.5 py-1.5 text-sm"
      >
        <option value="">全部类型</option>
        {availableTypes.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      {filterType ? (
        <Button variant="ghost" size="sm" onClick={onFilterClear}>
          清除
        </Button>
      ) : null}
      <span className="ml-3 text-xs text-muted-foreground">
        排序: {sortBy === "name" ? "名称" : sortBy === "size" ? "大小" : sortBy === "modified" ? "修改时间" : "类型"}
        {sortOrder === "asc" ? " ↑" : " ↓"}
      </span>
    </div>
  );
}
